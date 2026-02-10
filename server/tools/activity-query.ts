import { query } from '../db.js';

export interface Activity {
  id: string;
  workspace_id: string;
  source: string;
  source_id: string;
  source_data: Record<string, unknown>;
  activity_type: string;
  timestamp: string;
  actor: string;
  subject: string;
  body: string;
  deal_id: string;
  contact_id: string;
  account_id: string;
  direction: string;
  duration_seconds: number;
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ActivityFilters {
  activityType?: string;
  dealId?: string;
  contactId?: string;
  accountId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  actor?: string;
  sortBy?: 'timestamp' | 'activity_type' | 'created_at';
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

function buildWhereClause(workspaceId: string, filters: ActivityFilters) {
  const conditions: string[] = ['workspace_id = $1'];
  const params: unknown[] = [workspaceId];
  let idx = 2;

  if (filters.activityType !== undefined) {
    conditions.push(`activity_type = $${idx}`);
    params.push(filters.activityType);
    idx++;
  }

  if (filters.dealId !== undefined) {
    conditions.push(`deal_id = $${idx}`);
    params.push(filters.dealId);
    idx++;
  }

  if (filters.contactId !== undefined) {
    conditions.push(`contact_id = $${idx}`);
    params.push(filters.contactId);
    idx++;
  }

  if (filters.accountId !== undefined) {
    conditions.push(`account_id = $${idx}`);
    params.push(filters.accountId);
    idx++;
  }

  if (filters.dateFrom !== undefined) {
    conditions.push(`timestamp >= $${idx}`);
    params.push(filters.dateFrom);
    idx++;
  }

  if (filters.dateTo !== undefined) {
    conditions.push(`timestamp <= $${idx}`);
    params.push(filters.dateTo);
    idx++;
  }

  if (filters.actor !== undefined) {
    conditions.push(`actor = $${idx}`);
    params.push(filters.actor);
    idx++;
  }

  return { where: conditions.join(' AND '), params, idx };
}

const VALID_SORT_COLUMNS = new Set(['timestamp', 'activity_type', 'created_at']);

export async function queryActivities(workspaceId: string, filters: ActivityFilters): Promise<{ activities: Activity[]; total: number; limit: number; offset: number }> {
  const { where, params, idx } = buildWhereClause(workspaceId, filters);

  const sortBy = filters.sortBy && VALID_SORT_COLUMNS.has(filters.sortBy) ? filters.sortBy : 'timestamp';
  const sortDir = filters.sortDir === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM activities WHERE ${where}`,
    params,
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const dataParams = [...params, limit, offset];
  const dataResult = await query<Activity>(
    `SELECT * FROM activities WHERE ${where} ORDER BY ${sortBy} ${sortDir} LIMIT $${idx} OFFSET $${idx + 1}`,
    dataParams,
  );

  return { activities: dataResult.rows, total, limit, offset };
}

export async function getActivityTimeline(workspaceId: string, dealId: string): Promise<Activity[]> {
  const result = await query<Activity>(
    'SELECT * FROM activities WHERE workspace_id = $1 AND deal_id = $2 ORDER BY timestamp ASC',
    [workspaceId, dealId],
  );
  return result.rows;
}

export async function getActivitySummary(workspaceId: string, dateFrom: Date, dateTo: Date): Promise<{
  byType: { type: string; count: number }[];
  byRep: { actor: string; emails: number; calls: number; meetings: number; total: number }[];
  totalActivities: number;
}> {
  const byTypeResult = await query<{ activity_type: string; count: number }>(
    `SELECT activity_type, COUNT(*)::int as count FROM activities WHERE workspace_id = $1 AND timestamp BETWEEN $2 AND $3 GROUP BY activity_type ORDER BY count DESC`,
    [workspaceId, dateFrom, dateTo],
  );

  const byRepResult = await query<{ actor: string; activity_type: string; count: number }>(
    `SELECT actor, activity_type, COUNT(*)::int as count FROM activities WHERE workspace_id = $1 AND timestamp BETWEEN $2 AND $3 GROUP BY actor, activity_type ORDER BY actor`,
    [workspaceId, dateFrom, dateTo],
  );

  const byType = byTypeResult.rows.map((r) => ({
    type: r.activity_type,
    count: r.count,
  }));

  const repMap = new Map<string, { actor: string; emails: number; calls: number; meetings: number; total: number }>();
  for (const row of byRepResult.rows) {
    if (!repMap.has(row.actor)) {
      repMap.set(row.actor, { actor: row.actor, emails: 0, calls: 0, meetings: 0, total: 0 });
    }
    const rep = repMap.get(row.actor)!;
    if (row.activity_type === 'email') {
      rep.emails += row.count;
    } else if (row.activity_type === 'call') {
      rep.calls += row.count;
    } else if (row.activity_type === 'meeting') {
      rep.meetings += row.count;
    }
    rep.total += row.count;
  }

  const byRep = Array.from(repMap.values());

  const totalActivities = byType.reduce((sum, t) => sum + t.count, 0);

  return { byType, byRep, totalActivities };
}
