import { Router, Request, Response, NextFunction } from 'express';
import { generateGreeting } from '../briefing/greeting-engine.js';
import { getOperatorStatuses } from '../briefing/operator-status.js';
import { query } from '../db.js';
import { getPandoraRole, type PandolaRole } from '../context/pandora-role.js';
import {
  computeTemporalContext,
  assembleOpeningBrief,
  getOrAssembleBrief,
  type OpeningBriefData,
  type TemporalContext,
} from '../context/opening-brief.js';
import { requireWorkspaceAccess } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';

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

router.get('/:workspaceId/briefing/latest-feed', requireWorkspaceAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;

    const OPERATOR_META: Record<string, { name: string; icon: string; color: string }> = {
      'forecast-rollup':           { name: 'Forecast Analyst',  icon: '🎯', color: '#7C6AE8' },
      'deal-risk-review':          { name: 'Deal Analyst',       icon: '🔍', color: '#FB923C' },
      'pipeline-coverage':         { name: 'Pipeline Analyst',   icon: '📊', color: '#22D3EE' },
      'pipeline-hygiene':          { name: 'Pipeline Inspector', icon: '🔬', color: '#22D3EE' },
      'rep-scorecard':             { name: 'Coaching Analyst',   icon: '🏋️', color: '#34D399' },
      'weekly-recap':              { name: 'Recap Analyst',      icon: '📋', color: '#A78BFA' },
      'data-quality-audit':        { name: 'Data Quality',       icon: '🧹', color: '#F59E0B' },
      'pipeline-waterfall':        { name: 'Waterfall Analyst',  icon: '💧', color: '#38BDF8' },
      'stage-velocity-benchmarks': { name: 'Velocity Analyst',   icon: '⚡', color: '#F472B6' },
      'bowtie-analysis':           { name: 'Bowtie Analyst',     icon: '🎀', color: '#FB923C' },
      'forecast-model':            { name: 'Forecast Model',     icon: '📈', color: '#818CF8' },
      'lead-scoring':              { name: 'Lead Scorer',        icon: '⭐', color: '#FBBF24' },
    };

    const runsResult = await query<{
      skill_id: string;
      status: string;
      output_text: string | null;
      steps: any;
      started_at: string;
      completed_at: string | null;
      duration_ms: number | null;
    }>(
      `SELECT skill_id, status, output_text, steps, started_at, completed_at, duration_ms
       FROM skill_runs
       WHERE workspace_id = $1 AND status = 'completed'
       ORDER BY completed_at DESC
       LIMIT 5`,
      [workspaceId]
    );

    if (runsResult.rows.length === 0) {
      res.json({ operators: [], events: [] });
      return;
    }

    const operators: Array<{ agent_id: string; agent_name: string; icon: string; color: string; phase: string; finding_preview?: string }> = [];
    const events: Array<{ agent_id: string; tool_name: string; label: string; ts: number }> = [];

    const seen = new Set<string>();
    let baseTs = Date.now() - 60000;

    for (const row of runsResult.rows) {
      const meta = OPERATOR_META[row.skill_id] || { name: row.skill_id, icon: '⚙️', color: '#6B7280' };
      if (!seen.has(row.skill_id)) {
        seen.add(row.skill_id);

        const preview = row.output_text
          ? row.output_text.replace(/^#+\s*/m, '').replace(/\n.*/s, '').substring(0, 80)
          : undefined;

        operators.push({
          agent_id: row.skill_id,
          agent_name: meta.name,
          icon: meta.icon,
          color: meta.color,
          phase: 'done',
          finding_preview: preview,
        });

        if (Array.isArray(row.steps)) {
          for (const step of row.steps) {
            const stepName = (step.name || step.id || 'Processing').replace(/_/g, ' ');
            events.push({ agent_id: row.skill_id, tool_name: step.id || 'step', label: stepName, ts: baseTs });
            baseTs += 800;
          }
        } else {
          events.push({ agent_id: row.skill_id, tool_name: 'analyze', label: 'Analyzing data', ts: baseTs });
          baseTs += 800;
        }
      }
    }

    res.json({ operators, events });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[briefing] latest-feed error:', msg);
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

/**
 * GET /:workspaceId/briefing/concierge
 *
 * Returns the full opening brief with temporal context for the Concierge UI.
 * Supports ?refresh=true to bypass the 5-minute cache.
 */
router.get(
  '/:workspaceId/briefing/concierge',
  requireWorkspaceAccess,
  async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.params.workspaceId as string;
    const userId = (req as any).user?.user_id as string;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const refresh = req.query.refresh === 'true';
    const pipelineFilter = (req.query.pipeline as string | undefined) || null;

    try {
      const brief: OpeningBriefData = refresh
        ? await assembleOpeningBrief(workspaceId, userId)
        : await getOrAssembleBrief(workspaceId, userId);

      try {
        const targetRow = await query<{
          amount: string;
          pipeline_id: string | null;
          pipeline_name: string | null;
          period_start: string | null;
          period_end: string | null;
        }>(
          `SELECT amount, pipeline_id, pipeline_name, period_start, period_end
           FROM targets
           WHERE workspace_id = $1 AND is_active = true
             AND period_start <= CURRENT_DATE
             AND period_end >= CURRENT_DATE
           ORDER BY amount ASC
           LIMIT 1`,
          [workspaceId]
        ).then(r => r.rows[0]).catch(() => null);

        let hasTarget = !!targetRow;
        const targetPipeline = targetRow?.pipeline_id || targetRow?.pipeline_name || null;

        if (pipelineFilter && targetPipeline && targetPipeline !== pipelineFilter
            && targetPipeline !== 'All pipelines') {
          hasTarget = false;
        }

        const periodStart = targetRow?.period_start ? new Date(targetRow.period_start) : null;
        const periodEnd = targetRow?.period_end ? new Date(targetRow.period_end) : null;

        const pipelineRef = targetPipeline;
        let pipelineScopeId: string | null = null;
        if (pipelineRef) {
          const sr = await query<{ scope_id: string }>(
            `SELECT scope_id FROM analysis_scopes
             WHERE workspace_id = $1 AND (name = $2 OR scope_id = $2) LIMIT 1`,
            [workspaceId, pipelineRef]
          ).catch(() => ({ rows: [] as any[] }));
          pipelineScopeId = sr.rows[0]?.scope_id ?? null;
        }

        let cwSQL = `SELECT COALESCE(SUM(amount), 0)::numeric as closed_won_value
           FROM deals
           WHERE workspace_id = $1
             AND stage_normalized = 'closed_won'`;
        const cwParams: unknown[] = [workspaceId];
        let pi = 2;

        if (periodStart) {
          cwSQL += ` AND close_date >= $${pi}`;
          cwParams.push(periodStart);
          pi++;
        }
        if (periodEnd) {
          cwSQL += ` AND close_date <= $${pi}`;
          cwParams.push(periodEnd);
          pi++;
        }

        if (pipelineFilter) {
          cwSQL += ` AND pipeline = $${pi}`;
          cwParams.push(pipelineFilter);
          pi++;
        } else if (pipelineScopeId) {
          cwSQL += ` AND scope_id = $${pi}::text`;
          cwParams.push(pipelineScopeId);
          pi++;
        }

        const cwResult = await query<{ closed_won_value: string }>(cwSQL, cwParams);
        const scopedClosedWon = Number(cwResult.rows[0]?.closed_won_value ?? 0);
        const targetAmount = brief.targets.headline?.amount ?? Number(targetRow?.amount ?? 0);

        (brief.targets as any).hasTarget = hasTarget;

        if (hasTarget && targetAmount > 0) {
          brief.targets.pctAttained = Math.round((scopedClosedWon / targetAmount) * 100);
          brief.targets.closedWonValue = scopedClosedWon;
          brief.targets.gap = Math.max(0, targetAmount - scopedClosedWon);
        } else if (!hasTarget) {
          brief.targets.pctAttained = null;
          brief.targets.closedWonValue = scopedClosedWon;
          brief.targets.gap = null;
        }

        if (pipelineFilter && brief.findings?.topFindings) {
          const dealIdsRes = await query<{ id: string }>(
            `SELECT id FROM deals WHERE workspace_id = $1 AND pipeline = $2`,
            [workspaceId, pipelineFilter]
          ).catch(() => ({ rows: [] as any[] }));
          const dealIdSet = new Set(dealIdsRes.rows.map((r: any) => r.id));
          const filtered = brief.findings.topFindings.filter((f: any) => {
            if (!f.dealId) return true;
            return dealIdSet.has(f.dealId);
          });
          brief.findings.topFindings = filtered;
        }
      } catch {
      }

      const temporal: TemporalContext = await computeTemporalContext(workspaceId);

      res.json({
        brief,
        temporal,
        generatedAt: new Date().toISOString(),
        workspaceId,
      });
    } catch (err: any) {
      console.error('[briefing] Error assembling concierge brief:', err);
      res.status(500).json({
        error: 'brief_assembly_failed',
        message: err.message || 'Failed to assemble opening brief',
      });
    }
  }
);

router.get(
  '/:workspaceId/briefing/pipelines',
  requireWorkspaceAccess,
  async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.params.workspaceId as string;

    try {
      const pipelinesRes = await query<{ pipeline: string }>(
        `SELECT DISTINCT pipeline FROM deals
         WHERE workspace_id = $1 AND pipeline IS NOT NULL
         ORDER BY pipeline`,
        [workspaceId]
      );

      const targetsRes = await query<{
        pipeline_name: string | null;
        pipeline_id: string | null;
        amount: string;
      }>(
        `SELECT pipeline_name, pipeline_id, amount FROM targets
         WHERE workspace_id = $1 AND is_active = true
           AND period_start <= CURRENT_DATE
           AND period_end >= CURRENT_DATE`,
        [workspaceId]
      );

      const targetMap = new Map<string, number>();
      for (const t of targetsRes.rows) {
        const key = t.pipeline_name || t.pipeline_id || 'All pipelines';
        targetMap.set(key, Number(t.amount));
      }

      const hasAnyTarget = targetsRes.rows.length > 0;
      const pipelines: Array<{
        name: string;
        value: string | null;
        hasTarget: boolean;
        targetAmount?: number;
      }> = [
        {
          name: 'All Data',
          value: null,
          hasTarget: hasAnyTarget,
          ...(hasAnyTarget ? { targetAmount: targetMap.values().next().value } : {}),
        },
      ];

      for (const row of pipelinesRes.rows) {
        const tAmount = targetMap.get(row.pipeline);
        pipelines.push({
          name: row.pipeline,
          value: row.pipeline,
          hasTarget: tAmount !== undefined,
          ...(tAmount !== undefined ? { targetAmount: tAmount } : {}),
        });
      }

      res.json({ pipelines });
    } catch (err: any) {
      console.error('[briefing] pipelines error:', err);
      res.status(500).json({ error: err.message || 'Failed to fetch pipelines' });
    }
  }
);

export default router;
