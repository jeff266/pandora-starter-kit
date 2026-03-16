import { Router, Request, Response, NextFunction } from 'express';
import { generateGreeting } from '../briefing/greeting-engine.js';
import { buildConciergeGreeting } from '../briefing/concierge-greeting.js';
import { getOperatorStatuses } from '../briefing/operator-status.js';
import { query } from '../db.js';
import { getPandoraRole, type PandolaRole } from '../context/pandora-role.js';
import {
  computeTemporalContext,
  assembleOpeningBrief,
  getOrAssembleBrief,
  logBriefInteraction,
  type BriefInteraction,
  type OpeningBriefData,
  type TemporalContext,
} from '../context/opening-brief.js';
import { requireWorkspaceAccess } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';

const router = Router();

// ===== BRIEF SESSION STORE =====
// Short-lived in-memory store keyed by sessionId.
// Captures brief context at generation time so the interaction endpoint
// can merge server-side context (role, phase, findings_shown) with
// client-reported signals (cards clicked, time on brief, etc.).
// 1-hour TTL — ephemeral only, never persisted.

interface BriefSessionSnapshot {
  workspaceId: string;
  userId: string;
  pandoraRole: string | null;
  quarterPhase: string | null;
  attainmentPct: number | null;
  daysRemaining: number | null;
  findingsShown: unknown;
  bigDealsShown: unknown;
  expiresAt: number;
}

const BRIEF_SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const briefSessionStore = new Map<string, BriefSessionSnapshot>();

function pruneExpiredSessions(): void {
  const now = Date.now();
  for (const [key, val] of briefSessionStore.entries()) {
    if (val.expiresAt <= now) briefSessionStore.delete(key);
  }
}

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

