/**
 * Pipeline Movement Analysis
 *
 * Week-over-week pipeline delta: what changed, what moved,
 * how fast stages are flowing, and whether the trend is up or down.
 *
 * All functions are pure SQL — zero LLM calls.
 * Called by the pipeline-movement skill compute steps.
 */

import { query } from '../db.js';

// ============================================================================
// Stage rank (shared with stage-history-queries.ts)
// ============================================================================

const STAGE_ORDER: Record<string, number> = {
  lead:        1,
  qualified:   2,
  discovery:   3,
  evaluation:  4,
  proposal:    5,
  negotiation: 6,
  decision:    7,
  closed_won:  8,
  closed_lost: 9,
};

function stageRank(stage: string | null | undefined): number {
  if (!stage) return 0;
  return STAGE_ORDER[stage.toLowerCase()] ?? 0;
}

// ============================================================================
// Types
// ============================================================================

export interface StageSnapshot {
  stage: string;
  dealCount: number;
  totalValue: number;
  avgDealSize: number;
  healthyCount: number;
  atRiskCount: number;
}

export interface PipelineSnapshot {
  byStage: StageSnapshot[];
  totalValue: number;
  totalCount: number;
  weightedValue: number;
  healthyCount: number;
  atRiskCount: number;
}

export interface TopDeal {
  id: string;
  name: string;
  amount: number;
  owner: string;
  fromStage: string | null;
  toStage: string | null;
  daysInStage: number;
}

export interface DealMovementBucket {
  count: number;
  totalValue: number;
  deals: TopDeal[];
}

export interface DealMovements {
  advanced:    DealMovementBucket;
  fell_back:   DealMovementBucket;
  closed_won:  DealMovementBucket;
  closed_lost: DealMovementBucket;
  new_entry:   DealMovementBucket;
  stalled:     DealMovementBucket;
}

export interface StageVelocityDelta {
  stage: string;
  avgDaysThisWeek: number | null;
  historicalAvg: number | null;
  sampleSize: number;
  signal: 'accelerating' | 'slowing' | 'normal' | 'no_data';
}

export interface NetDelta {
  pipelineValueDelta: number;
  pipelineValueDeltaPct: number;
  dealsAdded: number;
  dealsLost: number;
  netDealChange: number;
  coverageRatioNow: number | null;
  coverageRatioLastWeek: number | null;
  coverageTrend: 'improving' | 'declining' | 'stable';
  gapToTarget: number | null;
  weeksRemainingInQuarter: number | null;
  onTrack: boolean;
  healthyDealCount: number;
  atRiskDealCount: number;
  healthTrend: 'improving' | 'declining' | 'stable';
  anomalies: string[];
}

export interface TrendRun {
  createdAt: string;
  totalOpenValue: number | null;
  coverageRatio: number | null;
  closedWonValue: number | null;
  newEntryValue: number | null;
}

export interface PipelineTrend {
  available: boolean;
  message: string | null;
  runCount: number;
  runs: TrendRun[];
  isCoverageImproving: boolean | null;
  isNewPipelineConsistent: boolean | null;
  isLossRateIncreasing: boolean | null;
}

// ============================================================================
// Step 2: Current pipeline snapshot
// ============================================================================

