import { query } from '../db.js';

export interface Deal {
  id: string;
  workspace_id: string;
  source: string;
  source_id: string;
  source_data: Record<string, unknown>;
  name: string;
  amount: number;
  stage: string;
  close_date: string;
  owner: string;
  account_id: string;
  contact_id: string;
  probability: number;
  forecast_category: string;
  pipeline: string;
  days_in_stage: number;
  last_activity_date: string;
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  velocity_score: number;
  deal_risk: number;
  deal_risk_factors: Record<string, unknown>;
}

export interface DealFilters {
  stage?: string | string[];
  owner?: string;
  closeDateFrom?: Date;
  closeDateTo?: Date;
  amountMin?: number;
  amountMax?: number;
  dealRiskMin?: number;
  dealRiskMax?: number;
  daysInStageGt?: number;
  daysSinceActivityGt?: number;
  pipelineName?: string;
  search?: string;
  sortBy?: 'amount' | 'close_date' | 'deal_risk' | 'days_in_stage' | 'created_at';
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

function buildWhereClause(workspaceId: string, filters: DealFilters) {
  const conditions: string[] = ['workspace_id = $1'];
  const params: unknown[] = [workspaceId];
  let idx = 2;

  if (filters.stage !== undefined) {
    if (Array.isArray(filters.stage)) {
      conditions.push(`stage = ANY($${idx})`);
      params.push(filters.stage);
      idx++;
    } else {
      conditions.push(`stage = $${idx}`);
      params.push(filters.stage);
      idx++;
    }
  }

  if (filters.owner !== undefined) {
    conditions.push(`owner = $${idx}`);
    params.push(filters.owner);
    idx++;
  }

  if (filters.closeDateFrom !== undefined) {
    conditions.push(`close_date >= $${idx}`);
    params.push(filters.closeDateFrom);
    idx++;
  }

  if (filters.closeDateTo !== undefined) {
    conditions.push(`close_date <= $${idx}`);
    params.push(filters.closeDateTo);
    idx++;
  }

  if (filters.amountMin !== undefined) {
    conditions.push(`amount >= $${idx}`);
    params.push(filters.amountMin);
    idx++;
  }

  if (filters.amountMax !== undefined) {
    conditions.push(`amount <= $${idx}`);
    params.push(filters.amountMax);
    idx++;
  }

  if (filters.dealRiskMin !== undefined) {
    conditions.push(`deal_risk >= $${idx}`);
    params.push(filters.dealRiskMin);
    idx++;
  }

  if (filters.dealRiskMax !== undefined) {
    conditions.push(`deal_risk <= $${idx}`);
    params.push(filters.dealRiskMax);
    idx++;
  }

  if (filters.daysInStageGt !== undefined) {
    conditions.push(`days_in_stage > $${idx}`);
    params.push(filters.daysInStageGt);
    idx++;
  }

  if (filters.daysSinceActivityGt !== undefined) {
    conditions.push(`last_activity_date < NOW() - ($${idx} || ' days')::interval`);
    params.push(filters.daysSinceActivityGt);
    idx++;
  }

  if (filters.pipelineName !== undefined) {
    conditions.push(`pipeline = $${idx}`);
    params.push(filters.pipelineName);
    idx++;
  }

  if (filters.search !== undefined) {
    conditions.push(`name ILIKE $${idx}`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  return { where: conditions.join(' AND '), params, idx };
}

const VALID_SORT_COLUMNS = new Set(['amount', 'close_date', 'deal_risk', 'days_in_stage', 'created_at']);

export async function queryDeals(workspaceId: string, filters: DealFilters): Promise<{ deals: Deal[]; total: number; limit: number; offset: number }> {
  const { where, params, idx } = buildWhereClause(workspaceId, filters);

  const sortBy = filters.sortBy && VALID_SORT_COLUMNS.has(filters.sortBy) ? filters.sortBy : 'close_date';
  const sortDir = filters.sortDir === 'desc' ? 'DESC' : 'ASC';
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM deals WHERE ${where}`,
    params,
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const dataParams = [...params, limit, offset];
  const dataResult = await query<Deal>(
    `SELECT * FROM deals WHERE ${where} ORDER BY ${sortBy} ${sortDir} LIMIT $${idx} OFFSET $${idx + 1}`,
    dataParams,
  );

  return { deals: dataResult.rows, total, limit, offset };
}

export async function getDeal(workspaceId: string, dealId: string): Promise<Deal | null> {
  const result = await query<Deal>(
    'SELECT * FROM deals WHERE workspace_id = $1 AND id = $2',
    [workspaceId, dealId],
  );
  return result.rows[0] ?? null;
}

export async function getDealsByStage(workspaceId: string): Promise<{ stages: { stage: string; count: number; totalAmount: number; avgAmount: number }[] }> {
  const result = await query<{ stage: string; count: string; total_amount: string; avg_amount: string }>(
    `SELECT stage, COUNT(*) AS count, SUM(amount) AS total_amount, AVG(amount) AS avg_amount FROM deals WHERE workspace_id = $1 GROUP BY stage`,
    [workspaceId],
  );
  return {
    stages: result.rows.map((r) => ({
      stage: r.stage,
      count: parseInt(r.count, 10),
      totalAmount: parseFloat(r.total_amount) || 0,
      avgAmount: parseFloat(r.avg_amount) || 0,
    })),
  };
}

export async function getStaleDeals(workspaceId: string, daysSinceActivity: number = 14): Promise<Deal[]> {
  const result = await query<Deal>(
    `SELECT * FROM deals WHERE workspace_id = $1 AND last_activity_date < NOW() - ($2 || ' days')::interval ORDER BY last_activity_date ASC`,
    [workspaceId, daysSinceActivity],
  );
  return result.rows;
}

export async function getDealsClosingInRange(workspaceId: string, startDate: Date, endDate: Date): Promise<Deal[]> {
  const result = await query<Deal>(
    'SELECT * FROM deals WHERE workspace_id = $1 AND close_date >= $2 AND close_date <= $3 ORDER BY amount DESC',
    [workspaceId, startDate, endDate],
  );
  return result.rows;
}

export async function getPipelineSummary(workspaceId: string): Promise<{
  totalPipeline: number;
  dealCount: number;
  avgDealSize: number;
  weightedPipeline: number;
  byForecastCategory: { category: string; count: number; totalAmount: number }[];
}> {
  const summaryResult = await query<{
    total_pipeline: string;
    deal_count: string;
    avg_deal_size: string;
    weighted_pipeline: string;
  }>(
    `SELECT COALESCE(SUM(amount), 0) AS total_pipeline, COUNT(*) AS deal_count, COALESCE(AVG(amount), 0) AS avg_deal_size, COALESCE(SUM(amount * COALESCE(probability, 0) / 100), 0) AS weighted_pipeline FROM deals WHERE workspace_id = $1`,
    [workspaceId],
  );

  const forecastResult = await query<{ category: string; count: string; total_amount: string }>(
    `SELECT forecast_category AS category, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total_amount FROM deals WHERE workspace_id = $1 GROUP BY forecast_category`,
    [workspaceId],
  );

  const s = summaryResult.rows[0];
  return {
    totalPipeline: parseFloat(s.total_pipeline) || 0,
    dealCount: parseInt(s.deal_count, 10),
    avgDealSize: parseFloat(s.avg_deal_size) || 0,
    weightedPipeline: parseFloat(s.weighted_pipeline) || 0,
    byForecastCategory: forecastResult.rows.map((r) => ({
      category: r.category,
      count: parseInt(r.count, 10),
      totalAmount: parseFloat(r.total_amount) || 0,
    })),
  };
}
