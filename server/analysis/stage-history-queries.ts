import { query } from '../db.js';

export interface StageHistoryEntry {
  id: string;
  dealId: string;
  dealName: string;
  dealAmount: number;
  fromStage: string | null;
  fromStageNormalized: string | null;
  toStage: string;
  toStageNormalized: string | null;
  changedAt: string;
  durationInPreviousStageDays: number | null;
  source: string;
}

export interface StageHistoryResult {
  dealId: string;
  dealName: string;
  dealAmount: number;
  history: StageHistoryEntry[];
}

export async function getDealStageHistory(
  workspaceId: string,
  dealId: string
): Promise<StageHistoryResult | null> {
  const result = await query<{
    id: string;
    deal_id: string;
    deal_name: string;
    deal_amount: string;
    from_stage: string | null;
    from_stage_normalized: string | null;
    to_stage: string;
    to_stage_normalized: string | null;
    changed_at: string;
    duration_days: string | null;
    source: string;
  }>(
    `SELECT
      dsh.id,
      dsh.deal_id,
      d.name AS deal_name,
      d.amount AS deal_amount,
      LAG(dsh.stage) OVER (ORDER BY dsh.entered_at) AS from_stage,
      LAG(dsh.stage_normalized) OVER (ORDER BY dsh.entered_at) AS from_stage_normalized,
      dsh.stage AS to_stage,
      dsh.stage_normalized AS to_stage_normalized,
      dsh.entered_at AS changed_at,
      dsh.duration_days,
      dsh.source
    FROM deal_stage_history dsh
    JOIN deals d ON d.id = dsh.deal_id AND d.workspace_id = $1
    WHERE dsh.workspace_id = $1 AND dsh.deal_id = $2
    ORDER BY dsh.entered_at ASC`,
    [workspaceId, dealId]
  );

  if (result.rows.length === 0) return null;

  const first = result.rows[0];
  const history: StageHistoryEntry[] = result.rows.map((row) => ({
    id: row.id,
    dealId: row.deal_id,
    dealName: row.deal_name || 'Unnamed Deal',
    dealAmount: parseFloat(row.deal_amount) || 0,
    fromStage: row.from_stage,
    fromStageNormalized: row.from_stage_normalized,
    toStage: row.to_stage,
    toStageNormalized: row.to_stage_normalized,
    changedAt: row.changed_at,
    durationInPreviousStageDays: row.duration_days
      ? parseFloat(row.duration_days)
      : null,
    source: row.source,
  }));

  return {
    dealId: first.deal_id,
    dealName: first.deal_name || 'Unnamed Deal',
    dealAmount: parseFloat(first.deal_amount) || 0,
    history,
  };
}

export interface StageTransition {
  historyId: string;
  dealId: string;
  dealName: string;
  dealOwner: string;
  dealAmount: number;
  fromStage: string | null;
  fromStageNormalized: string | null;
  toStage: string;
  toStageNormalized: string | null;
  changedAt: string;
  durationInPreviousStageDays: number | null;
  source: string;
}

export async function getStageTransitionsInWindow(
  workspaceId: string,
  startDate: Date,
  endDate: Date
): Promise<StageTransition[]> {
  const result = await query<{
    history_id: string;
    deal_id: string;
    deal_name: string;
    deal_owner: string;
    deal_amount: string;
    from_stage: string | null;
    from_stage_normalized: string | null;
    to_stage: string;
    to_stage_normalized: string | null;
    changed_at: string;
    duration_days: string | null;
    source: string;
  }>(
    `SELECT
      sub.id AS history_id,
      sub.deal_id,
      sub.deal_name,
      sub.deal_owner,
      sub.deal_amount,
      sub.from_stage,
      sub.from_stage_normalized,
      sub.stage AS to_stage,
      sub.stage_normalized AS to_stage_normalized,
      sub.entered_at AS changed_at,
      sub.duration_days,
      sub.source
    FROM (
      SELECT
        dsh.id,
        dsh.deal_id,
        d.name AS deal_name,
        d.owner AS deal_owner,
        d.amount AS deal_amount,
        dsh.stage,
        dsh.stage_normalized,
        dsh.entered_at,
        dsh.duration_days,
        dsh.source,
        LAG(dsh.stage) OVER (PARTITION BY dsh.deal_id ORDER BY dsh.entered_at) AS from_stage,
        LAG(dsh.stage_normalized) OVER (PARTITION BY dsh.deal_id ORDER BY dsh.entered_at) AS from_stage_normalized
      FROM deal_stage_history dsh
      JOIN deals d ON d.id = dsh.deal_id AND d.workspace_id = $1
      WHERE dsh.workspace_id = $1
    ) sub
    WHERE sub.entered_at >= $2
      AND sub.entered_at <= $3
    ORDER BY sub.entered_at ASC`,
    [workspaceId, startDate.toISOString(), endDate.toISOString()]
  );

  return result.rows.map((row) => ({
    historyId: row.history_id,
    dealId: row.deal_id,
    dealName: row.deal_name || 'Unnamed Deal',
    dealOwner: row.deal_owner || 'Unassigned',
    dealAmount: parseFloat(row.deal_amount) || 0,
    fromStage: row.from_stage,
    fromStageNormalized: row.from_stage_normalized,
    toStage: row.to_stage,
    toStageNormalized: row.to_stage_normalized,
    changedAt: row.changed_at,
    durationInPreviousStageDays: row.duration_days
      ? parseFloat(row.duration_days)
      : null,
    source: row.source,
  }));
}

