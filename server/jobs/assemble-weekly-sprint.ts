/**
 * Weekly Sprint Assembly
 * Runs Monday at 8:30 AM UTC, after all Monday skills complete.
 * Loads the monte-carlo action menu (if persisted) or generates synthetic
 * actions from standing hypotheses + open pipeline. Upserts top-7 sprint
 * actions for the current week.
 */

import { query } from '../db.js';

function startOfWeekMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getUTCDay(); // 0=Sun, 1=Mon
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

// Map action types to the hypothesis metric slugs they address
const ACTION_HYPOTHESIS_MAP: Record<string, string[]> = {
  're_engage_deal':    ['large_deal_win_rate', 'large_deal_cohort', 'conversion_rate'],
  'close_deal':        ['large_deal_win_rate', 'conversion_rate'],
  'generate_pipeline': ['pipeline_coverage_ratio', 'pipeline_coverage', 'conversion_rate'],
  'improve_lever':     ['conversion_rate', 'smb_sales_cycle_days', 'cycle_length'],
};

// Map hypothesis metrics to the action types that address them (reverse map)
const METRIC_ACTION_MAP: Record<string, Array<{ actionType: string; effort: string; label: (hyp: any, deals: any[]) => string }>> = {
  'conversion_rate': [
    {
      actionType: 'improve_lever',
      effort: 'this_week',
      label: (hyp, deals) => `Improve qualification rate — win rate at ${parseFloat(hyp.current_value).toFixed(0)}%, target ${parseFloat(hyp.alert_threshold).toFixed(0)}%`,
    },
    {
      actionType: 'close_deal',
      effort: 'this_week',
      label: (hyp, deals) => deals[0]
        ? `Accelerate close on ${deals[0].deal_name ?? 'top open deal'} ($${Math.round((deals[0].amount ?? 0) / 1000)}k)`
        : 'Accelerate close on top open deal this week',
    },
    {
      actionType: 'generate_pipeline',
      effort: 'this_week',
      label: (_hyp, _deals) => 'Generate net-new pipeline to lift expected conversion volume',
    },
    {
      actionType: 're_engage_deal',
      effort: 'this_week',
      label: (_hyp, deals) => deals[1]
        ? `Re-engage ${deals[1].deal_name ?? 'stalled deal'} — at risk of slipping quarter`
        : 'Re-engage stalled deals before quarter end',
    },
  ],
  'large_deal_win_rate': [
    {
      actionType: 're_engage_deal',
      effort: 'this_week',
      label: (_hyp, deals) => deals[0]
        ? `Re-engage ${deals[0].deal_name ?? 'at-risk enterprise deal'} to defend win rate`
        : 'Re-engage at-risk enterprise deals',
    },
    {
      actionType: 'close_deal',
      effort: 'this_week',
      label: (_hyp, deals) => deals[0]
        ? `Push ${deals[0].deal_name ?? 'largest open deal'} to close before quarter end`
        : 'Push largest open deal to close',
    },
  ],
  'large_deal_cohort': [
    {
      actionType: 're_engage_deal',
      effort: 'this_week',
      label: (_hyp, deals) => deals[0]
        ? `Re-engage ${deals[0].deal_name ?? 'stalled enterprise deal'} in large-deal cohort`
        : 'Re-engage stalled large-deal cohort',
    },
  ],
  'pipeline_coverage_ratio': [
    {
      actionType: 'generate_pipeline',
      effort: 'this_week',
      label: (hyp, _deals) => `Build net-new pipeline — coverage at ${parseFloat(hyp.current_value).toFixed(1)}x vs ${parseFloat(hyp.alert_threshold).toFixed(1)}x target`,
    },
  ],
  'pipeline_coverage': [
    {
      actionType: 'generate_pipeline',
      effort: 'this_week',
      label: (_hyp, _deals) => 'Run outbound sequences to increase pipeline coverage this week',
    },
  ],
  'smb_sales_cycle_days': [
    {
      actionType: 'improve_lever',
      effort: 'this_week',
      label: (hyp, _deals) => `Compress SMB sales cycle — currently ${Math.round(parseFloat(hyp.current_value))} days vs ${Math.round(parseFloat(hyp.alert_threshold))} day target`,
    },
  ],
  'cycle_length': [
    {
      actionType: 'improve_lever',
      effort: 'this_week',
      label: (hyp, _deals) => 'Identify and remove blockers extending deal cycle length',
    },
  ],
};

