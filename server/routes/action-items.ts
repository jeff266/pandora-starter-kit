import { Router, type Request, type Response } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import dbPool, { query as dbQuery } from '../db.js';
import { executeAction } from '../actions/executor.js';
import { runHypothesisRedTeam } from '../chat/deliberation-engine.js';
import { formatDeliberationForUI } from '../renderers/deliberation-renderer.js';

const router = Router();

interface WorkspaceParams {
  workspaceId: string;
}

router.get('/:workspaceId/action-items', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const {
      status = 'open',
      severity,
      action_type,
      owner_email,
      source_skill,
      deal_id,
      account_id,
      sort = 'severity',
      limit = '50',
      offset = '0',
    } = req.query;

    let where = 'a.workspace_id = $1';
    const params: any[] = [workspaceId];
    let paramIdx = 2;

    if (status && status !== 'all') {
      const statuses = (status as string).split(',');
      where += ` AND a.execution_status = ANY($${paramIdx++})`;
      params.push(statuses);
    }

    if (severity) {
      where += ` AND a.severity = $${paramIdx++}`;
      params.push(severity);
    }
    if (action_type) {
      where += ` AND a.action_type = $${paramIdx++}`;
      params.push(action_type);
    }
    if (owner_email) {
      where += ` AND a.owner_email = $${paramIdx++}`;
      params.push(owner_email);
    }
    if (source_skill) {
      where += ` AND a.source_skill = $${paramIdx++}`;
      params.push(source_skill);
    }
    if (deal_id) {
      where += ` AND a.target_deal_id = $${paramIdx++}`;
      params.push(deal_id);
    }
    if (account_id) {
      where += ` AND a.target_account_id = $${paramIdx++}`;
      params.push(account_id);
    }

    let orderBy = 'a.created_at DESC';
    switch (sort) {
      case 'severity':
        orderBy = `CASE a.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, a.created_at DESC`;
        break;
      case 'composite':
        orderBy = `CASE a.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
          (CASE COALESCE(d.rfm_grade, 'Z') WHEN 'A' THEN 4 WHEN 'B' THEN 3 WHEN 'C' THEN 2 WHEN 'D' THEN 1 ELSE 0 END
           * COALESCE(a.impact_amount, 0)
           * COALESCE(d.tte_conditional_prob, 0.25)) DESC,
          a.impact_amount DESC NULLS LAST,
          a.created_at DESC`;
        break;
      case 'impact':
        orderBy = 'a.impact_amount DESC NULLS LAST, a.created_at DESC';
        break;
      case 'newest':
        orderBy = 'a.created_at DESC';
        break;
      case 'oldest':
        orderBy = 'a.created_at ASC';
        break;
    }

    const result = await dbQuery(`
      SELECT a.*,
             d.name as deal_name,
             d.stage as deal_stage,
             d.amount as deal_amount,
             d.rfm_grade,
             d.rfm_label,
             d.tte_conditional_prob,
             ls.score_grade as icp_grade
      FROM actions a
      LEFT JOIN deals d ON a.target_deal_id = d.id
      LEFT JOIN lead_scores ls ON ls.entity_id = a.target_deal_id AND ls.entity_type = 'deal'
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT $${paramIdx++}
      OFFSET $${paramIdx++}
    `, [...params, Math.min(parseInt(limit as string), 200), parseInt(offset as string) || 0]);

    const countResult = await dbQuery(
      `SELECT COUNT(*) as total FROM actions a WHERE ${where}`,
      params
    );

    res.json({
      actions: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });
  } catch (err) {
    console.error('[Action Items API]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/:workspaceId/action-items/summary', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;

    const result = await dbQuery(`
      SELECT
        COUNT(*) FILTER (WHERE execution_status = 'open') as open_total,
        COUNT(*) FILTER (WHERE execution_status = 'open' AND severity = 'critical') as open_critical,
        COUNT(*) FILTER (WHERE execution_status = 'open' AND severity = 'warning') as open_warning,
        COUNT(*) FILTER (WHERE execution_status = 'open' AND severity = 'info') as open_info,
        COUNT(*) FILTER (WHERE execution_status = 'in_progress') as in_progress,
        COUNT(*) FILTER (WHERE execution_status = 'executed' AND executed_at >= CURRENT_DATE - INTERVAL '7 days') as executed_7d,
        COUNT(*) FILTER (WHERE execution_status = 'dismissed' AND updated_at >= CURRENT_DATE - INTERVAL '7 days') as dismissed_7d,
        COALESCE(SUM(impact_amount) FILTER (WHERE execution_status = 'open'), 0) as total_impact_at_risk,
        COUNT(DISTINCT owner_email) FILTER (WHERE execution_status = 'open') as reps_with_actions,
        COUNT(DISTINCT source_skill) FILTER (WHERE execution_status = 'open') as skills_producing_actions
      FROM actions
      WHERE workspace_id = $1
    `, [workspaceId]);

    const typesResult = await dbQuery(`
      SELECT action_type, COUNT(*) as count
      FROM actions
      WHERE workspace_id = $1 AND execution_status = 'open'
      GROUP BY action_type
      ORDER BY count DESC
    `, [workspaceId]);

    const repsResult = await dbQuery(`
      SELECT owner_email,
             COUNT(*) as action_count,
             COUNT(*) FILTER (WHERE severity = 'critical') as critical_count,
             COALESCE(SUM(impact_amount), 0) as total_impact
      FROM actions
      WHERE workspace_id = $1 AND execution_status = 'open' AND owner_email IS NOT NULL
      GROUP BY owner_email
      ORDER BY critical_count DESC, action_count DESC
      LIMIT 10
    `, [workspaceId]);

    res.json({
      ...result.rows[0],
      by_type: typesResult.rows,
      by_rep: repsResult.rows,
    });
  } catch (err) {
    console.error('[Action Items Summary]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/:workspaceId/action-items/:actionId', async (req: Request<WorkspaceParams & { actionId: string }>, res: Response) => {
  try {
    const { workspaceId, actionId } = req.params;

    const result = await dbQuery(
      `SELECT a.*, d.name as deal_name, d.stage as deal_stage
       FROM actions a
       LEFT JOIN deals d ON a.target_deal_id = d.id
       WHERE a.id = $1 AND a.workspace_id = $2`,
      [actionId, workspaceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Action not found' });
    }

    const auditResult = await dbQuery(
      `SELECT * FROM action_audit_log
       WHERE action_id = $1
       ORDER BY created_at DESC`,
      [actionId]
    );

    res.json({
      ...result.rows[0],
      audit_log: auditResult.rows,
    });
  } catch (err) {
    console.error('[Action Item Detail]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.put('/:workspaceId/action-items/:actionId/status', async (req: Request<WorkspaceParams & { actionId: string }>, res: Response) => {
  try {
    const { workspaceId, actionId } = req.params;
    const { status, actor, reason, details } = req.body;

    const validStatuses = ['open', 'in_progress', 'executed', 'dismissed', 'rejected', 'snoozed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const current = await dbQuery(
      `SELECT execution_status FROM actions WHERE id = $1 AND workspace_id = $2`,
      [actionId, workspaceId]
    );
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Action not found' });
    }

    const fromStatus = current.rows[0].execution_status;

    const validTransitions: Record<string, string[]> = {
      open: ['in_progress', 'executed', 'dismissed', 'rejected', 'snoozed'],
      in_progress: ['open', 'executed', 'dismissed', 'rejected'],
      executed: [],
      dismissed: ['open'],
      rejected: ['open'],
      snoozed: ['open', 'dismissed', 'rejected'],
      expired: [],
      superseded: [],
    };

    if (!validTransitions[fromStatus]?.includes(status)) {
      return res.status(400).json({
        error: `Cannot transition from '${fromStatus}' to '${status}'`,
      });
    }

    const updateFields: string[] = ['execution_status = $3', 'updated_at = now()'];
    const updateParams: any[] = [actionId, workspaceId, status];
    let idx = 4;

    if (status === 'executed') {
      updateFields.push(`executed_at = now()`);
      updateFields.push(`executed_by = $${idx++}`);
      updateParams.push(actor || 'unknown');
    }
    if (status === 'dismissed') {
      updateFields.push(`dismissed_reason = $${idx++}`);
      updateParams.push(reason || 'user_dismissed');
    }
    if (status === 'rejected') {
      updateFields.push(`dismissed_reason = $${idx++}`);
      updateParams.push(reason || 'user_rejected');
    }
    if (status === 'snoozed') {
      const snoozeDays = req.body.snooze_days || 7;
      updateFields.push(`snoozed_until = now() + ($${idx++} || ' days')::interval`);
      updateParams.push(String(snoozeDays));
    }
    if (status === 'open') {
      updateFields.push(`snoozed_until = NULL`);
    }

    await dbQuery(
      `UPDATE actions SET ${updateFields.join(', ')} WHERE id = $1 AND workspace_id = $2`,
      updateParams
    );

    await dbQuery(`
      INSERT INTO action_audit_log (workspace_id, action_id, event_type, actor, from_status, to_status, details)
      VALUES ($1, $2, 'status_changed', $3, $4, $5, $6)
    `, [workspaceId, actionId, actor || 'unknown', fromStatus, status, details ? JSON.stringify(details) : null]);

    res.json({ success: true, from_status: fromStatus, to_status: status });
  } catch (err) {
    console.error('[Action Item Status Update]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/:workspaceId/action-items/:actionId/preview-execution', async (req: Request<WorkspaceParams & { actionId: string }>, res: Response) => {
  try {
    const { workspaceId, actionId } = req.params;

    // Load action
    const actionResult = await dbQuery(
      `SELECT * FROM actions WHERE id = $1 AND workspace_id = $2`,
      [actionId, workspaceId]
    );

    if (actionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Action not found' });
    }

    const action = actionResult.rows[0];

    // Verify action is executable
    if (!['open', 'in_progress'].includes(action.execution_status)) {
      return res.json({
        action_id: actionId,
        action_title: action.title,
        action_type: action.action_type,
        can_execute: false,
        cannot_execute_reason: `Action is ${action.execution_status}, not executable`,
      });
    }

    // Get deal and connector info
    const deal = action.target_deal_id
      ? (await dbQuery(`SELECT * FROM deals WHERE id = $1`, [action.target_deal_id])).rows[0]
      : null;

    if (!deal) {
      return res.json({
        action_id: actionId,
        action_title: action.title,
        action_type: action.action_type,
        can_execute: false,
        cannot_execute_reason: 'Target deal not found',
      });
    }

    const crmSource = deal.source; // 'hubspot' or 'salesforce'
    const externalId = deal.source_id || deal.external_id;

    if (!externalId) {
      return res.json({
        action_id: actionId,
        action_title: action.title,
        action_type: action.action_type,
        can_execute: false,
        cannot_execute_reason: 'Deal has no external CRM ID',
      });
    }

    // Get connector credentials
    const { getCredentials } = await import('../connectors/adapters/credentials.js');
    const connection = await getCredentials(workspaceId, crmSource);

    if (!connection) {
      return res.json({
        action_id: actionId,
        action_title: action.title,
        action_type: action.action_type,
        connector_type: crmSource,
        can_execute: false,
        cannot_execute_reason: `No ${crmSource} connector configured`,
      });
    }

    if (connection.status === 'auth_expired') {
      return res.json({
        action_id: actionId,
        action_title: action.title,
        action_type: action.action_type,
        connector_type: crmSource,
        can_execute: false,
        cannot_execute_reason: `${crmSource} authorization has expired. Please reconnect.`,
      });
    }

    // Build CRM client
    const { HubSpotClient } = await import('../connectors/hubspot/client.js');
    const { SalesforceClient } = await import('../connectors/salesforce/client.js');
    const { resolveFieldToCRM } = await import('../actions/field-resolver.js');

    const credentials = connection.credentials;
    const client = crmSource === 'hubspot'
      ? new HubSpotClient(credentials.access_token || credentials.accessToken, workspaceId)
      : new SalesforceClient({
          accessToken: credentials.access_token || credentials.accessToken,
          instanceUrl: credentials.instance_url || credentials.instanceUrl,
          apiVersion: 'v62.0',
        });

    // Extract operations from execution_payload
    const payload = action.execution_payload || {};
    const operations: any[] = [];

    if (payload.crm_updates && Array.isArray(payload.crm_updates)) {
      for (const update of payload.crm_updates) {
        const fieldInfo = resolveFieldToCRM(crmSource, update.field);
        operations.push({
          type: 'update_field',
          field_label: fieldInfo.label,
          field_api_name: fieldInfo.apiName,
          current_value: null, // Will fetch below
          proposed_value: update.proposed_value,
          editable: true,
        });
      }
    }

    // Fetch current values from CRM
    if (operations.length > 0) {
      const fieldNames = operations.map(op => op.field_api_name);
      try {
        let currentValues: Record<string, any> | null = null;
        if (crmSource === 'hubspot') {
          currentValues = await (client as any).getDealProperties(externalId, fieldNames);
        } else if (crmSource === 'salesforce') {
          currentValues = await (client as any).getOpportunityFields(externalId, fieldNames);
        }

        if (currentValues) {
          for (const op of operations) {
            op.current_value = currentValues[op.field_api_name] || null;
          }
        }
      } catch (err) {
        console.warn(`[Preview] Failed to fetch current values:`, err);
      }
    }

    // Build CRM deep link
    let crmUrl = '';
    if (crmSource === 'hubspot') {
      const portalId = await (client as any).getPortalId();
      if (portalId) {
        crmUrl = `https://app.hubspot.com/contacts/${portalId}/deal/${externalId}`;
      }
    } else if (crmSource === 'salesforce') {
      crmUrl = `${credentials.instance_url || credentials.instanceUrl}/${externalId}`;
    }

    // Generate audit note preview
    const auditNotePreview = `Action: ${action.title}\nType: ${action.action_type}\nSeverity: ${action.severity}\n\n${action.summary || ''}\n\nSource: Pandora ${action.source_skill} skill\nExecuted: ${new Date().toISOString()}`;

    // Check for warnings
    const warnings: string[] = [];
    if (deal.stage_normalized === 'closed_won' || deal.stage_normalized === 'closed_lost') {
      warnings.push('Deal is already closed — stage change may be blocked by CRM validation rules');
    }

    res.json({
      action_id: actionId,
      action_title: action.title,
      action_type: action.action_type,
      connector_type: crmSource,
      target: {
        entity_type: 'deal',
        entity_name: deal.name,
        external_id: externalId,
        crm_url: crmUrl,
      },
      operations,
      audit_note_preview: auditNotePreview,
      warnings,
      can_execute: operations.length > 0 || action.action_type.includes('notify'),
      cannot_execute_reason: operations.length === 0 && !action.action_type.includes('notify')
        ? 'No operations to perform'
        : null,
    });
  } catch (err) {
    console.error('[Preview Execution]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/:workspaceId/action-items/:actionId/execute', async (req: Request<WorkspaceParams & { actionId: string }>, res: Response) => {
  try {
    const { workspaceId, actionId } = req.params;
    const { actor = 'user', dry_run = false } = req.body;

    const result = await executeAction(dbPool, {
      actionId,
      workspaceId,
      actor,
      dryRun: dry_run,
    });

    if (result.success) {
      console.log(`[Action Execute] Action ${actionId} executed successfully by ${actor}`);
    } else {
      console.warn(`[Action Execute] Action ${actionId} execution failed:`, result.error);
    }

    res.json(result);
  } catch (err) {
    console.error('[Action Execute]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Sprint endpoints ────────────────────────────────────────────────────────

router.get('/:workspaceId/actions/sprint', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const weekStr = (req.query.week as string) || new Date().toISOString().split('T')[0];

    // Sprint actions for the current week
    const sprintResult = await dbQuery(`
      SELECT a.*,
             d.name as deal_name, d.source_id as deal_source_id,
             h.hypothesis, h.metric, h.current_value, h.alert_threshold, h.alert_direction
      FROM actions a
      LEFT JOIN deals d ON a.target_deal_id = d.id
      LEFT JOIN standing_hypotheses h ON a.hypothesis_id = h.id
      WHERE a.workspace_id = $1
        AND a.sprint_week IS NOT NULL
        AND a.sprint_week >= date_trunc('week', $2::date)
        AND a.sprint_week < date_trunc('week', $2::date) + interval '7 days'
        AND a.state NOT IN ('executed', 'not_applicable')
        AND a.action_type != 'hypothesis_alert'
      ORDER BY
        CASE a.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
        COALESCE(a.expected_value_delta, 0) DESC
    `, [workspaceId, weekStr]);

    // Active hypotheses
    const hypResult = await dbQuery(`
      SELECT * FROM standing_hypotheses
      WHERE workspace_id = $1 AND status = 'active'
      ORDER BY
        CASE WHEN current_value IS NOT NULL AND alert_threshold IS NOT NULL
             AND ((alert_direction = 'below' AND current_value::numeric < alert_threshold::numeric)
               OR (alert_direction = 'above' AND current_value::numeric > alert_threshold::numeric))
             THEN 0 ELSE 1 END,
        created_at ASC
    `, [workspaceId]);

    // Total backlog count (non-sprint open actions)
    const backlogCount = await dbQuery(`
      SELECT COUNT(*) as total FROM actions
      WHERE workspace_id = $1 AND (sprint_week IS NULL OR state = 'deferred')
        AND execution_status = 'open'
    `, [workspaceId]);

    const totalExpectedValue = sprintResult.rows.reduce(
      (sum: number, a: any) => sum + (parseFloat(a.expected_value_delta) || 0), 0
    );

    res.json({
      week: weekStr,
      actions: sprintResult.rows,
      hypotheses: hypResult.rows,
      total_expected_value: totalExpectedValue,
      backlog_count: parseInt(backlogCount.rows[0].total),
    });
  } catch (err) {
    console.error('[Sprint API]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/:workspaceId/actions/backlog', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { severity, action_type, owner_email, source_skill, sort = 'severity', limit = '50', offset = '0', search } = req.query;

    let where = `a.workspace_id = $1 AND a.execution_status = 'open'`;
    const params: any[] = [workspaceId];
    let paramIdx = 2;

    if (severity) { where += ` AND a.severity = $${paramIdx++}`; params.push(severity); }
    if (action_type) { where += ` AND a.action_type = $${paramIdx++}`; params.push(action_type); }
    if (owner_email) { where += ` AND a.owner_email = $${paramIdx++}`; params.push(owner_email); }
    if (source_skill) { where += ` AND a.source_skill = $${paramIdx++}`; params.push(source_skill); }
    if (search) { where += ` AND a.title ILIKE $${paramIdx++}`; params.push(`%${search}%`); }

    let orderBy = `CASE a.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, a.created_at DESC`;
    if (sort === 'impact') orderBy = 'COALESCE(a.impact_amount, a.expected_value_delta) DESC NULLS LAST, a.created_at DESC';
    if (sort === 'age') orderBy = 'a.created_at ASC';

    const result = await dbQuery(`
      SELECT a.*, d.name as deal_name, h.metric as hypothesis_metric
      FROM actions a
      LEFT JOIN deals d ON a.target_deal_id = d.id
      LEFT JOIN standing_hypotheses h ON a.hypothesis_id = h.id
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `, [...params, Math.min(parseInt(limit as string), 200), parseInt(offset as string) || 0]);

    const countResult = await dbQuery(`SELECT COUNT(*) as total FROM actions a WHERE ${where}`, params);

    res.json({
      actions: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });
  } catch (err) {
    console.error('[Backlog API]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.patch('/:workspaceId/action-items/:actionId/state', async (req: Request<WorkspaceParams & { actionId: string }>, res: Response) => {
  try {
    const { workspaceId, actionId } = req.params;
    const { state } = req.body;

    const validStates = ['pending', 'in_progress', 'executed', 'deferred', 'not_applicable', 'escalated'];
    if (!validStates.includes(state)) {
      return res.status(400).json({ error: `Invalid state. Must be one of: ${validStates.join(', ')}` });
    }

    const current = await dbQuery(
      `SELECT id, state, sprint_week, hypothesis_id, target_deal_id, title FROM actions WHERE id = $1 AND workspace_id = $2`,
      [actionId, workspaceId]
    );
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Action not found' });
    }
    const action = current.rows[0];

    // Calculate next sprint week for 'deferred'
    let newSprintWeek: string | null = null;
    if (state === 'deferred' && action.sprint_week) {
      const next = new Date(action.sprint_week);
      next.setUTCDate(next.getUTCDate() + 7);
      newSprintWeek = next.toISOString().split('T')[0];
    }

    // Map sprint state to execution_status for backwards compat
    const statusMap: Record<string, string> = {
      pending: 'open',
      in_progress: 'in_progress',
      executed: 'executed',
      deferred: 'open',
      not_applicable: 'dismissed',
      escalated: 'open',
    };

    await dbQuery(`
      UPDATE actions SET
        state = $1,
        execution_status = $2,
        sprint_week = COALESCE($3::date, sprint_week),
        updated_at = now()
      WHERE id = $4 AND workspace_id = $5
    `, [state, statusMap[state], newSprintWeek, actionId, workspaceId]);

    // Side effects
    if (state === 'in_progress') {
      // Fire crumb trail asynchronously (non-fatal)
      import('../concierge/crumb-trail-detector.js').then(({ recordCrumbTrail, detectCrumbTrail }) => {
        const ctx = {
          workspaceId,
          userMessage: `Working on action: ${action.title}`,
          triggerType: 'ask_pandora' as const,
          standingHypothesisId: action.hypothesis_id ?? undefined,
        };
        recordCrumbTrail(ctx, detectCrumbTrail(ctx.userMessage)).catch(() => {});
      }).catch(() => {});
    }

    if (state === 'deferred' && newSprintWeek) {
      console.log(`[Sprint] Action ${actionId} deferred to week ${newSprintWeek}`);
    }

    res.json({ success: true, state, sprint_week: newSprintWeek ?? action.sprint_week });
  } catch (err) {
    console.error('[State PATCH]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/:workspaceId/actions/sprint/assemble', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { assembleWeeklySprint } = await import('../jobs/assemble-weekly-sprint.js');
    const result = await assembleWeeklySprint(workspaceId);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Sprint Assemble]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Snooze ──────────────────────────────────────────────────────────────────

router.post('/:workspaceId/action-items/:actionId/snooze', async (req: Request<WorkspaceParams & { actionId: string }>, res: Response) => {
  try {
    const { workspaceId, actionId } = req.params;
    const { days = 7, actor = 'user' } = req.body;

    const snoozeDays = typeof days === 'number' && days > 0 ? days : 7;

    const current = await dbQuery(
      `SELECT execution_status FROM actions WHERE id = $1 AND workspace_id = $2`,
      [actionId, workspaceId]
    );
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Action not found' });
    }

    const fromStatus = current.rows[0].execution_status;
    if (!['open', 'in_progress'].includes(fromStatus)) {
      return res.status(400).json({ error: `Cannot snooze action in '${fromStatus}' status` });
    }

    await dbQuery(`
      UPDATE actions SET
        execution_status = 'snoozed',
        snoozed_until = now() + ($3 || ' days')::interval,
        updated_at = now()
      WHERE id = $1 AND workspace_id = $2
    `, [actionId, workspaceId, String(snoozeDays)]);

    await dbQuery(`
      INSERT INTO action_audit_log (workspace_id, action_id, event_type, actor, from_status, to_status, details)
      VALUES ($1, $2, 'snoozed', $3, $4, 'snoozed', $5)
    `, [workspaceId, actionId, actor, fromStatus, JSON.stringify({ snooze_days: snoozeDays })]);

    console.log(`[Action Snooze] Action ${actionId} snoozed for ${snoozeDays} days by ${actor}`);
    res.json({ success: true, snoozed_days: snoozeDays });
  } catch (err) {
    console.error('[Action Snooze]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/workspaces/:workspaceId/deliberation/hypothesis/:hypothesisId
// Trigger Red Team deliberation for a hypothesis
router.post(
  '/:workspaceId/deliberation/hypothesis/:hypothesisId',
  requirePermission('read'),
  async (req: Request<WorkspaceParams & { hypothesisId: string }>, res: Response) => {
    const { workspaceId, hypothesisId } = req.params;

    try {
      console.log(`[RedTeam] Triggering hypothesis deliberation for ${hypothesisId}`);
      await runHypothesisRedTeam(workspaceId, hypothesisId);

      // Fetch the just-inserted run so we can return its ID and formatted output
      const runResult = await dbQuery<any>(
        `SELECT * FROM deliberation_runs
         WHERE workspace_id = $1 AND hypothesis_id = $2
         ORDER BY created_at DESC LIMIT 1`,
        [workspaceId, hypothesisId]
      );
      const run = runResult.rows[0] ?? null;
      const deliberation = run ? formatDeliberationForUI(run) : null;

      res.json({
        success: true,
        deliberation_run_id: run?.id ?? null,
        deliberation,
      });
    } catch (err) {
      console.error('[RedTeam] Error:', err);
      res.status(500).json({ error: 'Deliberation failed', message: (err as Error).message });
    }
  }
);

// GET /api/workspaces/:workspaceId/deliberations/:deliberationRunId
// Fetch a completed deliberation run by ID, scoped to workspace
router.get(
  '/:workspaceId/deliberations/:deliberationRunId',
  requirePermission('read'),
  async (req: Request<WorkspaceParams & { deliberationRunId: string }>, res: Response) => {
    const { workspaceId, deliberationRunId } = req.params;

    try {
      const result = await dbQuery<any>(
        `SELECT id, hypothesis_id, pattern, trigger_surface,
                perspectives, verdict, token_cost, created_at
         FROM deliberation_runs
         WHERE id = $1 AND workspace_id = $2`,
        [deliberationRunId, workspaceId]
      );

      if (!result.rows.length) {
        return res.status(404).json({ error: 'Deliberation run not found' });
      }

      const deliberation = formatDeliberationForUI(result.rows[0]);
      return res.json({ deliberation });
    } catch (err) {
      console.error('[Deliberation] GET error:', err);
      return res.status(500).json({ error: 'Failed to fetch deliberation run' });
    }
  }
);

export default router;
