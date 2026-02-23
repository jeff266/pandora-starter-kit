/**
 * Query Conversation Signals
 *
 * Provides structured query interface for conversation_signals table.
 * Used by Ask Pandora tool: query_conversation_signals
 */

import { query } from '../db.js';
import type { SignalType } from './extract-conversation-signals.js';

export interface ConversationSignal {
  id: string;
  workspace_id: string;
  conversation_id: string;
  signal_type: SignalType;
  signal_value: string;
  confidence: number;
  source_quote: string | null;
  sentiment: string | null;
  deal_id: string | null;
  account_id: string | null;
  rep_email: string | null;
  extracted_at: string;
  extraction_method: string;
  model_version: string | null;
  created_at: string;
  // Joined conversation data
  conversation_title?: string;
  conversation_date?: string;
  deal_name?: string;
  account_name?: string;
}

export interface SignalQueryFilters {
  signal_type?: SignalType;
  signal_value?: string;  // Partial match (ILIKE)
  deal_id?: string;
  account_id?: string;
  rep_email?: string;
  from_date?: string;  // ISO date
  to_date?: string;    // ISO date
  min_confidence?: number;
  sentiment?: 'positive' | 'neutral' | 'negative';
  limit?: number;
  offset?: number;
}

export interface SignalQueryResult {
  signals: ConversationSignal[];
  total: number;
  limit: number;
  offset: number;
}

export async function queryConversationSignals(
  workspaceId: string,
  filters: SignalQueryFilters
): Promise<SignalQueryResult> {
  const { where, params, idx } = buildWhereClause(workspaceId, filters);

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  // Count query
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM conversation_signals cs
     WHERE ${where}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Data query with joins
  const dataParams = [...params, limit, offset];
  const dataResult = await query<ConversationSignal>(
    `SELECT cs.*,
            c.title as conversation_title,
            c.call_date as conversation_date,
            d.name as deal_name,
            a.name as account_name
     FROM conversation_signals cs
     LEFT JOIN conversations c ON c.id = cs.conversation_id
     LEFT JOIN deals d ON d.id = cs.deal_id
     LEFT JOIN accounts a ON a.id = cs.account_id
     WHERE ${where}
     ORDER BY cs.extracted_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    dataParams
  );

  return {
    signals: dataResult.rows,
    total,
    limit,
    offset,
  };
}

function buildWhereClause(workspaceId: string, filters: SignalQueryFilters) {
  const conditions: string[] = ['cs.workspace_id = $1'];
  const params: unknown[] = [workspaceId];
  let idx = 2;

  if (filters.signal_type !== undefined) {
    conditions.push(`cs.signal_type = $${idx}`);
    params.push(filters.signal_type);
    idx++;
  }

  if (filters.signal_value !== undefined) {
    conditions.push(`cs.signal_value ILIKE $${idx}`);
    params.push(`%${filters.signal_value}%`);
    idx++;
  }

  if (filters.deal_id !== undefined) {
    conditions.push(`cs.deal_id = $${idx}`);
    params.push(filters.deal_id);
    idx++;
  }

  if (filters.account_id !== undefined) {
    conditions.push(`cs.account_id = $${idx}`);
    params.push(filters.account_id);
    idx++;
  }

  if (filters.rep_email !== undefined) {
    conditions.push(`cs.rep_email = $${idx}`);
    params.push(filters.rep_email);
    idx++;
  }

  if (filters.from_date !== undefined) {
    conditions.push(`cs.extracted_at >= $${idx}`);
    params.push(filters.from_date);
    idx++;
  }

  if (filters.to_date !== undefined) {
    conditions.push(`cs.extracted_at <= $${idx}`);
    params.push(filters.to_date);
    idx++;
  }

  if (filters.min_confidence !== undefined) {
    conditions.push(`cs.confidence >= $${idx}`);
    params.push(filters.min_confidence);
    idx++;
  } else {
    // Default to 0.65 minimum confidence
    conditions.push(`cs.confidence >= $${idx}`);
    params.push(0.65);
    idx++;
  }

  if (filters.sentiment !== undefined) {
    conditions.push(`cs.sentiment = $${idx}`);
    params.push(filters.sentiment);
    idx++;
  }

  return { where: conditions.join(' AND '), params, idx };
}

/**
 * Get signals for a specific deal
 */
export async function getSignalsForDeal(
  workspaceId: string,
  dealId: string
): Promise<ConversationSignal[]> {
  const result = await queryConversationSignals(workspaceId, {
    deal_id: dealId,
    limit: 100,
  });
  return result.signals;
}

/**
 * Get signals for a specific account
 */
export async function getSignalsForAccount(
  workspaceId: string,
  accountId: string
): Promise<ConversationSignal[]> {
  const result = await queryConversationSignals(workspaceId, {
    account_id: accountId,
    limit: 200,
  });
  return result.signals;
}

/**
 * Get signal type breakdown for a workspace
 */
export async function getSignalTypeBreakdown(
  workspaceId: string,
  fromDate?: string,
  toDate?: string
): Promise<{ signal_type: string; count: number; avg_confidence: number }[]> {
  const conditions = ['workspace_id = $1'];
  const params: unknown[] = [workspaceId];
  let idx = 2;

  if (fromDate) {
    conditions.push(`extracted_at >= $${idx}`);
    params.push(fromDate);
    idx++;
  }

  if (toDate) {
    conditions.push(`extracted_at <= $${idx}`);
    params.push(toDate);
    idx++;
  }

  const result = await query<{
    signal_type: string;
    count: string;
    avg_confidence: string;
  }>(
    `SELECT signal_type,
            COUNT(*) as count,
            AVG(confidence) as avg_confidence
     FROM conversation_signals
     WHERE ${conditions.join(' AND ')}
     GROUP BY signal_type
     ORDER BY count DESC`,
    params
  );

  return result.rows.map(row => ({
    signal_type: row.signal_type,
    count: parseInt(row.count, 10),
    avg_confidence: parseFloat(row.avg_confidence),
  }));
}
