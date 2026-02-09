import { query } from '../db.js';

export interface StageBreakdown {
  stage: string;
  deal_count: number;
  total_amount: number;
}

export interface PipelineSnapshot {
  workspaceId: string;
  generatedAt: string;
  totalPipeline: number;
  dealCount: number;
  avgDealSize: number;
  byStage: StageBreakdown[];
  closingThisMonth: {
    dealCount: number;
    totalAmount: number;
  };
  staleDeals: {
    dealCount: number;
    totalAmount: number;
    staleDaysThreshold: number;
  };
  coverageRatio: number | null;
  winRate: {
    rate: number | null;
    won: number;
    lost: number;
  };
  newDealsThisWeek: {
    dealCount: number;
    totalAmount: number;
  };
}

const CLOSED_WON_FILTER = `(LOWER(stage) LIKE '%won%' OR probability = 1.0)`;
const CLOSED_LOST_FILTER = `(LOWER(stage) LIKE '%lost%' OR (probability = 0.0 AND LOWER(stage) NOT LIKE '%won%'))`;
const CLOSED_FILTER = `(${CLOSED_WON_FILTER} OR ${CLOSED_LOST_FILTER})`;
const OPEN_FILTER = `NOT ${CLOSED_FILTER}`;

const DEFAULT_QUOTA = 1_000_000;

export async function generatePipelineSnapshot(
  workspaceId: string,
  quota?: number,
  staleDaysThreshold: number = 14
): Promise<PipelineSnapshot> {
  const effectiveQuota = quota ?? DEFAULT_QUOTA;

  const [totalsResult, byStageResult, closingResult, staleResult, winRateResult, newDealsResult] = await Promise.all([
    query<{ deal_count: string; total_amount: string; avg_amount: string }>(
      `SELECT
        COUNT(*)::text AS deal_count,
        COALESCE(SUM(amount), 0)::text AS total_amount,
        COALESCE(AVG(amount), 0)::text AS avg_amount
      FROM deals
      WHERE workspace_id = $1
        AND ${OPEN_FILTER}
        AND amount IS NOT NULL`,
      [workspaceId]
    ),

    query<{ stage: string; deal_count: string; total_amount: string }>(
      `SELECT
        COALESCE(stage, 'Unknown') AS stage,
        COUNT(*)::text AS deal_count,
        COALESCE(SUM(amount), 0)::text AS total_amount
      FROM deals
      WHERE workspace_id = $1
        AND ${OPEN_FILTER}
      GROUP BY stage
      ORDER BY SUM(amount) DESC`,
      [workspaceId]
    ),

    query<{ deal_count: string; total_amount: string }>(
      `SELECT
        COUNT(*)::text AS deal_count,
        COALESCE(SUM(amount), 0)::text AS total_amount
      FROM deals
      WHERE workspace_id = $1
        AND ${OPEN_FILTER}
        AND close_date IS NOT NULL
        AND date_trunc('month', close_date) = date_trunc('month', CURRENT_DATE)`,
      [workspaceId]
    ),

    query<{ deal_count: string; total_amount: string }>(
      `SELECT
        COUNT(*)::text AS deal_count,
        COALESCE(SUM(amount), 0)::text AS total_amount
      FROM deals
      WHERE workspace_id = $1
        AND ${OPEN_FILTER}
        AND (
          last_activity_date IS NULL
          OR last_activity_date < NOW() - INTERVAL '1 day' * $2
        )`,
      [workspaceId, staleDaysThreshold]
    ),

    query<{ won: string; lost: string }>(
      `SELECT
        COALESCE(SUM(CASE WHEN ${CLOSED_WON_FILTER} THEN 1 ELSE 0 END), 0)::text AS won,
        COALESCE(SUM(CASE WHEN ${CLOSED_LOST_FILTER} THEN 1 ELSE 0 END), 0)::text AS lost
      FROM deals
      WHERE workspace_id = $1
        AND ${CLOSED_FILTER}`,
      [workspaceId]
    ),

    query<{ deal_count: string; total_amount: string }>(
      `SELECT
        COUNT(*)::text AS deal_count,
        COALESCE(SUM(amount), 0)::text AS total_amount
      FROM deals
      WHERE workspace_id = $1
        AND (
          (source_data->'properties'->>'createdate') IS NOT NULL
          AND (source_data->'properties'->>'createdate')::timestamptz >= NOW() - INTERVAL '7 days'
        )`,
      [workspaceId]
    ),
  ]);

  const totals = totalsResult.rows[0];
  const closing = closingResult.rows[0];
  const stale = staleResult.rows[0];
  const winRateRow = winRateResult.rows[0];
  const newDeals = newDealsResult.rows[0];

  const totalPipeline = parseFloat(totals.total_amount) || 0;

  const won = parseInt(winRateRow.won, 10) || 0;
  const lost = parseInt(winRateRow.lost, 10) || 0;
  const totalClosed = won + lost;

  return {
    workspaceId,
    generatedAt: new Date().toISOString(),
    totalPipeline,
    dealCount: parseInt(totals.deal_count, 10) || 0,
    avgDealSize: Math.round(parseFloat(totals.avg_amount) || 0),
    byStage: byStageResult.rows.map(row => ({
      stage: row.stage,
      deal_count: parseInt(row.deal_count, 10) || 0,
      total_amount: parseFloat(row.total_amount) || 0,
    })),
    closingThisMonth: {
      dealCount: parseInt(closing.deal_count, 10) || 0,
      totalAmount: parseFloat(closing.total_amount) || 0,
    },
    staleDeals: {
      dealCount: parseInt(stale.deal_count, 10) || 0,
      totalAmount: parseFloat(stale.total_amount) || 0,
      staleDaysThreshold,
    },
    coverageRatio: effectiveQuota > 0
      ? Math.round((totalPipeline / effectiveQuota) * 100) / 100
      : null,
    winRate: {
      rate: totalClosed > 0
        ? Math.round((won / totalClosed) * 10000) / 100
        : null,
      won,
      lost,
    },
    newDealsThisWeek: {
      dealCount: parseInt(newDeals.deal_count, 10) || 0,
      totalAmount: parseFloat(newDeals.total_amount) || 0,
    },
  };
}