export async function computePipelineSnapshotNow(
  workspaceId: string
): Promise<PipelineSnapshot> {
  const [byStageResult, totalsResult] = await Promise.all([
    query<{
      stage_normalized: string;
      deal_count: string;
      total_value: string;
      avg_deal_size: string;
      healthy_count: string;
      at_risk_count: string;
    }>(`
      SELECT
        COALESCE(stage_normalized, 'unknown') AS stage_normalized,
        COUNT(*)::int AS deal_count,
        COALESCE(SUM(amount), 0)::numeric AS total_value,
        COALESCE(AVG(amount), 0)::numeric AS avg_deal_size,
        COUNT(CASE WHEN rfm_grade IN ('A','B') THEN 1 END)::int AS healthy_count,
        COUNT(CASE WHEN rfm_grade IN ('D','F') THEN 1 END)::int AS at_risk_count
      FROM deals
      WHERE workspace_id = $1
        AND COALESCE(stage_normalized, '') NOT IN ('closed_won', 'closed_lost')
      GROUP BY stage_normalized
      ORDER BY MIN(
        CASE stage_normalized
          WHEN 'lead'        THEN 1
          WHEN 'qualified'   THEN 2
          WHEN 'discovery'   THEN 3
          WHEN 'evaluation'  THEN 4
          WHEN 'proposal'    THEN 5
          WHEN 'negotiation' THEN 6
          WHEN 'decision'    THEN 7
          ELSE 99
        END
      )
    `, [workspaceId]),

    query<{
      total_count: string;
      total_value: string;
      weighted_value: string;
      healthy_count: string;
      at_risk_count: string;
    }>(`
      SELECT
        COUNT(*)::int AS total_count,
        COALESCE(SUM(amount), 0)::numeric AS total_value,
        COALESCE(SUM(amount * COALESCE(probability, 50) / 100.0), 0)::numeric AS weighted_value,
        COUNT(CASE WHEN rfm_grade IN ('A','B') THEN 1 END)::int AS healthy_count,
        COUNT(CASE WHEN rfm_grade IN ('D','F') THEN 1 END)::int AS at_risk_count
      FROM deals
      WHERE workspace_id = $1
        AND COALESCE(stage_normalized, '') NOT IN ('closed_won', 'closed_lost')
    `, [workspaceId]),
  ]);

  const t = totalsResult.rows[0];

  return {
    byStage: byStageResult.rows.map(r => ({
      stage:        r.stage_normalized,
      dealCount:    parseInt(r.deal_count, 10),
      totalValue:   parseFloat(r.total_value),
      avgDealSize:  parseFloat(r.avg_deal_size),
      healthyCount: parseInt(r.healthy_count, 10),
      atRiskCount:  parseInt(r.at_risk_count, 10),
    })),
    totalValue:   parseFloat(t?.total_value   ?? '0'),
    totalCount:   parseInt(t?.total_count     ?? '0', 10),
    weightedValue: parseFloat(t?.weighted_value ?? '0'),
    healthyCount: parseInt(t?.healthy_count   ?? '0', 10),
    atRiskCount:  parseInt(t?.at_risk_count   ?? '0', 10),
  };
}

// ============================================================================
// Step 3: Last-week pipeline snapshot (reconstructed from stage history)
// ============================================================================

export async function computePipelineSnapshotLastWeek(
  workspaceId: string
): Promise<PipelineSnapshot> {
  // Reconstruct each deal's stage as of 7 days ago
  const result = await query<{
    stage_last_week: string;
    deal_count: string;
    total_value: string;
    avg_deal_size: string;
    healthy_count: string;
    at_risk_count: string;
  }>(`
    WITH last_week_stage AS (
      SELECT DISTINCT ON (deal_id)
        deal_id,
        stage_normalized AS stage_last_week
      FROM deal_stage_history
      WHERE workspace_id = $1
        AND entered_at <= (NOW() - INTERVAL '7 days')
      ORDER BY deal_id, entered_at DESC
    )
    SELECT
      COALESCE(lws.stage_last_week, d.stage_normalized, 'unknown') AS stage_last_week,
      COUNT(*)::int AS deal_count,
      COALESCE(SUM(d.amount), 0)::numeric AS total_value,
      COALESCE(AVG(d.amount), 0)::numeric AS avg_deal_size,
      COUNT(CASE WHEN d.rfm_grade IN ('A','B') THEN 1 END)::int AS healthy_count,
      COUNT(CASE WHEN d.rfm_grade IN ('D','F') THEN 1 END)::int AS at_risk_count
    FROM deals d
    LEFT JOIN last_week_stage lws ON lws.deal_id = d.id
    WHERE d.workspace_id = $1
      -- Only deals that existed (were created) before last week cutoff
      AND d.created_at <= (NOW() - INTERVAL '7 days')
      AND COALESCE(
        lws.stage_last_week,
        d.stage_normalized,
        ''
      ) NOT IN ('closed_won', 'closed_lost')
    GROUP BY COALESCE(lws.stage_last_week, d.stage_normalized, 'unknown')
  `, [workspaceId]);

  const totals = result.rows.reduce(
    (acc, r) => ({
      totalValue:   acc.totalValue   + parseFloat(r.total_value),
      totalCount:   acc.totalCount   + parseInt(r.deal_count, 10),
      healthyCount: acc.healthyCount + parseInt(r.healthy_count, 10),
      atRiskCount:  acc.atRiskCount  + parseInt(r.at_risk_count, 10),
    }),
    { totalValue: 0, totalCount: 0, healthyCount: 0, atRiskCount: 0 }
  );

  return {
    byStage: result.rows.map(r => ({
      stage:        r.stage_last_week,
      dealCount:    parseInt(r.deal_count, 10),
      totalValue:   parseFloat(r.total_value),
      avgDealSize:  parseFloat(r.avg_deal_size),
      healthyCount: parseInt(r.healthy_count, 10),
      atRiskCount:  parseInt(r.at_risk_count, 10),
    })),
    ...totals,
    weightedValue: 0, // not needed for last-week comparison
  };
}

