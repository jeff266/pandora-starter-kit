import { Router, type Request, type Response } from 'express';
import dbPool, { query as dbQuery } from '../db.js';
import { executeAction } from '../actions/executor.js';

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
             d.amount as deal_amount
      FROM actions a
      LEFT JOIN deals d ON a.target_deal_id = d.id
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

export default router;