router.get(
  '/:workspaceId/briefing/concierge-greeting',
  requireWorkspaceAccess,
  async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.params.workspaceId as string;
    const userId = (req as any).user?.user_id as string;
    try {
      const brief = await getOrAssembleBrief(workspaceId, userId);
      const pandoraRole = (brief?.user?.pandoraRole ?? null) as PandolaRole | null;
      const greeting = await buildConciergeGreeting(workspaceId, pandoraRole, {
        temporal: (brief?.temporal ?? null) as Record<string, unknown> | null,
        targets: (brief?.targets ?? null) as Record<string, unknown> | null,
      });
      res.json({ greeting });
    } catch (err: any) {
      console.error('[briefing] concierge-greeting error:', err?.message);
      res.json({ greeting: null });
    }
  }
);

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
    const rawPipeline = (req.query.pipeline as string | undefined) || null;
    const pipelineFilter = rawPipeline === 'All Data' ? null : rawPipeline;
    const sessionId = (req.query.sessionId as string | undefined) ?? null;

    try {
      const brief: OpeningBriefData = refresh
        ? await assembleOpeningBrief(workspaceId, userId)
        : await getOrAssembleBrief(workspaceId, userId);

      let hasTarget = false;
      try {
        interface TargetRow {
          amount: string;
          pipeline_id: string | null;
          pipeline_name: string | null;
          period_start: string | null;
          period_end: string | null;
        }

        let targetRow: TargetRow | null = null;

        if (pipelineFilter) {
          const pipelineScopedResult = await query<TargetRow>(
            `SELECT amount, pipeline_id, pipeline_name, period_start, period_end
             FROM targets
             WHERE workspace_id = $1 AND is_active = true
               AND period_start <= CURRENT_DATE
               AND period_end >= CURRENT_DATE
               AND (pipeline_name = $2 OR pipeline_id = $2)
             ORDER BY period_start DESC NULLS LAST
             LIMIT 1`,
            [workspaceId, pipelineFilter]
          ).catch(() => ({ rows: [] as TargetRow[] }));
          targetRow = pipelineScopedResult.rows[0] ?? null;
        } else {
          const globalResult = await query<TargetRow>(
            `SELECT amount, pipeline_id, pipeline_name, period_start, period_end
             FROM targets
             WHERE workspace_id = $1 AND is_active = true
               AND period_start <= CURRENT_DATE
               AND period_end >= CURRENT_DATE
             ORDER BY period_start DESC NULLS LAST
             LIMIT 1`,
            [workspaceId]
          ).catch(() => ({ rows: [] as TargetRow[] }));
          targetRow = globalResult.rows[0] ?? null;
        }

        hasTarget = !!targetRow;
        const periodStart = targetRow?.period_start ? new Date(targetRow.period_start) : null;
        const periodEnd = targetRow?.period_end ? new Date(targetRow.period_end) : null;
        const targetPipeline = targetRow?.pipeline_id || targetRow?.pipeline_name || null;

        let pipelineScopeId: string | null = null;
        if (targetPipeline) {
          const sr = await query<{ scope_id: string }>(
            `SELECT scope_id FROM analysis_scopes
             WHERE workspace_id = $1 AND (name = $2 OR scope_id = $2) LIMIT 1`,
            [workspaceId, targetPipeline]
          ).catch(() => ({ rows: [] as { scope_id: string }[] }));
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
        const targetAmount = targetRow ? Number(targetRow.amount ?? 0) : (brief.targets.headline?.amount ?? 0);

        if (hasTarget && targetAmount > 0) {
          brief.targets.pctAttained = Math.round((scopedClosedWon / targetAmount) * 100);
          brief.targets.closedWonValue = scopedClosedWon;
          brief.targets.gap = Math.max(0, targetAmount - scopedClosedWon);
        } else {
          brief.targets.pctAttained = null;
          brief.targets.closedWonValue = scopedClosedWon;
          brief.targets.gap = null;
        }

        if (pipelineFilter) {
          const pipeMetrics = await query<{
            total_value: string;
            deal_count: string;
            weighted_value: string;
          }>(
            `SELECT
               COALESCE(SUM(amount), 0)::numeric as total_value,
               COUNT(*)::text as deal_count,
               COALESCE(SUM(amount * COALESCE(probability, 0)), 0)::numeric as weighted_value
             FROM deals
             WHERE workspace_id = $1
               AND stage_normalized NOT IN ('closed_won', 'closed_lost')
               AND pipeline = $2`,
            [workspaceId, pipelineFilter]
          );
          const pm = pipeMetrics.rows[0];
          if (pm) {
            brief.pipeline.totalValue = Number(pm.total_value);
            brief.pipeline.dealCount = Number(pm.deal_count);
            brief.pipeline.weightedValue = Number(pm.weighted_value);
            const gapForCoverage = hasTarget && targetAmount > 0
              ? Math.max(0, targetAmount - scopedClosedWon)
              : targetAmount;
            brief.pipeline.coverageRatio = gapForCoverage > 0
              ? Math.round((Number(pm.weighted_value) / gapForCoverage) * 10) / 10
              : 0;
          }

          if (brief.findings) {
            const dealIdsRes = await query<{ id: string }>(
              `SELECT id FROM deals WHERE workspace_id = $1 AND pipeline = $2`,
              [workspaceId, pipelineFilter]
            ).catch(() => ({ rows: [] as { id: string }[] }));
            const dealIdSet = new Set(dealIdsRes.rows.map((r) => r.id));

            if (brief.findings.topFindings) {
              brief.findings.topFindings = brief.findings.topFindings.filter((f) => {
                if (!(f as Record<string, unknown>).dealId) return true;
                return dealIdSet.has((f as Record<string, unknown>).dealId as string);
              });
            }

            const scopedCounts = await query<{ severity: string; cnt: string }>(
              `SELECT severity, COUNT(*)::text as cnt
               FROM findings
               WHERE workspace_id = $1 AND deal_id = ANY($2::text[])
                 AND status = 'open'
               GROUP BY severity`,
              [workspaceId, Array.from(dealIdSet)]
            ).catch(() => ({ rows: [] as { severity: string; cnt: string }[] }));

            let critical = 0;
            let warning = 0;
            for (const r of scopedCounts.rows) {
              if (r.severity === 'critical' || r.severity === 'high') critical += Number(r.cnt);
              else if (r.severity === 'warning' || r.severity === 'medium') warning += Number(r.cnt);
            }
            brief.findings.critical = critical;
            brief.findings.warning = warning;
          }
        }
      } catch (scopeErr) {
        console.error('[briefing] concierge target/metric scoping error:', scopeErr);
      }

      const temporal: TemporalContext = await computeTemporalContext(workspaceId);

      interface SkillRunRow { skill_id: string; status: string; started_at: string; completed_at: string | null }
      interface CountRow { cnt: string }
      interface RecentActionRow { title: string; action_type: string; executed_at: string }
      const emptySkillRows: { rows: SkillRunRow[] } = { rows: [] };
      const zeroCount: { rows: CountRow[] } = { rows: [{ cnt: '0' }] };
      const emptyActionRows: { rows: RecentActionRow[] } = { rows: [] };

      const [overnightSkills, overnightFindings, pendingCount, executedCount, recentExecuted] = await Promise.all([
        query<SkillRunRow>(
          `SELECT skill_id, status, started_at, completed_at
           FROM skill_runs
           WHERE workspace_id = $1 AND status = 'completed'
             AND started_at > now() - interval '48 hours'
           ORDER BY completed_at DESC`,
          [workspaceId]
        ).catch(() => emptySkillRows),

        query<CountRow>(
          `SELECT COUNT(*)::text as cnt
           FROM findings
           WHERE workspace_id = $1 AND found_at > now() - interval '48 hours'`,
          [workspaceId]
        ).catch(() => zeroCount),

        query<CountRow>(
          `SELECT COUNT(*)::text as cnt
           FROM actions
           WHERE workspace_id = $1 AND approval_status = 'pending'
             AND execution_status = 'open'
             AND created_at > now() - interval '48 hours'`,
          [workspaceId]
        ).catch(() => zeroCount),

        query<CountRow>(
          `SELECT COUNT(*)::text as cnt
           FROM actions
           WHERE workspace_id = $1 AND execution_status = 'executed'
             AND executed_at > now() - interval '48 hours'
             AND executed_by = 'system'`,
          [workspaceId]
        ).catch(() => zeroCount),

        query<RecentActionRow>(
          `SELECT title, action_type, executed_at
           FROM actions
           WHERE workspace_id = $1 AND execution_status = 'executed'
             AND executed_at > now() - interval '48 hours'
             AND executed_by = 'system'
           ORDER BY executed_at DESC
           LIMIT 5`,
          [workspaceId]
        ).catch(() => emptyActionRows),
      ]);

      const overnightSummary = {
        skillsRun: overnightSkills.rows.length,
        findingsSurfaced: Number(overnightFindings.rows[0]?.cnt ?? 0),
        autonomousActionsCompleted: Number(executedCount.rows[0]?.cnt ?? 0),
        pendingApprovalCount: Number(pendingCount.rows[0]?.cnt ?? 0),
        recentActions: recentExecuted.rows.map(r => ({
          title: r.title,
          actionType: r.action_type,
          executedAt: r.executed_at,
        })),
        lastRunAt: overnightSkills.rows[0]?.completed_at ?? null,
      };

      // Store brief context snapshot for the interaction endpoint to merge
      if (sessionId) {
        pruneExpiredSessions();
        briefSessionStore.set(sessionId, {
          workspaceId,
          userId,
          pandoraRole: brief.user.pandoraRole ?? null,
          quarterPhase: temporal.quarterPhase ?? null,
          attainmentPct: brief.targets.pctAttained ?? null,
          daysRemaining: temporal.daysRemainingInQuarter ?? null,
          findingsShown: brief.findings.topFindings.map((f, i) => ({
            rank: i + 1,
            skill_id: f.skillName,
            amount: null,
          })),
          bigDealsShown: (brief.bigDealsAtRisk ?? []).map(d => ({
            id: d.id,
            deal_name: d.name,
            amount: d.amount,
            rfm_grade: d.rfmGrade,
            days_cold: d.daysSinceActivity,
          })),
          expiresAt: Date.now() + BRIEF_SESSION_TTL_MS,
        });
      }

      res.json({
        brief: { ...brief, targets: { ...brief.targets, hasTarget } },
        temporal,
        overnightSummary,
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
      let workspaceWideTarget: number | null = null;
      for (const t of targetsRes.rows) {
        const key = t.pipeline_name || t.pipeline_id || null;
        if (!key || key === 'All pipelines') {
          workspaceWideTarget = Number(t.amount);
        } else {
          targetMap.set(key, Number(t.amount));
        }
      }

      const pipelines: Array<{
        name: string;
        value: string | null;
        hasTarget: boolean;
        targetAmount?: number;
      }> = [
        {
          name: 'All Data',
          value: null,
          hasTarget: workspaceWideTarget !== null || targetsRes.rows.length > 0,
          ...(workspaceWideTarget !== null ? { targetAmount: workspaceWideTarget } : {}),
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

// ===== BRIEF INTERACTION ENDPOINT =====
// POST /:workspaceId/briefing/interaction
//
// Records behavioral signals from a Concierge session.
// userId is always taken from the authenticated session (req.user),
// never from the request body. The session store supplies server-side
// context (role, phase, findings_shown) that the client cannot forge.
//
// FRONTEND TODO (next session):
//   Call this endpoint:
//   - When a card is clicked           → cardsDrilledInto
//   - When a math modal is opened      → mathModalsOpened
//   - When an action is approved       → actionsApproved
//   - When an action is seen but skipped → actionsIgnored
//   - When Ask Pandora is used after brief → followUpQuestions
//   - On page unload with elapsed time → timeOnBriefSeconds

router.post(
  '/:workspaceId/briefing/interaction',
  requireWorkspaceAccess,
  async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.params.workspaceId as string;
    const userId = (req as any).user?.user_id as string;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const {
      sessionId,
      cardsDrilledInto,
      mathModalsOpened,
      actionsApproved,
      actionsIgnored,
      followUpQuestions,
      timeOnBriefSeconds,
      returnedWithinHour,
    } = req.body as {
      sessionId?: string;
      cardsDrilledInto?: string[];
      mathModalsOpened?: string[];
      actionsApproved?: string[];
      actionsIgnored?: string[];
      followUpQuestions?: string[];
      timeOnBriefSeconds?: number;
      returnedWithinHour?: boolean;
    };

    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }

    // Retrieve server-side context snapshot (populated at brief generation time).
    // Verify the snapshot belongs to this workspace — prevents a user from one
    // workspace poisoning interaction logs with another workspace's session context.
    const rawSnapshot = briefSessionStore.get(sessionId);
    const snapshot = rawSnapshot?.workspaceId === workspaceId ? rawSnapshot : undefined;

    // Infer brief relevance: user acted on something the brief surfaced
    const briefWasRelevant = Array.isArray(cardsDrilledInto) && cardsDrilledInto.length > 0
      ? true
      : Array.isArray(followUpQuestions) && followUpQuestions.length > 0
        ? null  // asked questions — ambiguous signal
        : null;

    // Non-blocking — fire and forget
    void logBriefInteraction({
      workspace_id: workspaceId,
      user_id: userId,
      session_id: sessionId,
      pandora_role: snapshot?.pandoraRole ?? undefined,
      quarter_phase: snapshot?.quarterPhase ?? undefined,
      attainment_pct: snapshot?.attainmentPct ?? null,
      days_remaining: snapshot?.daysRemaining ?? null,
      findings_shown: snapshot?.findingsShown ?? undefined,
      big_deals_shown: snapshot?.bigDealsShown ?? undefined,
      cards_drilled_into: cardsDrilledInto,
      math_modals_opened: mathModalsOpened,
      actions_approved: actionsApproved,
      actions_ignored: actionsIgnored,
      follow_up_questions: followUpQuestions,
      time_on_brief_seconds: timeOnBriefSeconds ?? null,
      returned_within_hour: returnedWithinHour ?? false,
      brief_was_relevant: briefWasRelevant,
    } satisfies Partial<BriefInteraction>);

    res.json({ ok: true });
  }
);

// ===== FINDING PREFERENCE ENDPOINTS =====
// Watch / Dismiss signals from the Concierge brief card buttons.
// Persisted per user per finding so they survive page reloads and cache refreshes.

router.post(
  '/:workspaceId/briefing/findings/:findingId/preference',
  requireWorkspaceAccess,
  async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.params.workspaceId as string;
    const findingId   = req.params.findingId   as string;
    const userId      = (req as any).user?.user_id as string;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { preference } = req.body as { preference?: string };
    if (preference !== 'watch' && preference !== 'dismissed') {
      res.status(400).json({ error: 'preference must be "watch" or "dismissed"' });
      return;
    }

    const expiresAt = preference === 'dismissed'
      ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      : null;

    try {
      await query(
        `INSERT INTO finding_preferences (workspace_id, user_id, finding_id, preference, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (workspace_id, user_id, finding_id)
         DO UPDATE SET preference = EXCLUDED.preference,
                       expires_at = EXCLUDED.expires_at`,
        [workspaceId, userId, findingId, preference, expiresAt]
      );
      res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[briefing] preference upsert error:', msg);
      res.status(500).json({ error: msg });
    }
  }
);

router.delete(
  '/:workspaceId/briefing/findings/:findingId/preference',
  requireWorkspaceAccess,
  async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.params.workspaceId as string;
    const findingId   = req.params.findingId   as string;
    const userId      = (req as any).user?.user_id as string;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      await query(
        `DELETE FROM finding_preferences
         WHERE workspace_id = $1 AND user_id = $2 AND finding_id = $3`,
        [workspaceId, userId, findingId]
      );
      res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[briefing] preference delete error:', msg);
      res.status(500).json({ error: msg });
    }
  }
);

// ── POST /:workspaceId/briefing/send-slack ─────────────────────────────────
// Manual trigger for the Concierge daily brief push. Admin-only.
// Useful for testing before the 8:15 AM UTC cron fires.
router.post(
  '/:workspaceId/briefing/send-slack',
  requireWorkspaceAccess,
  async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.params.workspaceId as string;
    const userId = (req as any).user?.user_id as string;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Admin-only gate
    const roleResult = await query<{ pandora_role: string }>(
      `SELECT pandora_role FROM workspace_members
       WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'
       LIMIT 1`,
      [workspaceId, userId]
    ).catch(() => ({ rows: [] as any[] }));

    const role = roleResult.rows[0]?.pandora_role;
    if (role !== 'admin') {
      res.status(403).json({ error: 'Admin role required to trigger Slack brief' });
      return;
    }

    try {
      const { sendConciergeSlackBrief } = await import('../slack/concierge-push.js');
      await sendConciergeSlackBrief(workspaceId);
      res.json({ ok: true, message: 'Brief sent to Slack' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[briefing] send-slack error:', msg);
      res.status(500).json({ error: msg });
    }
  }
);

export default router;