// ============================================================================
// Step 4: Deal-level movement classification
// ============================================================================

export async function computeDealMovements(workspaceId: string): Promise<DealMovements> {
  const result = await query<{
    id: string;
    name: string;
    amount: string;
    owner: string;
    stage_normalized: string | null;
    stage_last_week: string | null;
    days_in_stage: string | null;
    created_at: string;
    stage_changed_at: string | null;
  }>(`
    WITH last_week_stage AS (
      SELECT DISTINCT ON (deal_id)
        deal_id,
        stage_normalized AS stage_last_week
      FROM deal_stage_history
      WHERE workspace_id = $1
        AND entered_at <= (NOW() - INTERVAL '7 days')
      ORDER BY deal_id, entered_at DESC
    )
    SELECT
      d.id,
      d.name,
      COALESCE(d.amount, 0)::numeric AS amount,
      COALESCE(d.owner, 'Unassigned') AS owner,
      d.stage_normalized,
      lws.stage_last_week,
      EXTRACT(DAY FROM (NOW() - d.stage_changed_at))::int AS days_in_stage,
      d.created_at,
      d.stage_changed_at
    FROM deals d
    LEFT JOIN last_week_stage lws ON lws.deal_id = d.id
    WHERE d.workspace_id = $1
  `, [workspaceId]);

  const now7DaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const buckets: DealMovements = {
    advanced:    { count: 0, totalValue: 0, deals: [] },
    fell_back:   { count: 0, totalValue: 0, deals: [] },
    closed_won:  { count: 0, totalValue: 0, deals: [] },
    closed_lost: { count: 0, totalValue: 0, deals: [] },
    new_entry:   { count: 0, totalValue: 0, deals: [] },
    stalled:     { count: 0, totalValue: 0, deals: [] },
  };

  for (const row of result.rows) {
    const amount      = parseFloat(row.amount) || 0;
    const stageNow    = row.stage_normalized;
    const stageLast   = row.stage_last_week ?? stageNow;
    const daysInStage = parseInt(row.days_in_stage ?? '0', 10) || 0;
    const createdAt   = row.created_at ? new Date(row.created_at) : null;

    const deal: TopDeal = {
      id:          row.id,
      name:        row.name || 'Unnamed Deal',
      amount,
      owner:       row.owner,
      fromStage:   stageLast,
      toStage:     stageNow,
      daysInStage,
    };

    let bucket: keyof DealMovements | null = null;

    // Classify
    if (createdAt && createdAt >= now7DaysAgo && !row.stage_last_week) {
      // Created this week and never had history = new entry
      bucket = 'new_entry';
    } else if (stageNow === 'closed_won' && row.stage_changed_at) {
      const changedAt = new Date(row.stage_changed_at);
      if (changedAt >= now7DaysAgo) bucket = 'closed_won';
    } else if (stageNow === 'closed_lost' && row.stage_changed_at) {
      const changedAt = new Date(row.stage_changed_at);
      if (changedAt >= now7DaysAgo) bucket = 'closed_lost';
    } else if (stageNow && stageLast && stageNow !== stageLast) {
      const rankNow  = stageRank(stageNow);
      const rankLast = stageRank(stageLast);
      if (rankNow > rankLast) bucket = 'advanced';
      else if (rankNow < rankLast) bucket = 'fell_back';
    } else if (
      stageNow &&
      stageNow !== 'closed_won' &&
      stageNow !== 'closed_lost' &&
      daysInStage >= 14
    ) {
      bucket = 'stalled';
    }

    if (bucket) {
      const b = buckets[bucket];
      b.count++;
      b.totalValue += amount;
      if (b.deals.length < 5) {
        b.deals.push(deal);
      }
    }
  }

  // Sort deals within each bucket by amount desc
  for (const key of Object.keys(buckets) as (keyof DealMovements)[]) {
    buckets[key].deals.sort((a, b) => b.amount - a.amount);
  }

  return buckets;
}

// ============================================================================
// Step 5: Stage velocity (this week vs historical average)
// ============================================================================

