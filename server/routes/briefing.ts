import { Router, Request, Response } from 'express';
import { generateGreeting } from '../briefing/greeting-engine.js';
import { getOperatorStatuses } from '../briefing/operator-status.js';
import { query } from '../db.js';

const router = Router();

async function getUserFirstName(workspaceId: string, userId?: string): Promise<string | undefined> {
  if (!userId) return undefined;
  try {
    const result = await query<{ name: string }>(
      'SELECT name FROM users WHERE id = $1',
      [userId]
    );
    if (result.rows[0]?.name) {
      return result.rows[0].name.split(' ')[0];
    }
  } catch {
  }
  return undefined;
}

router.get('/:workspaceId/briefing/greeting', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const userId = (req as any).user?.user_id;
    const firstName = await getUserFirstName(workspaceId, userId);
    const rawHour = parseInt(req.query.localHour as string, 10);
    const localHour = (!isNaN(rawHour) && rawHour >= 0 && rawHour <= 23) ? rawHour : undefined;
    const payload = await generateGreeting(workspaceId, firstName, localHour);
    res.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[briefing] greeting error:', msg);
    res.status(500).json({ error: msg });
  }
});

router.get('/:workspaceId/briefing/brief', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 6, 20);
    const sinceParam = req.query.since as string | undefined;
    const since = sinceParam ? sinceParam : new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

    // Return findings-based brief items for the legacy MorningBrief component
    const result = await query<any>(
      `SELECT f.id, f.severity, f.message, f.category, f.skill_id, f.found_at
       FROM findings f
       WHERE f.workspace_id = $1 AND f.resolved_at IS NULL AND f.found_at > $2
       ORDER BY CASE f.severity WHEN 'act' THEN 0 WHEN 'watch' THEN 1 ELSE 2 END ASC, f.found_at DESC
       LIMIT $3`,
      [workspaceId, since, limit]
    );

    const OPERATOR_META: Record<string, { name: string; icon: string; color: string }> = {
      'forecast-rollup': { name: 'Forecast Analyst', icon: '🎯', color: '#7C6AE8' },
      'deal-risk-review': { name: 'Deal Analyst', icon: '🔍', color: '#FB923C' },
      'pipeline-coverage': { name: 'Pipeline Analyst', icon: '📊', color: '#22D3EE' },
      'rep-scorecard': { name: 'Coaching Analyst', icon: '🏋️', color: '#34D399' },
    };

    const items = result.rows.map(row => {
      const meta = (row.skill_id && OPERATOR_META[row.skill_id]) || { name: 'Pandora', icon: '✦', color: '#6488EA' };
      const severity = row.severity === 'act' ? 'critical' : row.severity === 'watch' ? 'warning' : 'info';
      const headline = row.message.length > 80 ? row.message.substring(0, 77) + '...' : row.message;
      return { id: row.id, operator_name: meta.name, operator_icon: meta.icon, operator_color: meta.color, severity, headline, body: row.category || row.message, skill_run_id: null, skill_id: row.skill_id, created_at: row.found_at };
    });
    res.json(items);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[briefing] brief error:', msg);
    res.status(500).json({ error: msg });
  }
});

router.get('/:workspaceId/briefing/operators', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const statuses = await getOperatorStatuses(workspaceId);
    res.json(statuses);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[briefing] operators error:', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