function findParentHypothesis(actionType: string, hypotheses: any[]): any | null {
  const metrics = ACTION_HYPOTHESIS_MAP[actionType] ?? [];
  if (metrics.length === 0) return null;
  return hypotheses.find(h => metrics.includes(h.metric)) ?? null;
}

function isThresholdBreached(hyp: any): boolean {
  if (hyp.current_value == null || hyp.alert_threshold == null) return false;
  const cur = parseFloat(hyp.current_value);
  const threshold = parseFloat(hyp.alert_threshold);
  if (hyp.alert_direction === 'below') return cur < threshold;
  if (hyp.alert_direction === 'above') return cur > threshold;
  return false;
}

function breachSeverity(hyp: any): number {
  if (!isThresholdBreached(hyp)) return 0;
  const cur = parseFloat(hyp.current_value);
  const threshold = parseFloat(hyp.alert_threshold);
  return Math.abs((threshold - cur) / threshold);
}

interface SyntheticAction {
  label: string;
  actionType: string;
  effort: string;
  rank: number;
  expectedValueIfDone: number | null;
  hypothesisId: string | null;
  severity: string;
}

async function generateSyntheticActionMenu(
  workspaceId: string,
  hypotheses: any[]
): Promise<SyntheticAction[]> {
  // Load top open deals by amount for label generation
  const dealsResult = await query(
    `SELECT id, deal_name, amount, stage_normalized, owner_email
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized NOT IN ('closed_won', 'closed_lost')
       AND amount > 0
     ORDER BY amount DESC
     LIMIT 10`,
    [workspaceId]
  ).catch(() => ({ rows: [] as any[] }));
  const topDeals = dealsResult.rows;

  const actions: SyntheticAction[] = [];
  let rank = 1;

  // Sort hypotheses: breached ones first, by breach severity
  const sorted = [...hypotheses].sort((a, b) => breachSeverity(b) - breachSeverity(a));

  for (const hyp of sorted) {
    const templates = METRIC_ACTION_MAP[hyp.metric] ?? [];
    if (templates.length === 0) continue;

    for (const tmpl of templates) {
      if (actions.length >= 7) break;

      const label = tmpl.label(hyp, topDeals);
      const alreadyAdded = actions.some(a => a.label === label);
      if (alreadyAdded) continue;

      const breached = isThresholdBreached(hyp);
      actions.push({
        label,
        actionType: tmpl.actionType,
        effort: tmpl.effort,
        rank,
        expectedValueIfDone: null,
        hypothesisId: hyp.id,
        severity: breached ? (rank <= 2 ? 'critical' : 'warning') : 'notable',
      });
      rank++;
    }
    if (actions.length >= 7) break;
  }

  return actions;
}

