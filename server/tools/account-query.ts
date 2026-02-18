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
  open_deal_count: number;
  owner: string;
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
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
  sortBy?: 'name' | 'annual_revenue' | 'employee_count' | 'health_score' | 'created_at' | 'total_score';
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

function buildWhereClause(workspaceId: string, filters: AccountFilters, tableAlias: string = '') {
  const t = tableAlias ? `${tableAlias}.` : '';
  const conditions: string[] = [`${t}workspace_id = $1`];
  const params: unknown[] = [workspaceId];
  let idx = 2;

  if (filters.domain !== undefined) {
    conditions.push(`${t}domain = $${idx}`);
    params.push(filters.domain);
    idx++;
  }

  if (filters.industry !== undefined) {
    conditions.push(`${t}industry = $${idx}`);
    params.push(filters.industry);
    idx++;
  }

  if (filters.owner !== undefined) {
    conditions.push(`${t}owner = $${idx}`);
    params.push(filters.owner);
    idx++;
  }

  if (filters.employeeCountMin !== undefined) {
    conditions.push(`${t}employee_count >= $${idx}`);
    params.push(filters.employeeCountMin);
    idx++;
  }

  if (filters.employeeCountMax !== undefined) {
    conditions.push(`${t}employee_count <= $${idx}`);
    params.push(filters.employeeCountMax);
    idx++;
  }

  if (filters.revenueMin !== undefined) {
    conditions.push(`${t}annual_revenue >= $${idx}`);
    params.push(filters.revenueMin);
    idx++;
  }

  if (filters.revenueMax !== undefined) {
    conditions.push(`${t}annual_revenue <= $${idx}`);
    params.push(filters.revenueMax);
    idx++;
  }

  if (filters.search !== undefined) {
    conditions.push(`(${t}name ILIKE $${idx} OR ${t}domain ILIKE $${idx})`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  return { where: conditions.join(' AND '), params, idx };
}

const VALID_SORT_COLUMNS = new Set(['name', 'annual_revenue', 'employee_count', 'health_score', 'created_at', 'total_score']);

export async function queryAccounts(workspaceId: string, filters: AccountFilters): Promise<{ accounts: (Account & { total_score?: number; grade?: string; signal_summary?: string; data_quality?: string; company_type?: string })[]; total: number; limit: number; offset: number }> {
  const { where, params, idx } = buildWhereClause(workspaceId, filters, 'a');

  const sortBy = filters.sortBy && VALID_SORT_COLUMNS.has(filters.sortBy) ? filters.sortBy : 'name';
  const sortDir = filters.sortDir === 'desc' ? 'DESC' : 'ASC';
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM accounts a WHERE ${where}`,
    params,
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const sortColumn = sortBy === 'total_score' ? 'acs.total_score' : `a.${sortBy}`;
  const nullsClause = sortBy === 'total_score' ? (sortDir === 'DESC' ? ' NULLS LAST' : ' NULLS FIRST') : '';

  const dataParams = [...params, limit, offset];
  const dataResult = await query<Account & { total_score: number | null; grade: string | null; signal_summary: string | null; data_quality: string | null; company_type: string | null }>(
    `SELECT a.*, acs.total_score, acs.grade,
            asi.signal_summary, asi.data_quality, asi.company_type
     FROM accounts a
     LEFT JOIN account_scores acs ON acs.account_id = a.id AND acs.workspace_id = a.workspace_id
     LEFT JOIN account_signals asi ON asi.account_id = a.id AND asi.workspace_id = a.workspace_id
     WHERE ${where}
     ORDER BY ${sortColumn} ${sortDir}${nullsClause}
     LIMIT $${idx} OFFSET $${idx + 1}`,
    dataParams,
  );

  return { accounts: dataResult.rows, total, limit, offset };
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