export interface StageConversionRate {
  fromStage: string;
  toStage: string;
  transitionCount: number;
  avgDurationDays: number | null;
}

export async function getStageConversionRates(
  workspaceId: string,
  options?: { startDate?: Date; endDate?: Date }
): Promise<StageConversionRate[]> {
  const params: unknown[] = [workspaceId];
  let dateFilter = '';

  if (options?.startDate) {
    params.push(options.startDate.toISOString());
    dateFilter += ` AND sub.entered_at >= $${params.length}`;
  }
  if (options?.endDate) {
    params.push(options.endDate.toISOString());
    dateFilter += ` AND sub.entered_at <= $${params.length}`;
  }

  const result = await query<{
    from_stage: string;
    to_stage: string;
    transition_count: string;
    avg_duration_days: string | null;
  }>(
    `SELECT
      sub.from_stage_normalized AS from_stage,
      sub.stage_normalized AS to_stage,
      COUNT(*) AS transition_count,
      CASE
        WHEN AVG(sub.duration_days) IS NOT NULL
        THEN ROUND(AVG(sub.duration_days)::NUMERIC, 2)
        ELSE NULL
      END AS avg_duration_days
    FROM (
      SELECT
        dsh.stage_normalized,
        dsh.entered_at,
        dsh.duration_days,
        LAG(dsh.stage_normalized) OVER (PARTITION BY dsh.deal_id ORDER BY dsh.entered_at) AS from_stage_normalized
      FROM deal_stage_history dsh
      WHERE dsh.workspace_id = $1
    ) sub
    WHERE sub.from_stage_normalized IS NOT NULL
      AND sub.stage_normalized IS NOT NULL
      ${dateFilter}
    GROUP BY sub.from_stage_normalized, sub.stage_normalized
    ORDER BY transition_count DESC`,
    params
  );

  return result.rows.map((row) => ({
    fromStage: row.from_stage,
    toStage: row.to_stage,
    transitionCount: parseInt(row.transition_count, 10),
    avgDurationDays: row.avg_duration_days ? parseFloat(row.avg_duration_days) : null,
  }));
}

export interface RepStageMetric {
  owner: string;
  dealsMoved: number;
  avgTimeInStageDays: number | null;
  stagesAdvanced: number;
  stagesRegressed: number;
}

const STAGE_ORDER: Record<string, number> = {
  lead: 1,
  qualified: 2,
  discovery: 3,
  evaluation: 4,
  proposal: 5,
  negotiation: 6,
  decision: 7,
  closed_won: 8,
  closed_lost: 8,
};

function getStageIndex(stage: string | null): number {
  if (!stage) return 0;
  return STAGE_ORDER[stage.toLowerCase()] ?? 0;
}

