import { Router, Request, Response, NextFunction } from 'express';
import { generateGreeting } from '../briefing/greeting-engine.js';
import { getOperatorStatuses } from '../briefing/operator-status.js';
import { query } from '../db.js';
import { getPandoraRole, type PandolaRole } from '../context/pandora-role.js';
import { computeTemporalContext } from '../context/opening-brief.js';
import { requireWorkspaceAccess } from '../middleware/auth.js';

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

// Optional auth middleware for development testing
const optionalAuth = (req: Request, res: Response, next: NextFunction) => {
  // In development, allow unauthenticated access if test params present
  const hasTestParams = req.query.role || req.query.quarterPhase || req.query.daysRemaining;
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev && hasTestParams) {
    return next(); // Skip auth for testing
  }

  // Otherwise require normal auth
  return requireWorkspaceAccess(req, res, next);
};

router.get('/:workspaceId/briefing/greeting', optionalAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const userId = (req as any).user?.user_id;

    // Parse query params
    const rawHour = parseInt(req.query.localHour as string, 10);
    const localHour = (!isNaN(rawHour) && rawHour >= 0 && rawHour <= 23) ? rawHour : undefined;

    // Test parameter overrides
    const roleOverride = req.query.role as PandolaRole | undefined;
    const quarterPhaseOverride = req.query.quarterPhase as 'early' | 'mid' | 'late' | 'final_week' | undefined;
    const daysRemainingOverride = req.query.daysRemaining ? parseInt(req.query.daysRemaining as string, 10) : undefined;

    // Fetch real data (with conditional userId for test mode)
    const [firstName, roleResult, temporal] = await Promise.all([
      getUserFirstName(workspaceId, userId),
      roleOverride ? Promise.resolve({ pandoraRole: roleOverride }) :
        (userId ? getPandoraRole(workspaceId, userId).catch(() => null) : Promise.resolve(null)),
      computeTemporalContext(workspaceId).catch(() => null),
    ]);

    // Apply overrides
    let finalRole: PandolaRole | null = roleOverride ?? roleResult?.pandoraRole ?? null;
    let finalTemporal = temporal ?? undefined;

    // If temporal overrides provided, patch the temporal context
    if ((quarterPhaseOverride || daysRemainingOverride !== undefined) && temporal) {
      finalTemporal = {
        ...temporal,
        ...(quarterPhaseOverride && { quarterPhase: quarterPhaseOverride }),
        ...(daysRemainingOverride !== undefined && { daysRemainingInQuarter: daysRemainingOverride }),
      };
    }

    const payload = await generateGreeting(workspaceId, firstName, localHour, finalRole, finalTemporal);
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
