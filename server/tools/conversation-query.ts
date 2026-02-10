import { query } from '../db.js';

export interface Conversation {
  id: string;
  workspace_id: string;
  source: string;
  source_id: string;
  source_data: Record<string, unknown>;
  call_date: string;
  duration_seconds: number;
  participants: unknown[];
  deal_id: string;
  account_id: string;
  transcript_text: string;
  summary: string;
  action_items: unknown[];
  objections: unknown[];
  sentiment_score: number;
  talk_listen_ratio: Record<string, unknown>;
  topics: unknown[];
  competitor_mentions: unknown[];
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ConversationFilters {
  dealId?: string;
  accountId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  source?: string;
  search?: string;
  sortBy?: 'call_date' | 'duration_seconds' | 'sentiment_score' | 'created_at';
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

const LIST_COLUMNS = [
  'id', 'workspace_id', 'source', 'source_id', 'source_data',
  'call_date', 'duration_seconds', 'participants',
  'deal_id', 'account_id',
  'summary', 'action_items', 'objections',
  'sentiment_score', 'talk_listen_ratio', 'topics', 'competitor_mentions',
  'custom_fields', 'created_at', 'updated_at',
].join(', ');

const VALID_SORT_COLUMNS = new Set(['call_date', 'duration_seconds', 'sentiment_score', 'created_at']);

function buildWhereClause(workspaceId: string, filters: ConversationFilters) {
  const conditions: string[] = ['workspace_id = $1'];
  const params: unknown[] = [workspaceId];
  let idx = 2;

  if (filters.dealId !== undefined) {
    conditions.push(`deal_id = $${idx}`);
    params.push(filters.dealId);
    idx++;
  }

  if (filters.accountId !== undefined) {
    conditions.push(`account_id = $${idx}`);
    params.push(filters.accountId);
    idx++;
  }

  if (filters.dateFrom !== undefined) {
    conditions.push(`call_date >= $${idx}`);
    params.push(filters.dateFrom);
    idx++;
  }

  if (filters.dateTo !== undefined) {
    conditions.push(`call_date <= $${idx}`);
    params.push(filters.dateTo);
    idx++;
  }

  if (filters.source !== undefined) {
    conditions.push(`source = $${idx}`);
    params.push(filters.source);
    idx++;
  }

  if (filters.search !== undefined) {
    conditions.push(`(summary ILIKE $${idx} OR transcript_text ILIKE $${idx})`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  return { where: conditions.join(' AND '), params, idx };
}

export async function queryConversations(workspaceId: string, filters: ConversationFilters): Promise<{ conversations: Conversation[]; total: number; limit: number; offset: number }> {
  const { where, params, idx } = buildWhereClause(workspaceId, filters);

  const sortBy = filters.sortBy && VALID_SORT_COLUMNS.has(filters.sortBy) ? filters.sortBy : 'call_date';
  const sortDir = filters.sortDir === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM conversations WHERE ${where}`,
    params,
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const dataParams = [...params, limit, offset];
  const dataResult = await query<Conversation>(
    `SELECT ${LIST_COLUMNS} FROM conversations WHERE ${where} ORDER BY ${sortBy} ${sortDir} LIMIT $${idx} OFFSET $${idx + 1}`,
    dataParams,
  );

  return { conversations: dataResult.rows, total, limit, offset };
}

export async function getConversation(workspaceId: string, conversationId: string): Promise<Conversation | null> {
  const result = await query<Conversation>(
    'SELECT * FROM conversations WHERE workspace_id = $1 AND id = $2',
    [workspaceId, conversationId],
  );
  return result.rows[0] ?? null;
}

export async function getRecentCallsForDeal(workspaceId: string, dealId: string, limit: number = 5): Promise<Conversation[]> {
  const result = await query<Conversation>(
    `SELECT ${LIST_COLUMNS} FROM conversations WHERE workspace_id = $1 AND deal_id = $2 ORDER BY call_date DESC LIMIT $3`,
    [workspaceId, dealId, limit],
  );
  return result.rows;
}

export async function getCallInsights(workspaceId: string, dateFrom: Date, dateTo: Date): Promise<{
  totalCalls: number;
  avgDuration: number | null;
  avgSentiment: number | null;
  topObjections: { text: string; count: number }[];
  topCompetitorMentions: { name: string; count: number }[];
}> {
  const [statsResult, objectionsResult, competitorResult] = await Promise.all([
    query<{ total_calls: number; avg_duration: number | null; avg_sentiment: number | null }>(
      `SELECT COUNT(*)::int AS total_calls, AVG(duration_seconds)::int AS avg_duration, AVG(sentiment_score) AS avg_sentiment FROM conversations WHERE workspace_id = $1 AND call_date BETWEEN $2 AND $3`,
      [workspaceId, dateFrom, dateTo],
    ),
    query<{ objection: string; count: number }>(
      `SELECT obj->>'text' AS objection, COUNT(*)::int AS count FROM conversations, jsonb_array_elements(COALESCE(objections, '[]'::jsonb)) AS obj WHERE workspace_id = $1 AND call_date BETWEEN $2 AND $3 GROUP BY obj->>'text' ORDER BY count DESC LIMIT 10`,
      [workspaceId, dateFrom, dateTo],
    ),
    query<{ name: string; count: number }>(
      `SELECT obj->>'name' AS name, COUNT(*)::int AS count FROM conversations, jsonb_array_elements(COALESCE(competitor_mentions, '[]'::jsonb)) AS obj WHERE workspace_id = $1 AND call_date BETWEEN $2 AND $3 GROUP BY obj->>'name' ORDER BY count DESC LIMIT 10`,
      [workspaceId, dateFrom, dateTo],
    ),
  ]);

  const stats = statsResult.rows[0];

  return {
    totalCalls: stats.total_calls,
    avgDuration: stats.avg_duration,
    avgSentiment: stats.avg_sentiment !== null ? parseFloat(String(stats.avg_sentiment)) : null,
    topObjections: objectionsResult.rows.map((r) => ({ text: r.objection, count: r.count })),
    topCompetitorMentions: competitorResult.rows.map((r) => ({ name: r.name, count: r.count })),
  };
}
