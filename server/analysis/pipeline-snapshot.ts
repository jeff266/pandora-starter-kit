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
}

export async function generatePipelineSnapshot(
  workspaceId: string,
  quota?: number
): Promise<PipelineSnapshot> {
  const [totalsResult, byStageResult, closingResult, staleResult] = await Promise.all([
    query<{ deal_count: string; total_amount: string; avg_amount: string }>(
      `SELECT
        COUNT(*)::text AS deal_count,
        COALESCE(SUM(amount), 0)::text AS total_amount,
        COALESCE(AVG(amount), 0)::text AS avg_amount
      FROM deals
      WHERE workspace_id = $1
        AND stage NOT IN ('closedwon', 'closedlost', 'closed won', 'closed lost')
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
        AND stage NOT IN ('closedwon', 'closedlost', 'closed won', 'closed lost')
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
        AND stage NOT IN ('closedwon', 'closedlost', 'closed won', 'closed lost')
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
        AND stage NOT IN ('closedwon', 'closedlost', 'closed won', 'closed lost')
        AND (
          last_activity_date IS NULL
          OR last_activity_date < NOW() - INTERVAL '14 days'
        )`,
      [workspaceId]
    ),
  ]);

  const totals = totalsResult.rows[0];
  const closing = closingResult.rows[0];
  const stale = staleResult.rows[0];

  const totalPipeline = parseFloat(totals.total_amount) || 0;

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
      staleDaysThreshold: 14,
    },
    coverageRatio: quota && quota > 0
      ? Math.round((totalPipeline / quota) * 100) / 100
      : null,
  };
}
