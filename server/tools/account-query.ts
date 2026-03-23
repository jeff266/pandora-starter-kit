import { query } from '../db.js';

export interface Account {
  id: string;
  workspace_id: string;
  source: string;
  source_id: string;
  source_data: Record<string, unknown>;
  name: string;
  domain: string;
  industry: string;
  employee_count: number;
  annual_revenue: number;
  health_score: number;
  open_deal_count: number; // Now computed live via LATERAL JOIN
  owner: string;
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // Live-computed deal stats (from LATERAL JOIN)
  total_pipeline_value?: number;
  total_deal_count?: number;
  last_conversation_date?: string;
  conversation_count?: number;
  // Account scoring fields (joined from account_scores + account_signals)
  total_score?: number;
  grade?: string;
  score_delta?: number;
  data_confidence?: number;
  signals?: unknown[];
  signal_score?: number;
  signal_industry?: string;
  growth_stage?: string;
  classification_confidence?: number;
  // Tri-signal fields
  quality_pipeline?: number;
  deal_grade_breakdown?: Record<string, number>;
  min_recency_days?: number;
  icp_grade?: string | null;
}

interface AccountDeal {
  id: string;
  name: string;
  amount: number;
  stage: string;
  deal_risk: number;
  last_activity_date: string;
  close_date: string;
}

export interface AccountFilters {
  domain?: string;
  industry?: string;
  owner?: string;
  employeeCountMin?: number;
  employeeCountMax?: number;
  revenueMin?: number;
  revenueMax?: number;
  search?: string;
  sortBy?: 'name' | 'annual_revenue' | 'employee_count' | 'health_score' | 'created_at' | 'total_score' | 'open_deals' | 'pipeline_value' | 'last_activity' | 'quality_pipeline';
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  additionalWhere?: string;
  additionalParams?: unknown[];
  properties?: string[]; // Additional custom field internal_names to extract from custom_fields JSONB
  hasOpenDeals?: boolean; // Filter to accounts with open deals only
}