export async function computeStageVelocity(
  workspaceId: string
): Promise<StageVelocityDelta[]> {
  const result = await query<{
    stage_normalized: string;
    avg_days_this_week: string | null;
    historical_avg: string | null;
    sample_size: string;
  }>(`
    SELECT
      stage_normalized,
      AVG(CASE WHEN entered_at >= NOW() - INTERVAL '7 days' THEN duration_days END) AS avg_days_this_week,
      AVG(CASE WHEN entered_at < NOW() - INTERVAL '7 days'  THEN duration_days END) AS historical_avg,
      COUNT(CASE WHEN entered_at >= NOW() - INTERVAL '7 days' THEN 1 END)::int AS sample_size
    FROM deal_stage_history
    WHERE workspace_id = $1
      AND duration_days IS NOT NULL
      AND duration_days > 0
      AND stage_normalized IS NOT NULL
      AND stage_normalized NOT IN ('closed_won', 'closed_lost')
    GROUP BY stage_normalized
    HAVING COUNT(CASE WHEN entered_at >= NOW() - INTERVAL '7 days' THEN 1 END) >= 1
    ORDER BY MIN(
      CASE stage_normalized
        WHEN 'lead'        THEN 1
        WHEN 'qualified'   THEN 2
        WHEN 'discovery'   THEN 3
        WHEN 'evaluation'  THEN 4
        WHEN 'proposal'    THEN 5
        WHEN 'negotiation' THEN 6
        WHEN 'decision'    THEN 7
        ELSE 99
      END
    )
  `, [workspaceId]);

  return result.rows.map(r => {
    const thisWeek   = r.avg_days_this_week ? parseFloat(r.avg_days_this_week) : null;
    const historical = r.historical_avg    ? parseFloat(r.historical_avg)     : null;
    const sampleSize = parseInt(r.sample_size, 10);

    let signal: StageVelocityDelta['signal'] = 'no_data';
    if (thisWeek !== null && historical !== null && historical > 0) {
      const ratio = thisWeek / historical;
      if (ratio < 0.7)       signal = 'accelerating';
      else if (ratio > 1.3)  signal = 'slowing';
      else                   signal = 'normal';
    } else if (thisWeek !== null) {
      signal = 'normal';
    }

    return {
      stage:           r.stage_normalized,
      avgDaysThisWeek: thisWeek !== null ? Math.round(thisWeek * 10) / 10 : null,
      historicalAvg:   historical !== null ? Math.round(historical * 10) / 10 : null,
      sampleSize,
      signal,
    };
  });
}

// ============================================================================
// Step 6: 4-week trend from prior skill_runs
// ============================================================================

export async function getTrendFromSkillRuns(
  workspaceId: string,
  limit = 4
): Promise<PipelineTrend> {
  const result = await query<{
    output: any;
    created_at: string;
  }>(`
    SELECT output, created_at
    FROM skill_runs
    WHERE workspace_id = $1
      AND skill_id = 'pipeline-movement'
      AND status = 'completed'
    ORDER BY created_at DESC
    LIMIT $2
  `, [workspaceId, limit]);

  if (result.rows.length === 0) {
    return {
      available: false,
      message: 'This is the first Pipeline Movement run for this workspace. Trend data will be available after 4 weekly runs.',
      runCount: 0,
      runs: [],
      isCoverageImproving: null,
      isNewPipelineConsistent: null,
      isLossRateIncreasing: null,
    };
  }

  const runs: TrendRun[] = result.rows.map(r => {
    const summary = r.output?.summary?.net_delta || r.output?.net_delta || null;
    return {
      createdAt:      r.created_at,
      totalOpenValue: summary?.totalOpenValue     ?? r.output?.snapshot?.totalValue     ?? null,
      coverageRatio:  summary?.coverageRatioNow   ?? r.output?.snapshot?.coverageRatio  ?? null,
      closedWonValue: r.output?.movements?.closed_won?.totalValue ?? null,
      newEntryValue:  r.output?.movements?.new_entry?.totalValue  ?? null,
    };
  });

  // Trend direction from most recent 2 vs prior 2
  let isCoverageImproving: boolean | null = null;
  let isNewPipelineConsistent: boolean | null = null;
  let isLossRateIncreasing: boolean | null = null;

  if (runs.length >= 2) {
    const recent = runs.slice(0, 2).filter(r => r.coverageRatio !== null);
    const prior  = runs.slice(2).filter(r => r.coverageRatio !== null);

    if (recent.length >= 1 && prior.length >= 1) {
      const recentAvg = recent.reduce((s, r) => s + (r.coverageRatio ?? 0), 0) / recent.length;
      const priorAvg  = prior.reduce((s, r) => s + (r.coverageRatio  ?? 0), 0) / prior.length;
      isCoverageImproving = recentAvg > priorAvg;
    }

    // New pipeline consistency: std deviation as pct of mean < 30%
    const newVals = runs.map(r => r.newEntryValue).filter((v): v is number => v !== null);
    if (newVals.length >= 2) {
      const mean = newVals.reduce((s, v) => s + v, 0) / newVals.length;
      if (mean > 0) {
        const variance = newVals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / newVals.length;
        const stdDev = Math.sqrt(variance);
        isNewPipelineConsistent = (stdDev / mean) < 0.3;
      }
    }
  }

  return {
    available: true,
    message: null,
    runCount: runs.length,
    runs,
    isCoverageImproving,
    isNewPipelineConsistent,
    isLossRateIncreasing,
  };
}