export async function assembleWeeklySprint(workspaceId: string): Promise<{
  inserted: number;
  updated: number;
  source: string;
  hypothesisIds: string[];
}> {
  const thisWeek = startOfWeekMonday(new Date());
  const weekStr = thisWeek.toISOString().split('T')[0];

  console.log(`[SprintAssembly] Assembling sprint for workspace=${workspaceId} week=${weekStr}`);

  // 1. Load active standing hypotheses (breached first)
  const hypothesesResult = await query(
    `SELECT * FROM standing_hypotheses
     WHERE workspace_id = $1 AND status = 'active'
     ORDER BY
       CASE WHEN current_value IS NOT NULL AND alert_threshold IS NOT NULL
            AND ((alert_direction = 'below' AND current_value::numeric < alert_threshold::numeric)
              OR (alert_direction = 'above' AND current_value::numeric > alert_threshold::numeric))
            THEN 0 ELSE 1 END,
       created_at ASC`,
    [workspaceId]
  );
  const hypotheses = hypothesesResult.rows;

  // 2. Try to load action menu from the latest monte-carlo skill run
  //    The output column stores { narrative } from the synthesis step.
  //    The allElseEqual action menu is not persisted there — fall through to synthetic.
  const mcResult = await query(
    `SELECT output FROM skill_runs
     WHERE workspace_id = $1 AND skill_id = 'monte-carlo-forecast'
       AND status = 'completed'
     ORDER BY completed_at DESC
     LIMIT 1`,
    [workspaceId]
  );

  let actionMenu: any[] = [];
  let source = 'synthetic';

  if (mcResult.rows[0]?.output) {
    const out = mcResult.rows[0].output;
    const fromOutput = out?.allElseEqual?.actionMenu ?? out?.actionMenu ?? [];
    if (fromOutput.length > 0) {
      actionMenu = fromOutput;
      source = 'monte_carlo';
    }
  }

  // 3. Fall back to hypothesis-driven synthetic actions if mc action menu missing
  if (actionMenu.length === 0 && hypotheses.length > 0) {
    const synth = await generateSyntheticActionMenu(workspaceId, hypotheses);
    actionMenu = synth.map(s => ({
      label: s.label,
      actionType: s.actionType,
      effort: s.effort,
      rank: s.rank,
      expectedValueIfDone: s.expectedValueIfDone,
      _hypothesisId: s.hypothesisId,
      _severity: s.severity,
    }));
  }

  let inserted = 0;
  let updated = 0;
  const linkedHypothesisIds = new Set<string>();

  // 4. Upsert top-7 actions with sprint week + hypothesis link
  for (const action of actionMenu.slice(0, 7)) {
    const parentHypothesis = action._hypothesisId
      ? hypotheses.find(h => h.id === action._hypothesisId) ?? null
      : findParentHypothesis(action.actionType, hypotheses);

    const rank = action.rank ?? 99;
    const severity = action._severity ?? (rank <= 2 ? 'critical' : rank <= 5 ? 'warning' : 'notable');

    const upsert = await query(
      `INSERT INTO actions (
         workspace_id, title, action_type, severity,
         expected_value_delta, effort, sprint_week,
         hypothesis_id, state, source_skill, execution_status,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, 'pending', 'monte-carlo-forecast', 'open', now(), now())
       ON CONFLICT (workspace_id, title, sprint_week) WHERE sprint_week IS NOT NULL
       DO UPDATE SET
         expected_value_delta = EXCLUDED.expected_value_delta,
         hypothesis_id = EXCLUDED.hypothesis_id,
         severity = EXCLUDED.severity,
         updated_at = now()
       RETURNING (xmax = 0) as was_inserted`,
      [
        workspaceId,
        action.label,
        action.actionType,
        severity,
        action.expectedValueIfDone ?? null,
        action.effort ?? 'this_week',
        weekStr,
        parentHypothesis?.id ?? null,
      ]
    );
    if (upsert.rows[0]?.was_inserted) inserted++;
    else updated++;

    if (parentHypothesis?.id) linkedHypothesisIds.add(parentHypothesis.id);
  }

  // 5. Promote threshold-breached hypotheses as sprint alerts if not already present
  for (const hyp of hypotheses) {
    if (!isThresholdBreached(hyp)) continue;

    const title = `Hypothesis alert: ${hyp.metric} ${hyp.alert_direction === 'below' ? 'below' : 'above'} threshold`;
    const existing = await query(
      `SELECT id FROM actions WHERE workspace_id = $1 AND title = $2 AND sprint_week = $3::date LIMIT 1`,
      [workspaceId, title, weekStr]
    );
    if (existing.rows.length > 0) continue;

    await query(
      `INSERT INTO actions (
         workspace_id, title, action_type, severity,
         sprint_week, hypothesis_id, state, source_skill, execution_status,
         created_at, updated_at
       ) VALUES ($1, $2, 'hypothesis_alert', 'warning', $3::date, $4, 'pending', 'standing-hypotheses', 'open', now(), now())`,
      [workspaceId, title, weekStr, hyp.id]
    );
    inserted++;
    linkedHypothesisIds.add(hyp.id);
  }

  console.log(`[SprintAssembly] Done: source=${source}, ${inserted} inserted, ${updated} updated, hypotheses=${[...linkedHypothesisIds].join(',')}`);
  return { inserted, updated, source, hypothesisIds: [...linkedHypothesisIds] };
}
