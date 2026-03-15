import { query } from '../db.js';
import { computeWinRates } from './win-rate.js';
import type { WinRateResult } from './win-rate.js';

export interface QuarterConversionData {
  quarterLabel: string;
  quarterStart: string;
  quarterEnd: string;
  week3SnapshotDate: string;
  week3PipelineValue: number;
  closedWonValue: number;
  conversionRate: number;
  impliedCoverageTarget: number;
  dealCount: {
    week3Pipeline: number;
    closedWon: number;
    closedLost: number;
    derailed: number;
    stillOpen: number;
  };
}

export interface ConversionRateResult {
  completedQuarters: QuarterConversionData[];
  currentQuarterProjection: {
    quarterLabel: string;
    quarterStart: string;
    quarterEnd: string;
    toDateConversionRate: number;
    projectedConversionRate: number;
    week3PipelineValue: number;
    projectedClosedWon: number;
  } | null;
  impliedCoverageTarget: number;
  winRates: WinRateResult;
}

function getQuarterBounds(date: Date): { start: Date; end: Date; label: string } {
  const q = Math.floor(date.getMonth() / 3);
  const start = new Date(date.getFullYear(), q * 3, 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 3, 0, 23, 59, 59);
  const label = `Q${q + 1} ${start.getFullYear()}`;
  return { start, end, label };
}

const DERAIL_KEYWORDS = ['no decision', 'no-decision', 'status quo', 'budget', 'cancelled', 'deferred'];

export async function week3PipelineConversionRate(
  workspaceId: string,
  quarterStart: Date,
  quarterEnd: Date
): Promise<QuarterConversionData> {
  const week3Date = new Date(quarterStart);
  week3Date.setDate(week3Date.getDate() + 20);
  const qLabel = `Q${Math.floor(quarterStart.getMonth() / 3) + 1} ${quarterStart.getFullYear()}`;

  const pipelineResult = await query<{ pipeline_value: number; deal_count: number }>(
    `SELECT
       COALESCE(SUM(amount), 0) AS pipeline_value,
       COUNT(*)::int AS deal_count
     FROM deals
     WHERE workspace_id = $1
       AND close_date >= $2
       AND close_date <= $3
       AND created_at <= $4`,
    [
      workspaceId,
      quarterStart.toISOString().split('T')[0],
      quarterEnd.toISOString().split('T')[0],
      week3Date.toISOString(),
    ]
  );

  const outcomesResult = await query<{
    stage_normalized: string;
    close_reason: string | null;
    count: number;
    total: number;
  }>(
    `SELECT
       stage_normalized,
       COALESCE(
         source_data->'properties'->>'closed_lost_reason',
         source_data->'properties'->>'closed_won_reason',
         custom_fields->>'close_reason',
         custom_fields->>'closed_lost_reason',
         ''
       ) AS close_reason,
       COUNT(*)::int AS count,
       COALESCE(SUM(amount), 0) AS total
     FROM deals
     WHERE workspace_id = $1
       AND close_date >= $2
       AND close_date <= $3
       AND created_at <= $4
     GROUP BY stage_normalized, COALESCE(
         source_data->'properties'->>'closed_lost_reason',
         source_data->'properties'->>'closed_won_reason',
         custom_fields->>'close_reason',
         custom_fields->>'closed_lost_reason',
         ''
       )`,
    [workspaceId, quarterStart.toISOString().split('T')[0], quarterEnd.toISOString().split('T')[0], week3Date.toISOString()]
  );

  let closedWon = 0; let closedWonCount = 0;
  let closedLostCount = 0; let derailedCount = 0; let stillOpenCount = 0;

  for (const row of outcomesResult.rows) {
    if (row.stage_normalized === 'closed_won') {
      closedWon += Number(row.total);
      closedWonCount += Number(row.count);
    } else if (row.stage_normalized === 'closed_lost') {
      const r = (row.close_reason ?? '').toLowerCase();
      if (DERAIL_KEYWORDS.some(k => r.includes(k))) derailedCount += Number(row.count);
      else closedLostCount += Number(row.count);
    } else {
      stillOpenCount += Number(row.count);
    }
  }

  const week3Pipeline = Number(pipelineResult.rows[0]?.pipeline_value ?? 0);
  const conversionRate = week3Pipeline > 0 ? closedWon / week3Pipeline : 0;
  const impliedCoverageTarget = conversionRate > 0 ? 1 / conversionRate : 0;

  return {
    quarterLabel: qLabel,
    quarterStart: quarterStart.toISOString().split('T')[0],
    quarterEnd: quarterEnd.toISOString().split('T')[0],
    week3SnapshotDate: week3Date.toISOString().split('T')[0],
    week3PipelineValue: week3Pipeline,
    closedWonValue: closedWon,
    conversionRate: Math.round(conversionRate * 1000) / 1000,
    impliedCoverageTarget: Math.round(impliedCoverageTarget * 100) / 100,
    dealCount: {
      week3Pipeline: Number(pipelineResult.rows[0]?.deal_count ?? 0),
      closedWon: closedWonCount,
      closedLost: closedLostCount,
      derailed: derailedCount,
      stillOpen: stillOpenCount,
    },
  };
}

export async function computeConversionRateTrend(
  workspaceId: string,
  lookbackQuarters: number = 6
): Promise<ConversionRateResult> {
  const now = new Date();
  const quarters: { start: Date; end: Date }[] = [];

  for (let i = lookbackQuarters; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i * 3, 1);
    const bounds = getQuarterBounds(d);
    if (bounds.end < now) quarters.push({ start: bounds.start, end: bounds.end });
  }

  const completedQuarters: QuarterConversionData[] = [];
  for (const { start, end } of quarters) {
    try {
      const data = await week3PipelineConversionRate(workspaceId, start, end);
      if (data.week3PipelineValue > 0 || data.closedWonValue > 0) completedQuarters.push(data);
    } catch { }
  }

  const avgConversionRate = completedQuarters.length > 0
    ? completedQuarters.reduce((sum, q) => sum + q.conversionRate, 0) / completedQuarters.length
    : 0.3;
  const impliedCoverageTarget = avgConversionRate > 0 ? Math.round((1 / avgConversionRate) * 100) / 100 : 3.3;

  const currentBounds = getQuarterBounds(now);
  const week3Date = new Date(currentBounds.start);
  week3Date.setDate(week3Date.getDate() + 20);

  let currentQuarterProjection = null;
  if (now > week3Date) {
    const currentPipeline = await week3PipelineConversionRate(workspaceId, currentBounds.start, currentBounds.end);
    currentQuarterProjection = {
      quarterLabel: currentPipeline.quarterLabel,
      quarterStart: currentPipeline.quarterStart,
      quarterEnd: currentPipeline.quarterEnd,
      toDateConversionRate: currentPipeline.conversionRate,
      projectedConversionRate: avgConversionRate,
      week3PipelineValue: currentPipeline.week3PipelineValue,
      projectedClosedWon: Math.round(currentPipeline.week3PipelineValue * avgConversionRate),
    };
  }

  const winRates = await computeWinRates(workspaceId, lookbackQuarters);

  return {
    completedQuarters,
    currentQuarterProjection,
    impliedCoverageTarget,
    winRates,
  };
}