export async function getRepStageMetrics(
  workspaceId: string,
  options?: { startDate?: Date; endDate?: Date }
): Promise<RepStageMetric[]> {
  const params: unknown[] = [workspaceId];
  let dateFilter = '';

  if (options?.startDate) {
    params.push(options.startDate.toISOString());
    dateFilter += ` AND sub.entered_at >= $${params.length}`;
  }
  if (options?.endDate) {
    params.push(options.endDate.toISOString());
    dateFilter += ` AND sub.entered_at <= $${params.length}`;
  }

  const result = await query<{
    deal_owner: string;
    from_stage_normalized: string | null;
    to_stage_normalized: string | null;
    duration_days: string | null;
  }>(
    `SELECT
      sub.deal_owner,
      sub.from_stage_normalized,
      sub.stage_normalized AS to_stage_normalized,
      sub.duration_days
    FROM (
      SELECT
        d.owner AS deal_owner,
        dsh.stage_normalized,
        dsh.entered_at,
        dsh.duration_days,
        LAG(dsh.stage_normalized) OVER (PARTITION BY dsh.deal_id ORDER BY dsh.entered_at) AS from_stage_normalized
      FROM deal_stage_history dsh
      JOIN deals d ON d.id = dsh.deal_id AND d.workspace_id = $1
      WHERE dsh.workspace_id = $1
    ) sub
    WHERE 1=1
      ${dateFilter}
    ORDER BY sub.deal_owner`,
    params
  );

  const repMap = new Map<string, {
    dealsMoved: number;
    totalDurationDays: number;
    durationCount: number;
    advanced: number;
    regressed: number;
  }>();

  for (const row of result.rows) {
    const owner = row.deal_owner || 'Unassigned';
    if (!repMap.has(owner)) {
      repMap.set(owner, {
        dealsMoved: 0,
        totalDurationDays: 0,
        durationCount: 0,
        advanced: 0,
        regressed: 0,
      });
    }
    const stats = repMap.get(owner)!;
    stats.dealsMoved++;

    if (row.duration_days) {
      stats.totalDurationDays += parseFloat(row.duration_days);
      stats.durationCount++;
    }

    const fromIdx = getStageIndex(row.from_stage_normalized);
    const toIdx = getStageIndex(row.to_stage_normalized);
    if (fromIdx > 0 && toIdx > 0) {
      if (toIdx > fromIdx) {
        stats.advanced++;
      } else if (toIdx < fromIdx) {
        stats.regressed++;
      }
    }
  }

  const metrics: RepStageMetric[] = [];
  repMap.forEach((stats, owner) => {
    metrics.push({
      owner,
      dealsMoved: stats.dealsMoved,
      avgTimeInStageDays: stats.durationCount > 0
        ? Math.round((stats.totalDurationDays / stats.durationCount) * 100) / 100
        : null,
      stagesAdvanced: stats.advanced,
      stagesRegressed: stats.regressed,
    });
  });

  return metrics.sort((a, b) => b.dealsMoved - a.dealsMoved);
}

export interface StalledDeal {
  dealId: string;
  dealName: string;
  amount: number;
  stage: string;
  stageNormalized: string | null;
  owner: string;
  pipelineName: string | null;
  closeDate: string | null;
  stageChangedAt: string;
  daysInStage: number;
}

export async function getStalledDeals(
  workspaceId: string,
  staleDays: number = 14
): Promise<StalledDeal[]> {
  const result = await query<{
    deal_id: string;
    deal_name: string;
    amount: string;
    stage: string;
    stage_normalized: string | null;
    owner: string;
    pipeline_name: string | null;
    close_date: string | null;
    stage_changed_at: string;
    days_in_stage: string;
  }>(
    `SELECT
      d.id AS deal_id,
      d.name AS deal_name,
      d.amount,
      d.stage,
      d.stage_normalized,
      d.owner,
      d.pipeline_name,
      d.close_date,
      d.stage_changed_at,
      EXTRACT(DAY FROM (NOW() - d.stage_changed_at))::int AS days_in_stage
    FROM deals d
    WHERE d.workspace_id = $1
      AND d.stage_changed_at IS NOT NULL
      AND EXTRACT(DAY FROM (NOW() - d.stage_changed_at)) >= $2
      AND (d.stage_normalized IS NULL
           OR d.stage_normalized NOT IN ('closed_won', 'closed_lost'))
    ORDER BY EXTRACT(DAY FROM (NOW() - d.stage_changed_at)) DESC`,
    [workspaceId, staleDays]
  );

  return result.rows.map((row) => ({
    dealId: row.deal_id,
    dealName: row.deal_name || 'Unnamed Deal',
    amount: parseFloat(row.amount) || 0,
    stage: row.stage,
    stageNormalized: row.stage_normalized,
    owner: row.owner || 'Unassigned',
    pipelineName: row.pipeline_name,
    closeDate: row.close_date,
    stageChangedAt: row.stage_changed_at,
    daysInStage: parseInt(row.days_in_stage, 10) || 0,
  }));
}

