/**
 * Action Items API
 *
 * CRUD endpoints for Actions Engine - structured executable recommendations from skill runs.
 * Includes filtering, sorting, pagination, summary stats, Slack notifications, and audit logging.
 */

import { Router } from 'express';

const router = Router();

// GET /api/workspaces/:id/action-items
// List action items with filters
router.get('/api/workspaces/:workspaceId/action-items', async (req, res) => {
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

    // Status filter (comma-separated for multiple)
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

    // Sort
    let orderBy = 'a.created_at DESC';
    switch (sort) {
      case 'severity':
        orderBy = `CASE a.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, a.created_at DESC`;
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

    const result = await req.db.query(`
      SELECT a.*,
             d.name as deal_name,
             d.stage as deal_stage,
             d.amount as deal_amount
      FROM actions a
      LEFT JOIN deals d ON a.target_deal_id = d.id
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT $${paramIdx++}
      OFFSET $${paramIdx++}
    `, [...params, Math.min(parseInt(limit as string), 200), parseInt(offset as string) || 0]);

    // Count total for pagination
    const countResult = await req.db.query(
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

// GET /api/workspaces/:id/action-items/summary
// Dashboard summary counts
router.get('/api/workspaces/:workspaceId/action-items/summary', async (req, res) => {
  try {
    const { workspaceId } = req.params;

    const result = await req.db.query(`
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

    // Top action types
    const typesResult = await req.db.query(`
      SELECT action_type, COUNT(*) as count
      FROM actions
      WHERE workspace_id = $1 AND execution_status = 'open'
      GROUP BY action_type
      ORDER BY count DESC
    `, [workspaceId]);

    // Top reps by open action count
    const repsResult = await req.db.query(`
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

// GET /api/workspaces/:id/action-items/:actionId
// Full action detail with audit log
router.get('/api/workspaces/:workspaceId/action-items/:actionId', async (req, res) => {
  try {
    const { workspaceId, actionId } = req.params;

    const result = await req.db.query(
      `SELECT a.*, d.name as deal_name, d.stage as deal_stage
       FROM actions a
       LEFT JOIN deals d ON a.target_deal_id = d.id
       WHERE a.id = $1 AND a.workspace_id = $2`,
      [actionId, workspaceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Action not found' });
    }

    // Audit log
    const auditResult = await req.db.query(
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

// PUT /api/workspaces/:id/action-items/:actionId/status
// Update action status (the primary interaction)
router.put('/api/workspaces/:workspaceId/action-items/:actionId/status', async (req, res) => {
  try {
    const { workspaceId, actionId } = req.params;
    const { status, actor, reason, details } = req.body;

    const validStatuses = ['open', 'in_progress', 'executed', 'dismissed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    // Get current action
    const current = await req.db.query(
      `SELECT execution_status FROM actions WHERE id = $1 AND workspace_id = $2`,
      [actionId, workspaceId]
    );
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Action not found' });
    }

    const fromStatus = current.rows[0].execution_status;

    // Validate transitions
    const validTransitions: Record<string, string[]> = {
      open: ['in_progress', 'executed', 'dismissed'],
      in_progress: ['open', 'executed', 'dismissed'],
      executed: [],      // terminal
      dismissed: ['open'], // can reopen
      expired: [],        // terminal
      superseded: [],     // terminal
    };

    if (!validTransitions[fromStatus]?.includes(status)) {
      return res.status(400).json({
        error: `Cannot transition from '${fromStatus}' to '${status}'`,
      });
    }

    // Update action
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

    await req.db.query(
      `UPDATE actions SET ${updateFields.join(', ')} WHERE id = $1 AND workspace_id = $2`,
      updateParams
    );

    // Audit log
    await req.db.query(`
      INSERT INTO action_audit_log (workspace_id, action_id, event_type, actor, from_status, to_status, details)
      VALUES ($1, $2, 'status_changed', $3, $4, $5, $6)
    `, [workspaceId, actionId, actor || 'unknown', fromStatus, status, details ? JSON.stringify(details) : null]);

    res.json({ success: true, from_status: fromStatus, to_status: status });
  } catch (err) {
    console.error('[Action Item Status Update]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/workspaces/:id/action-items/:actionId/notify
// Send Slack notification for an action (manual trigger)
router.post('/api/workspaces/:workspaceId/action-items/:actionId/notify', async (req, res) => {
  try {
    const { workspaceId, actionId } = req.params;
    const { channel } = req.body; // 'rep' or 'channel' or specific channel name

    const actionResult = await req.db.query(
      `SELECT * FROM actions WHERE id = $1 AND workspace_id = $2`,
      [actionId, workspaceId]
    );
    if (actionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Action not found' });
    }

    const action = actionResult.rows[0];
    const { notifyActionViaSlack } = await import('../actions/slack-notify.js');
    const result = await notifyActionViaSlack(req.db, workspaceId, action, channel || 'channel');

    // Audit log
    await req.db.query(`
      INSERT INTO action_audit_log (workspace_id, action_id, event_type, actor, details)
      VALUES ($1, $2, 'notified', $3, $4)
    `, [workspaceId, actionId, req.body.actor || 'user', JSON.stringify({ channel, result })]);

    res.json(result);
  } catch (err) {
    console.error('[Action Item Notify]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/workspaces/:id/action-items/:actionId/preview
// Dry-run: show what WOULD change without writing to CRM
router.post('/api/workspaces/:workspaceId/action-items/:actionId/preview', async (req, res) => {
  try {
    const { workspaceId, actionId } = req.params;
    const { executeAction } = await import('../actions/executor.js');

    const result = await executeAction(req.db, {
      actionId,
      workspaceId,
      actor: req.body.actor || 'preview',
      dryRun: true,
    });

    res.json(result);
  } catch (err) {
    console.error('[Action Preview]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/workspaces/:id/action-items/:actionId/execute
// Execute the action: write to CRM, create audit note, update status
router.post('/api/workspaces/:workspaceId/action-items/:actionId/execute', async (req, res) => {
  try {
    const { workspaceId, actionId } = req.params;
    const { actor } = req.body;

    if (!actor) {
      return res.status(400).json({ error: 'actor is required (user email)' });
    }

    const { executeAction } = await import('../actions/executor.js');

    const result = await executeAction(req.db, {
      actionId,
      workspaceId,
      actor,
      dryRun: false,
    });

    res.json(result);
  } catch (err) {
    console.error('[Action Execute]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/workspaces/:id/action-items/:actionId/operations
// Show what operations this action would perform (without executing)
router.get('/api/workspaces/:workspaceId/action-items/:actionId/operations', async (req, res) => {
  try {
    const { workspaceId, actionId } = req.params;

    const actionResult = await req.db.query(
      `SELECT a.*, d.source, d.source_id, d.external_id, d.name as deal_name
       FROM actions a
       LEFT JOIN deals d ON a.target_deal_id = d.id
       WHERE a.id = $1 AND a.workspace_id = $2`,
      [actionId, workspaceId]
    );

    if (actionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Action not found' });
    }

    const action = actionResult.rows[0];
    const payload = action.execution_payload || {};

    const operations = [];

    // CRM field changes
    if (payload.crm_updates && Array.isArray(payload.crm_updates)) {
      for (const update of payload.crm_updates) {
        operations.push({
          type: 'field_update',
          crm: action.source || 'unknown',
          deal: action.deal_name || action.target_entity_name,
          field: update.field,
          current_value: update.current_value || null,
          proposed_value: update.proposed_value,
        });
      }
    }

    // Audit note
    operations.push({
      type: 'audit_note',
      crm: action.source || 'unknown',
      deal: action.deal_name || action.target_entity_name,
      description: 'Pandora will add an audit note documenting this action and its source',
    });

    res.json({
      action_id: action.id,
      action_type: action.action_type,
      executable: ['open', 'in_progress'].includes(action.execution_status),
      has_crm_id: !!(action.source_id || action.external_id),
      crm_source: action.source || null,
      operations,
    });
  } catch (err) {
    console.error('[Action Operations]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
