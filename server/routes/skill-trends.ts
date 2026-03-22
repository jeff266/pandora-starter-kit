import { Router, Request, Response } from 'express';
import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('SkillTrends');

/**
 * GET /:workspaceId/skills/trends
 * Returns skill run counts grouped by week for the last 12 weeks
 */
router.get('/:workspaceId/skills/trends', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const { skill_ids } = req.query;

  try {
    // Parse skill_ids from comma-separated string or array
    let skillFilter: string[] = [];
    if (skill_ids) {
      skillFilter = Array.isArray(skill_ids)
        ? skill_ids as string[]
        : (skill_ids as string).split(',').map(s => s.trim());
    }

    // Build query - group by week and skill_id
    const conditions: string[] = ['workspace_id = $1', 'status = $2'];
    const values: any[] = [workspaceId, 'completed'];

    if (skillFilter.length > 0) {
      values.push(skillFilter);
      conditions.push(`skill_id = ANY($${values.length})`);
    }

    // Get last 12 weeks of data
    const weeksAgo = 12;
    conditions.push(`created_at >= NOW() - INTERVAL '${weeksAgo} weeks'`);

    const result = await query<{
      week_start: string;
      skill_id: string;
      run_count: string;
    }>(
      `SELECT
         DATE_TRUNC('week', created_at) AS week_start,
         skill_id,
         COUNT(*) AS run_count
       FROM skill_runs
       WHERE ${conditions.join(' AND ')}
       GROUP BY DATE_TRUNC('week', created_at), skill_id
       ORDER BY week_start ASC, skill_id ASC`,
      values
    );

    // Transform into skill-keyed format
    const trends: Record<string, Array<{ week: string; count: number }>> = {};

    for (const row of result.rows) {
      const week = new Date(row.week_start).toISOString().split('T')[0];
      const count = parseInt(row.run_count, 10);

      if (!trends[row.skill_id]) {
        trends[row.skill_id] = [];
      }

      trends[row.skill_id].push({ week, count });
    }

    logger.info('Skill trends fetched', {
      workspace_id: workspaceId,
      skill_count: Object.keys(trends).length,
      weeks: weeksAgo
    });

    res.json({ trends });
  } catch (err) {
    logger.error('Failed to fetch skill trends', err instanceof Error ? err : undefined);
    res.status(500).json({
      error: 'Failed to fetch skill trends',
      message: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

/**
 * GET /:workspaceId/skills/claims
 * Returns skill execution quota usage for current billing period
 */
router.get('/:workspaceId/skills/claims', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;

  try {
    // Get workspace billing tier and quota
    const workspaceResult = await query<{
      plan_tier: string;
      skill_quota?: number;
    }>(
      `SELECT plan_tier, skill_quota FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    if (workspaceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const workspace = workspaceResult.rows[0];

    // Default quotas by tier (can be overridden by skill_quota)
    const DEFAULT_QUOTAS: Record<string, number> = {
      'free': 100,
      'pro': 500,
      'enterprise': 2000,
    };

    const quota = workspace.skill_quota ?? DEFAULT_QUOTAS[workspace.plan_tier] ?? 100;

    // Count completed runs in current billing period (assume monthly, current month)
    const claimsResult = await query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM skill_runs
       WHERE workspace_id = $1
         AND status = 'completed'
         AND created_at >= DATE_TRUNC('month', NOW())`,
      [workspaceId]
    );

    const used = parseInt(claimsResult.rows[0]?.count || '0', 10);
    const remaining = Math.max(0, quota - used);
    const utilization = quota > 0 ? Math.round((used / quota) * 100) : 0;

    logger.info('Skill claims fetched', {
      workspace_id: workspaceId,
      used,
      quota,
      utilization
    });

    res.json({
      quota,
      used,
      remaining,
      utilization,
      period: 'monthly',
      period_start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
    });
  } catch (err) {
    logger.error('Failed to fetch skill claims', err instanceof Error ? err : undefined);
    res.status(500).json({
      error: 'Failed to fetch skill claims',
      message: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

export default router;