function buildWhereClause(workspaceId: string, filters: AccountFilters) {
  const conditions: string[] = ['workspace_id = $1'];
  const params: unknown[] = [workspaceId];
  let idx = 2;

  if (filters.domain !== undefined) {
    conditions.push(`domain = $${idx}`);
    params.push(filters.domain);
    idx++;
  }

  if (filters.industry !== undefined) {
    conditions.push(`industry = $${idx}`);
    params.push(filters.industry);
    idx++;
  }

  if (filters.owner !== undefined) {
    conditions.push(`owner = $${idx}`);
    params.push(filters.owner);
    idx++;
  }

  if (filters.employeeCountMin !== undefined) {
    conditions.push(`employee_count >= $${idx}`);
    params.push(filters.employeeCountMin);
    idx++;
  }

  if (filters.employeeCountMax !== undefined) {
    conditions.push(`employee_count <= $${idx}`);
    params.push(filters.employeeCountMax);
    idx++;
  }

  if (filters.revenueMin !== undefined) {
    conditions.push(`annual_revenue >= $${idx}`);
    params.push(filters.revenueMin);
    idx++;
  }

  if (filters.revenueMax !== undefined) {
    conditions.push(`annual_revenue <= $${idx}`);
    params.push(filters.revenueMax);
    idx++;
  }

  if (filters.search !== undefined) {
    conditions.push(`(name ILIKE $${idx} OR domain ILIKE $${idx})`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  if (filters.additionalWhere) {
    let renumbered = filters.additionalWhere;
    if (filters.additionalParams && filters.additionalParams.length > 0) {
      renumbered = renumbered.replace(/\$(\d+)/g, (_match, num) => `$${parseInt(num, 10) - 1 + idx}`);
      params.push(...filters.additionalParams);
      idx += filters.additionalParams.length;
    }
    conditions.push(renumbered);
  }

  return { where: conditions.join(' AND '), params, idx };
}

const VALID_SORT_COLUMNS = new Set(['name', 'annual_revenue', 'employee_count', 'health_score', 'created_at', 'total_score', 'open_deals', 'pipeline_value', 'last_activity', 'quality_pipeline']);

/**
 * Extract requested custom fields from the custom_fields JSONB column
 * and add them as top-level properties on the account object
 */
function extractCustomFields<T extends { custom_fields?: Record<string, unknown> }>(
  record: T,
  properties?: string[]
): T & Record<string, unknown> {
  if (!properties || properties.length === 0 || !record.custom_fields) {
    return record;
  }

  const extracted: Record<string, unknown> = { ...record };

  for (const prop of properties) {
    if (prop in record.custom_fields) {
      extracted[prop] = record.custom_fields[prop];
    }
  }

  return (extracted) as any;
}

export async function queryAccounts(workspaceId: string, filters: AccountFilters): Promise<{
  accounts: Account[];
  total: number;
  limit: number;
  offset: number;
  summary?: {
    total_accounts: number;
    with_open_deals: number;
    with_conversations: number;
  };
}> {
  const { where, params, idx } = buildWhereClause(workspaceId, filters);

  // Build has_open_deals filter if specified
  let hasOpenDealsWhere = '';
  if (filters.hasOpenDeals) {
    hasOpenDealsWhere = ` AND EXISTS (
      SELECT 1 FROM deals d
      WHERE d.account_id = a.id
        AND d.workspace_id = a.workspace_id
        AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
    )`;
  }

  // Default sort: accounts with open deals first, then by recent conversation activity
  const rawSort = (filters.sortBy && VALID_SORT_COLUMNS.has(filters.sortBy) ? filters.sortBy : 'open_deals') as string;
  const sortDir = filters.sortDir === 'desc' ? 'DESC' : 'ASC';

  // Map sort field to SQL expression
  let sortExpr: string;
  if (rawSort === 'total_score') {
    sortExpr = `acs.total_score ${sortDir} NULLS LAST`;
  } else if (rawSort === 'open_deals') {
    // Default: open deals DESC, recent activity DESC, name ASC
    sortExpr = `COALESCE(deal_stats.open_deal_count, 0) DESC, COALESCE(conv_stats.last_conversation_date, '1970-01-01'::date) DESC, a.name ASC`;
  } else if (rawSort === 'pipeline_value') {
    sortExpr = `COALESCE(deal_stats.total_pipeline_value, 0) ${sortDir}`;
  } else if (rawSort === 'quality_pipeline') {
    sortExpr = `COALESCE(deal_stats.quality_pipeline, 0) ${sortDir} NULLS LAST`;
  } else if (rawSort === 'last_activity') {
    sortExpr = `COALESCE(conv_stats.last_conversation_date, '1970-01-01'::date) ${sortDir}`;
  } else {
    sortExpr = `a.${rawSort} ${sortDir}`;
  }

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  // Run count query and summary query in parallel
  const [countResult, summaryResult] = await Promise.all([
    query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM accounts a WHERE ${where.replace('workspace_id', 'a.workspace_id')}${hasOpenDealsWhere}`,
      params,
    ),
    query<{ total_accounts: string; with_open_deals: string; with_conversations: string }>(
      `SELECT
         COUNT(*) as total_accounts,
         COUNT(*) FILTER (
           WHERE EXISTS (
             SELECT 1 FROM deals d
             WHERE d.account_id = a.id
               AND d.workspace_id = a.workspace_id
               AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
           )
         ) as with_open_deals,
         COUNT(*) FILTER (
           WHERE EXISTS (
             SELECT 1 FROM conversations c
             WHERE c.account_id = a.id
               AND c.workspace_id = a.workspace_id
           )
         ) as with_conversations
       FROM accounts a
       WHERE ${where.replace('workspace_id', 'a.workspace_id')}`,
      params,
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);
  const summary = summaryResult.rows[0] ? {
    total_accounts: parseInt(summaryResult.rows[0].total_accounts, 10),
    with_open_deals: parseInt(summaryResult.rows[0].with_open_deals, 10),
    with_conversations: parseInt(summaryResult.rows[0].with_conversations, 10),
  } : undefined;

  const dataParams = [...params, limit, offset];
  const dataResult = await query<Account>(
    `SELECT
       a.*,
       COALESCE(deal_stats.open_deal_count, 0) as open_deal_count,
       COALESCE(deal_stats.total_pipeline_value, 0) as total_pipeline_value,
       COALESCE(deal_stats.total_deal_count, 0) as total_deal_count,
       deal_stats.quality_pipeline,
       deal_stats.deal_grade_breakdown,
       deal_stats.min_recency_days,
       conv_stats.last_conversation_date,
       conv_stats.conversation_count,
       acs.total_score, acs.grade, acs.score_delta, acs.data_confidence,
       asig.signals, asig.signal_score, asig.industry AS signal_industry,
       asig.growth_stage, asig.classification_confidence,
       icp_stats.icp_grade
     FROM accounts a
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*) FILTER (
           WHERE d.stage_normalized NOT IN ('closed_won', 'closed_lost')
         ) as open_deal_count,
         SUM(d.amount) FILTER (
           WHERE d.stage_normalized NOT IN ('closed_won', 'closed_lost')
         ) as total_pipeline_value,
         COUNT(*) as total_deal_count,
         SUM(d.amount * COALESCE(d.tte_conditional_prob, 0.25)) FILTER (
           WHERE d.stage_normalized NOT IN ('closed_won', 'closed_lost')
         ) as quality_pipeline,
         jsonb_build_object(
           'A', COUNT(*) FILTER (WHERE d.rfm_grade = 'A' AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')),
           'B', COUNT(*) FILTER (WHERE d.rfm_grade = 'B' AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')),
           'C', COUNT(*) FILTER (WHERE d.rfm_grade = 'C' AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')),
           'D', COUNT(*) FILTER (WHERE d.rfm_grade = 'D' AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')),
           'F', COUNT(*) FILTER (WHERE d.rfm_grade = 'F' AND d.stage_normalized NOT IN ('closed_won', 'closed_lost'))
         ) as deal_grade_breakdown,
         MIN(d.rfm_recency_days) FILTER (WHERE d.stage_normalized NOT IN ('closed_won', 'closed_lost')) as min_recency_days
       FROM deals d
       WHERE d.account_id = a.id AND d.workspace_id = a.workspace_id
     ) deal_stats ON true
     LEFT JOIN LATERAL (
       SELECT
         MAX(c.call_date) as last_conversation_date,
         COUNT(*) as conversation_count
       FROM conversations c
       WHERE c.account_id = a.id AND c.workspace_id = a.workspace_id
     ) conv_stats ON true
     LEFT JOIN account_scores acs ON acs.account_id = a.id AND acs.workspace_id = a.workspace_id
     LEFT JOIN account_signals asig ON asig.account_id = a.id AND asig.workspace_id = a.workspace_id
     LEFT JOIN LATERAL (
       SELECT ls.score_grade as icp_grade
       FROM lead_scores ls
       WHERE ls.entity_id IN (
           SELECT id FROM deals
           WHERE account_id = a.id AND workspace_id = a.workspace_id
             AND stage_normalized NOT IN ('closed_won', 'closed_lost')
         )
         AND ls.entity_type = 'deal'
       ORDER BY CASE ls.score_grade WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 WHEN 'D' THEN 4 WHEN 'F' THEN 5 ELSE 6 END ASC
       LIMIT 1
     ) icp_stats ON true
     WHERE ${where.replace(/\bworkspace_id\b/g, 'a.workspace_id')}${hasOpenDealsWhere}
     ORDER BY ${sortExpr}
     LIMIT $${idx} OFFSET $${idx + 1}`,
    dataParams,
  );

  // Extract custom fields if properties parameter provided
  const accounts = dataResult.rows.map(account => extractCustomFields(account, filters.properties));

  return { accounts, total, limit, offset, summary };
}

export async function getAccount(workspaceId: string, accountId: string): Promise<(Account & { openDealCount: number; openDealValue: number; contactCount: number; recentActivityCount: number }) | null> {
  const result = await query<Account & { openDealCount: string; openDealValue: string; contactCount: string; recentActivityCount: string }>(
    `SELECT a.*,
      (SELECT COUNT(*) FROM deals WHERE workspace_id = $1 AND account_id = $2 AND stage NOT IN ('closed_won', 'closed_lost', 'closedwon', 'closedlost')) AS "openDealCount",
      (SELECT COALESCE(SUM(amount), 0) FROM deals WHERE workspace_id = $1 AND account_id = $2 AND stage NOT IN ('closed_won', 'closed_lost', 'closedwon', 'closedlost')) AS "openDealValue",
      (SELECT COUNT(*) FROM contacts WHERE workspace_id = $1 AND account_id = $2) AS "contactCount",
      (SELECT COUNT(*) FROM activities WHERE workspace_id = $1 AND account_id = $2 AND timestamp > NOW() - INTERVAL '30 days') AS "recentActivityCount"
    FROM accounts a
    WHERE a.workspace_id = $1 AND a.id = $2`,
    [workspaceId, accountId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    ...row,
    openDealCount: parseInt(row.openDealCount as string, 10),
    openDealValue: parseFloat(row.openDealValue as string) || 0,
    contactCount: parseInt(row.contactCount as string, 10),
    recentActivityCount: parseInt(row.recentActivityCount as string, 10),
  };
}

export async function getAccountHealth(workspaceId: string, accountId: string): Promise<{ account: { id: string; name: string }; deals: AccountDeal[]; avgDealRisk: number | null; totalPipeline: number; oldestStaleDate: Date | null }> {
  const accountResult = await query<{ id: string; name: string }>(
    'SELECT id, name FROM accounts WHERE workspace_id = $1 AND id = $2',
    [workspaceId, accountId],
  );
  const account = accountResult.rows[0] ?? { id: accountId, name: '' };

  const dealsResult = await query<AccountDeal>(
    `SELECT id, name, amount, stage, deal_risk, last_activity_date, close_date FROM deals WHERE workspace_id = $1 AND account_id = $2 AND stage NOT IN ('closed_won', 'closed_lost', 'closedwon', 'closedlost')`,
    [workspaceId, accountId],
  );
  const deals = dealsResult.rows;

  let avgDealRisk: number | null = null;
  let totalPipeline = 0;
  let oldestStaleDate: Date | null = null;

  if (deals.length > 0) {
    const risks = deals.filter(d => d.deal_risk != null).map(d => d.deal_risk);
    avgDealRisk = risks.length > 0 ? risks.reduce((sum, r) => sum + r, 0) / risks.length : null;

    totalPipeline = deals.reduce((sum, d) => sum + (d.amount || 0), 0);

    for (const d of deals) {
      if (d.last_activity_date != null) {
        const date = new Date(d.last_activity_date);
        if (oldestStaleDate === null || date < oldestStaleDate) {
          oldestStaleDate = date;
        }
      }
    }
  }

  return { account, deals, avgDealRisk, totalPipeline, oldestStaleDate };
}
