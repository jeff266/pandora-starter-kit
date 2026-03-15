/**
 * Weekly Sprint Assembly
 * Runs Monday at 8:30 AM UTC. Generates 5-7 specific, deal-aware sprint
 * actions for the week. Each title names a deal, rep, or metric so a
 * RevOps lead can act without a follow-up question.
 */

import { query } from '../db.js';

function startOfWeekMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

// Map action types → the hypothesis metrics they address
const ACTION_HYPOTHESIS_MAP: Record<string, string[]> = {
  're_engage_deal':    ['large_deal_win_rate', 'large_deal_cohort', 'conversion_rate'],
  'close_deal':        ['large_deal_win_rate', 'conversion_rate'],
  'generate_pipeline': ['pipeline_coverage_ratio', 'pipeline_coverage', 'conversion_rate'],
  'improve_lever':     ['conversion_rate', 'smb_sales_cycle_days', 'cycle_length'],
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

interface SprintAction {
  title: string;
  actionType: string;
  effort: string;
  rank: number;
  severity: string;
  hypothesisId: string | null;
  targetDealId: string | null;
  expectedValueDelta: number | null;
  metadata?: Record<string, any> | null;
}

/**
 * Build specific re-engage actions for deals that have gone silent.
 * Targets high-value deals with no activity in >10 days.
 */
async function buildReEngageActions(
  workspaceId: string,
  hypotheses: any[],
  maxCount: number
): Promise<SprintAction[]> {
  const hyp = findParentHypothesis('re_engage_deal', hypotheses);

  const res = await query(
    `SELECT id, name, amount, stage_normalized, owner, last_activity_date,
            ROUND(EXTRACT(EPOCH FROM (NOW() - last_activity_date)) / 86400) AS days_silent
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized NOT IN ('closed_won', 'closed_lost')
       AND amount >= 5000
       AND last_activity_date < NOW() - INTERVAL '10 days'
     ORDER BY amount DESC
     LIMIT $2`,
    [workspaceId, maxCount]
  ).catch(() => ({ rows: [] as any[] }));

  return res.rows.map((d, i) => {
    const daysSilent = parseInt(d.days_silent ?? '0', 10);
    const ownerFirst = (d.owner ?? '').split(' ')[0] || d.owner;
    return {
      title: `Re-engage ${d.name} — ${fmt$(d.amount)}, ${daysSilent} days silent, ${ownerFirst}`,
      actionType: 're_engage_deal',
      effort: 'this_week',
      rank: i + 1,
      severity: i === 0 ? 'critical' : 'warning',
      hypothesisId: hyp?.id ?? null,
      targetDealId: d.id,
      expectedValueDelta: Math.round(parseFloat(d.amount) * 0.25),
    };
  });
}

/**
 * Build close-deal actions for high-value deals approaching their close date.
 * Targets deals in evaluation/decision/negotiation stages.
 */
async function buildCloseActions(
  workspaceId: string,
  hypotheses: any[],
  maxCount: number,
  excludeIds: string[]
): Promise<SprintAction[]> {
  const hyp = findParentHypothesis('close_deal', hypotheses);

  // Exclude IDs already used by re_engage actions
  const excludeClause = excludeIds.length > 0
    ? `AND id NOT IN (${excludeIds.map((_, i) => `$${i + 3}`).join(',')})`
    : '';

  const res = await query(
    `SELECT id, name, amount, stage_normalized, owner, close_date,
            ROUND(EXTRACT(EPOCH FROM (close_date::timestamp - NOW())) / 86400) AS days_to_close
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized IN ('evaluation', 'proposal', 'negotiation', 'decision')
       AND amount >= 5000
       AND close_date BETWEEN NOW() AND NOW() + INTERVAL '60 days'
       ${excludeClause}
     ORDER BY amount DESC
     LIMIT $2`,
    [workspaceId, maxCount, ...excludeIds]
  ).catch(() => ({ rows: [] as any[] }));

  return res.rows.map((d, i) => {
    const daysToClose = parseInt(d.days_to_close ?? '30', 10);
    const stage = (d.stage_normalized ?? '').replace(/_/g, ' ');
    const ownerFirst = (d.owner ?? '').split(' ')[0] || d.owner;
    const urgency = daysToClose <= 7 ? 'critical' : 'warning';

    return {
      title: `Push ${d.name} to close — ${fmt$(d.amount)}, ${stage}, ${daysToClose}d, ${ownerFirst}`,
      actionType: 'close_deal',
      effort: 'this_week',
      rank: i + 1,
      severity: urgency,
      hypothesisId: hyp?.id ?? null,
      targetDealId: d.id,
      expectedValueDelta: Math.round(parseFloat(d.amount) * 0.5),
    };
  });
}

/**
 * Build a generate_pipeline action naming reps who are below their pipeline
 * average or significantly below the team median.
 */
async function buildPipelineAction(
  workspaceId: string,
  hypotheses: any[]
): Promise<SprintAction[]> {
  const hyp = findParentHypothesis('generate_pipeline', hypotheses);

  const res = await query(
    `SELECT owner,
            COUNT(*) AS deal_count,
            SUM(amount) AS pipeline_total
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized NOT IN ('closed_won', 'closed_lost')
       AND amount > 0
     GROUP BY owner
     ORDER BY pipeline_total ASC`,
    [workspaceId]
  ).catch(() => ({ rows: [] as any[] }));

  if (res.rows.length < 2) return [];

  const totals = res.rows.map(r => parseFloat(r.pipeline_total));
  const teamMedian = totals[Math.floor(totals.length / 2)];
  const lowReps = res.rows
    .filter(r => parseFloat(r.pipeline_total) < teamMedian * 0.6 && r.owner)
    .slice(0, 3);

  if (lowReps.length === 0) return [];

  const names = lowReps
    .map(r => `${r.owner.split(' ')[0]} (${fmt$(parseFloat(r.pipeline_total))})`)
    .join(', ');

  return [{
    title: `${lowReps.length} rep${lowReps.length > 1 ? 's' : ''} below pipeline target: ${names}`,
    actionType: 'generate_pipeline',
    effort: 'this_week',
    rank: 1,
    severity: 'warning',
    hypothesisId: hyp?.id ?? null,
    targetDealId: null,
    expectedValueDelta: null,
  }];
}

/**
 * Build an improve_lever action from the conversion_rate hypothesis value
 * and count of late-stage deals that need qualification attention.
 */
async function buildImproveAction(
  workspaceId: string,
  hypotheses: any[]
): Promise<SprintAction[]> {
  const hyp = hypotheses.find(h => h.metric === 'conversion_rate')
    ?? findParentHypothesis('improve_lever', hypotheses);

  // Count late-stage deals closing within 60 days that need attention
  const res = await query(
    `SELECT COUNT(*) as cnt,
            STRING_AGG(DISTINCT owner, ', ' ORDER BY owner) as owners
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized IN ('evaluation', 'proposal', 'negotiation', 'decision')
       AND close_date BETWEEN NOW() AND NOW() + INTERVAL '60 days'
       AND amount >= 5000`,
    [workspaceId]
  ).catch(() => ({ rows: [{ cnt: '0', owners: '' }] }));

  const cnt = parseInt(res.rows[0]?.cnt ?? '0', 10);
  const owners = (res.rows[0]?.owners ?? '').split(', ').slice(0, 2).join(', ');

  const currentRate = hyp?.current_value ? Math.round(parseFloat(hyp.current_value)) : null;
  const targetRate = hyp?.alert_threshold ? Math.round(parseFloat(hyp.alert_threshold)) : null;

  let title: string;
  if (currentRate !== null && targetRate !== null) {
    title = cnt > 0
      ? `Win rate ${currentRate}% vs ${targetRate}% target — ${cnt} late-stage deal${cnt !== 1 ? 's' : ''} need${cnt === 1 ? 's' : ''} attention (${owners})`
      : `Win rate ${currentRate}% vs ${targetRate}% target — review pipeline conversion this week`;
  } else {
    title = cnt > 0
      ? `${cnt} late-stage deals closing within 60 days need qualification review (${owners})`
      : 'Review pipeline conversion rate this week';
  }

  return [{
    title,
    actionType: 'improve_lever',
    effort: 'this_week',
    rank: 1,
    severity: hyp && isThresholdBreached(hyp) ? 'critical' : 'warning',
    hypothesisId: hyp?.id ?? null,
    targetDealId: null,
    expectedValueDelta: null,
  }];
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

  // 2. Build deal-specific sprint actions
  const reEngageActions = await buildReEngageActions(workspaceId, hypotheses, 2);
  const usedDealIds = reEngageActions.map(a => a.targetDealId).filter(Boolean) as string[];

  const closeActions = await buildCloseActions(workspaceId, hypotheses, 2, usedDealIds);
  const pipelineActions = await buildPipelineAction(workspaceId, hypotheses);
  const improveActions = await buildImproveAction(workspaceId, hypotheses);

  // 3. Merge and rank (re-engage → close → improve_lever → generate_pipeline)
  const allActions: SprintAction[] = [
    ...reEngageActions,
    ...closeActions,
    ...improveActions,
    ...pipelineActions,
  ].slice(0, 7);

  // 4. Re-rank
  allActions.forEach((a, i) => { a.rank = i + 1; });

  let inserted = 0;
  let updated = 0;
  const linkedHypothesisIds = new Set<string>();

  for (const action of allActions) {
    const upsert = await query(
      `INSERT INTO actions (
         workspace_id, title, action_type, severity,
         expected_value_delta, effort, sprint_week,
         hypothesis_id, target_deal_id, state, source_skill, execution_status,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, 'pending', 'monte-carlo-forecast', 'open', now(), now())
       ON CONFLICT (workspace_id, title, sprint_week) WHERE sprint_week IS NOT NULL
       DO UPDATE SET
         expected_value_delta = EXCLUDED.expected_value_delta,
         hypothesis_id = EXCLUDED.hypothesis_id,
         target_deal_id = EXCLUDED.target_deal_id,
         severity = EXCLUDED.severity,
         updated_at = now()
       RETURNING (xmax = 0) as was_inserted`,
      [
        workspaceId,
        action.title,
        action.actionType,
        action.severity,
        action.expectedValueDelta,
        action.effort,
        weekStr,
        action.hypothesisId,
        action.targetDealId,
      ]
    );
    if (upsert.rows[0]?.was_inserted) inserted++;
    else updated++;

    if (action.hypothesisId) linkedHypothesisIds.add(action.hypothesisId);
  }

  console.log(`[SprintAssembly] Done: ${inserted} inserted, ${updated} updated, hypotheses=${[...linkedHypothesisIds].join(',')}`);
  return { inserted, updated, source: 'deal_aware', hypothesisIds: [...linkedHypothesisIds] };
}