// ============================================================================
// Step 7: Compute net delta (pure TS — reads from prior step outputs)
// ============================================================================

export function computeNetDelta(params: {
  snapshotNow:      PipelineSnapshot;
  snapshotLastWeek: PipelineSnapshot;
  movements:        DealMovements;
  trend:            PipelineTrend;
  gapToTarget:      number | null;
  weeksRemaining:   number | null;
}): NetDelta {
  const { snapshotNow, snapshotLastWeek, movements, trend, gapToTarget, weeksRemaining } = params;

  const valueDelta = snapshotNow.totalValue - snapshotLastWeek.totalValue;
  const valueDeltaPct = snapshotLastWeek.totalValue > 0
    ? Math.round((valueDelta / snapshotLastWeek.totalValue) * 1000) / 10
    : 0;

  const dealsAdded = movements.new_entry.count + movements.advanced.count;
  const dealsLost  = movements.closed_lost.count;

  // Coverage ratio
  const coverageNow  = gapToTarget && gapToTarget > 0
    ? Math.round((snapshotNow.totalValue   / gapToTarget) * 10) / 10
    : null;
  const coverageLast = gapToTarget && gapToTarget > 0
    ? Math.round((snapshotLastWeek.totalValue / gapToTarget) * 10) / 10
    : null;

  let coverageTrend: NetDelta['coverageTrend'] = 'stable';
  if (coverageNow !== null && coverageLast !== null) {
    const diff = coverageNow - coverageLast;
    if (diff > 0.05)       coverageTrend = 'improving';
    else if (diff < -0.05) coverageTrend = 'declining';
  }

  const healthDiff = snapshotNow.healthyCount - snapshotLastWeek.healthyCount;
  let healthTrend: NetDelta['healthTrend'] = 'stable';
  if (healthDiff > 0) healthTrend = 'improving';
  else if (healthDiff < 0) healthTrend = 'declining';

  const onTrack = coverageNow !== null
    ? (coverageNow >= 2.5 && (weeksRemaining === null || weeksRemaining >= 3))
    : false;

  // Anomalies
  const anomalies: string[] = [];
  if (movements.closed_lost.count >= 3)
    anomalies.push(`${movements.closed_lost.count} deals lost this week — review pipeline health`);
  if (movements.stalled.count > 10)
    anomalies.push(`${movements.stalled.count} deals stalled (14+ days no movement)`);
  if (coverageTrend === 'declining' && weeksRemaining !== null && weeksRemaining < 6)
    anomalies.push(`Coverage declining with ${weeksRemaining} weeks left in quarter`);
  if (valueDelta < 0)
    anomalies.push(`Pipeline value declined ${Math.abs(valueDeltaPct)}% this week`);
  if (trend.available && trend.isCoverageImproving === false)
    anomalies.push('Coverage ratio has been declining across recent weeks');

  return {
    pipelineValueDelta:    Math.round(valueDelta),
    pipelineValueDeltaPct: valueDeltaPct,
    dealsAdded,
    dealsLost,
    netDealChange:         snapshotNow.totalCount - snapshotLastWeek.totalCount,
    coverageRatioNow:      coverageNow,
    coverageRatioLastWeek: coverageLast,
    coverageTrend,
    gapToTarget:           gapToTarget ?? null,
    weeksRemainingInQuarter: weeksRemaining ?? null,
    onTrack,
    healthyDealCount: snapshotNow.healthyCount,
    atRiskDealCount:  snapshotNow.atRiskCount,
    healthTrend,
    anomalies,
  };
}
