import { query } from '../db.js';

export async function queryDealOutcomes(workspaceId: string, params: Record<string, any>) {
  const values: any[] = [workspaceId];
  const filters: string[] = [];

  if (params.outcome) {
    filters.push(`outcome = $${values.push(params.outcome)}`);
  }
  if (params.stage_at_close) {
    filters.push(`stage_at_close ILIKE $${values.push(`%${params.stage_at_close}%`)}`);
  }
  if (params.amount_min != null) {
    filters.push(`amount >= $${values.push(params.amount_min)}`);
  }
  if (params.amount_max != null) {
    filters.push(`amount <= $${values.push(params.amount_max)}`);
  }
  if (params.closed_after) {
    filters.push(`closed_at >= $${values.push(params.closed_after)}`);
  }
  if (params.closed_before) {
    filters.push(`closed_at <= $${values.push(params.closed_before)}`);
  }

  const whereClause = filters.length > 0 ? `AND ${filters.join(' AND ')}` : '';
  const limit = Math.min(params.limit || 50, 200);
  const orderBy = params.order_by || 'closed_at';
  const orderDir = orderBy === 'closed_at' ? 'DESC' : 'ASC';

  const sql = `
    SELECT
      deal_id,
      deal_name,
      outcome,
      amount,
      closed_at,
      days_open,
      composite_score,
      crm_score,
      skill_score,
      conversation_score,
      stage_at_close
    FROM deal_outcomes
    WHERE workspace_id = $1
      ${whereClause}
    ORDER BY ${orderBy} ${orderDir}
    LIMIT ${limit}
  `;

  const result = await query<any>(sql, values);

  const outcomeBreakdown: Record<string, number> = {};
  for (const row of result.rows) {
    outcomeBreakdown[row.outcome] = (outcomeBreakdown[row.outcome] || 0) + 1;
  }

  return {
    outcomes: result.rows,
    total_count: result.rows.length,
    outcome_breakdown: outcomeBreakdown,
    query_description: `Deal outcomes ${params.outcome ? `(${params.outcome})` : '(won+lost)'} — ${result.rows.length} records`,
  };
}