export interface StageTimeBenchmark {
  stage: string;
  avgDays: number;
  medianDays: number;
  dealCount: number;
}

export async function getAverageTimeInStage(
  workspaceId: string
): Promise<StageTimeBenchmark[]> {
  const result = await query<{
    stage: string;
    avg_days: string;
    median_days: string;
    deal_count: string;
  }>(
    `SELECT
      dsh.stage_normalized AS stage,
      ROUND(AVG(dsh.duration_days)::NUMERIC, 2) AS avg_days,
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY dsh.duration_days
      )::NUMERIC, 2) AS median_days,
      COUNT(*) AS deal_count
    FROM deal_stage_history dsh
    WHERE dsh.workspace_id = $1
      AND dsh.stage_normalized IS NOT NULL
      AND dsh.duration_days IS NOT NULL
    GROUP BY dsh.stage_normalized
    ORDER BY avg_days DESC`,
    [workspaceId]
  );

  return result.rows.map((row) => ({
    stage: row.stage,
    avgDays: parseFloat(row.avg_days) || 0,
    medianDays: parseFloat(row.median_days) || 0,
    dealCount: parseInt(row.deal_count, 10),
  }));
}

/**
 * Compute won-deal cycle length percentiles for a workspace (or specific pipeline).
 * Returns null when sample is too small (< 5 deals) to be meaningful.
 * Uses created_at and close_date — excludes outliers > 730 days.
 */
export async function getWonCyclePercentiles(
  workspaceId: string,
  pipeline?: string
): Promise<{ p25: number; p50: number; p75: number; p90: number; sampleSize: number } | null> {
  const params: string[] = [workspaceId];
  if (pipeline) params.push(pipeline);

  const result = await query(`
    SELECT
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY cycle_days)::int AS p25,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY cycle_days)::int AS p50,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY cycle_days)::int AS p75,
      PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY cycle_days)::int AS p90,
      COUNT(*)::int AS sample_size
    FROM (
      SELECT
        EXTRACT(DAY FROM (close_date::timestamptz - created_at))::int AS cycle_days
      FROM deals
      WHERE workspace_id = $1
        AND stage_normalized = 'closed_won'
        AND close_date IS NOT NULL
        AND created_at IS NOT NULL
        ${pipeline ? 'AND pipeline = $2' : ''}
    ) sub
    WHERE cycle_days > 0 AND cycle_days < 730
  `, params);

  const row = result.rows[0];
  if (!row || parseInt(row.sample_size ?? '0') < 5) return null;
  return {
    p25:        parseInt(row.p25)         || 30,
    p50:        parseInt(row.p50)         || 60,
    p75:        parseInt(row.p75)         || 90,
    p90:        parseInt(row.p90)         || 120,
    sampleSize: parseInt(row.sample_size) || 0,
  };
}

/**
 * Median days per stage specifically for deals that eventually closed won.
 * Used for stall threshold computation in Stage Progression.
 * Returns a map of stage_normalized → median days (raw stage names as fallback).
 */
export async function getWonStageMedianDays(
  workspaceId: string,
  pipeline?: string
): Promise<Record<string, number>> {
  const params: string[] = [workspaceId];
  if (pipeline) params.push(pipeline);

  const result = await query<{
    stage: string;
    median_days: string;
    deal_count: string;
  }>(`
    SELECT
      COALESCE(dsh.to_stage_normalized, dsh.to_stage) AS stage,
      ROUND(
        PERCENTILE_CONT(0.5) WITHIN GROUP (
          ORDER BY dsh.duration_in_previous_stage_ms / 86400000.0
        )::NUMERIC, 1
      ) AS median_days,
      COUNT(*) AS deal_count
    FROM deal_stage_history dsh
    JOIN deals d ON d.id = dsh.deal_id
    WHERE dsh.workspace_id = $1
      AND d.stage_normalized = 'closed_won'
      AND dsh.duration_in_previous_stage_ms IS NOT NULL
      AND dsh.duration_in_previous_stage_ms > 0
      ${pipeline ? 'AND d.pipeline = $2' : ''}
    GROUP BY COALESCE(dsh.to_stage_normalized, dsh.to_stage)
  `, params);

  const map: Record<string, number> = {};
  for (const row of result.rows) {
    const days = parseFloat(row.median_days);
    if (!isNaN(days) && days > 0) {
      map[row.stage] = days;
    }
  }
  return map;
}

