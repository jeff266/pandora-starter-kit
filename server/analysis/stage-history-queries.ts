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