export interface StageCoverageItem {
  stageName: string;
  stageNormalized: string;
  stageOrder: number;
  wonMedianDays: number;
  stallThresholdDays: number;
  totalDealsEverInStage: number;
  dealsWithTranscripts: number;
  transcriptCoveragePct: number;
  progressorCount: number;
  stallerCount: number;
}

export interface StageTranscriptCoverageResult {
  stages: StageCoverageItem[];
  totalCoveragePct: number;
  usableStages: number;
}

/**
 * Coverage probe for Stage Progression.
 * For each open/active stage, returns deal counts, transcript coverage,
 * and a rough progressor/staller split. Fast — no LLM calls.
 */
export async function getStageTranscriptCoverage(
  workspaceId: string,
  pipeline?: string
): Promise<StageTranscriptCoverageResult> {
  const params: (string)[] = [workspaceId];
  if (pipeline) params.push(pipeline);

  const coverageQuery = `
    WITH stage_entries AS (
      SELECT
        dsh.deal_id,
        COALESCE(dsh.to_stage_normalized, dsh.to_stage) AS stage_normalized,
        dsh.to_stage                                     AS stage_name,
        dsh.changed_at                                   AS entered_at,
        dsh.duration_in_previous_stage_ms,
        LEAD(dsh.changed_at) OVER (
          PARTITION BY dsh.deal_id ORDER BY dsh.changed_at
        ) AS next_changed_at,
        LEAD(COALESCE(dsh.to_stage_normalized, dsh.to_stage)) OVER (
          PARTITION BY dsh.deal_id ORDER BY dsh.changed_at
        ) AS next_stage_normalized
      FROM deal_stage_history dsh
      JOIN deals d ON d.id = dsh.deal_id
      WHERE dsh.workspace_id = $1
        ${pipeline ? 'AND d.pipeline = $2' : ''}
        AND dsh.to_stage_normalized NOT IN ('closed_won', 'closed_lost')
        AND dsh.to_stage NOT ILIKE '%closed%'
        AND dsh.to_stage NOT ILIKE '%won%'
        AND dsh.to_stage NOT ILIKE '%lost%'
    ),
    stage_with_convos AS (
      SELECT
        se.stage_normalized,
        se.stage_name,
        se.deal_id,
        se.entered_at,
        se.next_changed_at,
        se.next_stage_normalized,
        se.duration_in_previous_stage_ms,
        COUNT(c.id) AS convo_count
      FROM stage_entries se
      LEFT JOIN conversations c
        ON c.deal_id = se.deal_id
        AND c.call_date >= se.entered_at
        AND (se.next_changed_at IS NULL OR c.call_date < se.next_changed_at)
        AND (c.is_internal = false OR c.is_internal IS NULL)
        AND c.deal_id IS NOT NULL
      GROUP BY se.stage_normalized, se.stage_name, se.deal_id,
               se.entered_at, se.next_changed_at, se.next_stage_normalized,
               se.duration_in_previous_stage_ms
    )
    SELECT
      stage_normalized,
      stage_name,
      COUNT(*)                                                         AS total_deals,
      COUNT(*) FILTER (WHERE convo_count > 0)                         AS deals_with_transcripts,
      COUNT(*) FILTER (WHERE convo_count > 0 AND next_stage_normalized IS NOT NULL
                         AND next_stage_normalized NOT IN ('closed_won','closed_lost')
                         AND (duration_in_previous_stage_ms IS NULL
                              OR duration_in_previous_stage_ms <= 0
                              OR TRUE))                                AS progressor_est,
      COUNT(*) FILTER (WHERE convo_count > 0
                         AND (next_stage_normalized IS NULL
                              OR next_stage_normalized IN ('closed_lost')))  AS staller_est
    FROM stage_with_convos
    GROUP BY stage_normalized, stage_name
    ORDER BY MAX(entered_at) DESC
  `;

  const coverageResult = await query<{
    stage_normalized: string;
    stage_name: string;
    total_deals: string;
    deals_with_transcripts: string;
    progressor_est: string;
    staller_est: string;
  }>(coverageQuery, params);

  const wonMedianMap = await getWonStageMedianDays(workspaceId, pipeline);

  const orderResult = await query<{
    stage_name: string;
    display_order: string;
  }>(`
    SELECT stage_name, display_order
    FROM stage_configs
    WHERE workspace_id = $1
    ORDER BY display_order ASC
  `, [workspaceId]);

  const orderMap: Record<string, number> = {};
  for (const row of orderResult.rows) {
    orderMap[row.stage_name] = parseInt(row.display_order, 10);
  }

  const stages: StageCoverageItem[] = coverageResult.rows.map((row) => {
    const totalDeals = parseInt(row.total_deals, 10) || 0;
    const dealsWithTranscripts = parseInt(row.deals_with_transcripts, 10) || 0;
    const wonMedianDays = wonMedianMap[row.stage_normalized] ?? 14;
    const stallThresholdDays = Math.max(7, Math.round(wonMedianDays * 2));
    return {
      stageName: row.stage_name,
      stageNormalized: row.stage_normalized,
      stageOrder: orderMap[row.stage_name] ?? orderMap[row.stage_normalized] ?? 999,
      wonMedianDays,
      stallThresholdDays,
      totalDealsEverInStage: totalDeals,
      dealsWithTranscripts,
      transcriptCoveragePct: totalDeals > 0 ? dealsWithTranscripts / totalDeals : 0,
      progressorCount: parseInt(row.progressor_est, 10) || 0,
      stallerCount: parseInt(row.staller_est, 10) || 0,
    };
  });

  stages.sort((a, b) => a.stageOrder - b.stageOrder);

  const totalDealsAll = stages.reduce((s, x) => s + x.totalDealsEverInStage, 0);
  const totalWithTranscripts = stages.reduce((s, x) => s + x.dealsWithTranscripts, 0);

  return {
    stages,
    totalCoveragePct: totalDealsAll > 0 ? totalWithTranscripts / totalDealsAll : 0,
    usableStages: stages.filter(s => s.dealsWithTranscripts >= 5).length,
  };
}

export interface StallThreshold {
  wonMedianDays: number;
  stallThresholdDays: number;
}

/**
 * Returns stall thresholds per stage for use in the weekly
 * StageConversationTagger job. Keyed by stage name (raw to_stage value).
 * stallThresholdDays = MAX(wonMedianDays × 2, 7) — minimum 7 days prevents
 * zero-threshold edge cases on very fast stages.
 */
export async function getStallThresholdsByStage(
  workspaceId: string,
  pipeline: string | null = null,
): Promise<Map<string, StallThreshold>> {
  const params: string[] = [workspaceId];
  if (pipeline) params.push(pipeline);

  const result = await query<{
    stage_name: string;
    won_median_days: string | null;
  }>(`
    SELECT
      dsh.to_stage AS stage_name,
      ROUND(
        PERCENTILE_CONT(0.5) WITHIN GROUP (
          ORDER BY dsh.duration_in_previous_stage_ms / 86400000.0
        )::NUMERIC, 1
      ) AS won_median_days
    FROM deal_stage_history dsh
    JOIN deals d ON d.id = dsh.deal_id
    WHERE dsh.workspace_id = $1
      AND d.stage_normalized = 'closed_won'
      AND dsh.duration_in_previous_stage_ms IS NOT NULL
      AND dsh.duration_in_previous_stage_ms > 0
      ${pipeline ? 'AND d.pipeline = $2' : ''}
    GROUP BY dsh.to_stage
  `, params);

  const thresholds = new Map<string, StallThreshold>();
  for (const row of result.rows) {
    const wonMedian = row.won_median_days ? Math.round(parseFloat(row.won_median_days)) : 0;
    thresholds.set(row.stage_name, {
      wonMedianDays: wonMedian,
      stallThresholdDays: Math.max(wonMedian * 2, 7),
    });
  }
  return thresholds;
}
