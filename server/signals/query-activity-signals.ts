/**
 * Query Activity Signals
 *
 * Provides structured query interface for activity_signals table.
 * Used by Ask Pandora tool: query_activity_signals
 */

import { query } from '../db.js';
import type { SignalType } from './extract-activity-signals.js';

export interface ActivitySignal {
  id: string;
  workspace_id: string;
  activity_id: string;
  signal_type: SignalType;
  signal_value: string | null;
  framework_field: string | null;
  source_quote: string | null;
  speaker_type: string | null;
  speaker_confidence: number | null;
  verbatim: boolean;
  confidence: number;
  extraction_method: string;
  model_version: string | null;
  deal_id: string | null;
  account_id: string | null;
  extracted_at: string;
  created_at: string;
  // Joined activity data
  activity_type?: string;
  activity_subject?: string;
  activity_timestamp?: string;
  deal_name?: string;
  account_name?: string;
}

export interface ActivitySignalQueryFilters {
  signal_type?: SignalType;
  signal_value?: string;  // Partial match (ILIKE)
  framework_field?: string;  // e.g., 'metrics', 'economic_buyer', 'timeline'
  speaker_type?: 'prospect' | 'rep' | 'unknown';
  deal_id?: string;
  account_id?: string;
  from_date?: string;  // ISO date
  to_date?: string;    // ISO date
  min_confidence?: number;
  verbatim_only?: boolean;  // Only verbatim quotes
  limit?: number;
  offset?: number;
}

export interface ActivitySignalQueryResult {
  signals: ActivitySignal[];
  total: number;
  limit: number;
  offset: number;
}

export async function queryActivitySignals(
  workspaceId: string,
  filters: ActivitySignalQueryFilters
): Promise<ActivitySignalQueryResult> {
  const { where, params, idx } = buildWhereClause(workspaceId, filters);

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  // Count query
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM activity_signals asig
     WHERE ${where}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Data query with joins
  const dataParams = [...params, limit, offset];
  const dataResult = await query<ActivitySignal>(
    `SELECT asig.*,
            a.activity_type,
            a.subject as activity_subject,
            a.timestamp as activity_timestamp,
            d.name as deal_name,
            ac.name as account_name
     FROM activity_signals asig
     LEFT JOIN activities a ON a.id = asig.activity_id
     LEFT JOIN deals d ON d.id = asig.deal_id
     LEFT JOIN accounts ac ON ac.id = asig.account_id
     WHERE ${where}
     ORDER BY asig.extracted_at DESC
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

function buildWhereClause(workspaceId: string, filters: ActivitySignalQueryFilters) {
  const conditions: string[] = ['asig.workspace_id = $1'];
  const params: unknown[] = [workspaceId];
  let idx = 2;

  if (filters.signal_type !== undefined) {
    conditions.push(`asig.signal_type = $${idx}`);
    params.push(filters.signal_type);
    idx++;
  }

  if (filters.signal_value !== undefined) {
    conditions.push(`asig.signal_value ILIKE $${idx}`);
    params.push(`%${filters.signal_value}%`);
    idx++;
  }

  if (filters.framework_field !== undefined) {
    conditions.push(`asig.framework_field = $${idx}`);
    params.push(filters.framework_field);
    idx++;
  }

  if (filters.speaker_type !== undefined) {
    conditions.push(`asig.speaker_type = $${idx}`);
    params.push(filters.speaker_type);
    idx++;
  }

  if (filters.deal_id !== undefined) {
    conditions.push(`asig.deal_id = $${idx}`);
    params.push(filters.deal_id);
    idx++;
  }

  if (filters.account_id !== undefined) {
    conditions.push(`asig.account_id = $${idx}`);
    params.push(filters.account_id);
    idx++;
  }

  if (filters.from_date !== undefined) {
    conditions.push(`asig.extracted_at >= $${idx}`);
    params.push(filters.from_date);
    idx++;
  }

  if (filters.to_date !== undefined) {
    conditions.push(`asig.extracted_at <= $${idx}`);
    params.push(filters.to_date);
    idx++;
  }

  if (filters.min_confidence !== undefined) {
    conditions.push(`asig.confidence >= $${idx}`);
    params.push(filters.min_confidence);
    idx++;
  } else {
    // Default to 0.7 minimum confidence
    conditions.push(`asig.confidence >= $${idx}`);
    params.push(0.7);
    idx++;
  }

  if (filters.verbatim_only) {
    conditions.push('asig.verbatim = true');
  }

  return { where: conditions.join(' AND '), params, idx };
}

/**
 * Get signals for a specific deal
 */
export async function getActivitySignalsForDeal(
  workspaceId: string,
  dealId: string
): Promise<ActivitySignal[]> {
  const result = await queryActivitySignals(workspaceId, {
    deal_id: dealId,
    limit: 100,
  });
  return result.signals;
}

/**
 * Get signals for a specific account
 */
export async function getActivitySignalsForAccount(
  workspaceId: string,
  accountId: string
): Promise<ActivitySignal[]> {
  const result = await queryActivitySignals(workspaceId, {
    account_id: accountId,
    limit: 200,
  });
  return result.signals;
}

/**
 * Get framework-specific signals for a deal
 */
export async function getFrameworkSignalsForDeal(
  workspaceId: string,
  dealId: string,
  frameworkField?: string
): Promise<ActivitySignal[]> {
  const result = await queryActivitySignals(workspaceId, {
    deal_id: dealId,
    signal_type: 'framework_signal',
    framework_field: frameworkField,
    limit: 100,
  });
  return result.signals;
}

/**
 * Get untracked participants for a deal
 */
export async function getUntrackedParticipantsForDeal(
  workspaceId: string,
  dealId: string
): Promise<ActivitySignal[]> {
  const result = await queryActivitySignals(workspaceId, {
    deal_id: dealId,
    signal_type: 'untracked_participant',
    limit: 50,
  });
  return result.signals;
}

/**
 * Get signal type breakdown for a workspace
 */
export async function getActivitySignalTypeBreakdown(
  workspaceId: string,
  fromDate?: string,
  toDate?: string
): Promise<{
  signal_type: string;
  count: number;
  avg_confidence: number;
  framework_breakdown?: { field: string; count: number }[];
}[]> {
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
     FROM activity_signals
     WHERE ${conditions.join(' AND ')}
     GROUP BY signal_type
     ORDER BY count DESC`,
    params
  );

  const breakdown = result.rows.map(row => ({
    signal_type: row.signal_type,
    count: parseInt(row.count, 10),
    avg_confidence: parseFloat(row.avg_confidence),
  }));

  // For framework_signal types, add breakdown by framework_field
  for (const item of breakdown) {
    if (item.signal_type === 'framework_signal') {
      const frameworkResult = await query<{ framework_field: string; count: string }>(
        `SELECT framework_field, COUNT(*) as count
         FROM activity_signals
         WHERE ${conditions.join(' AND ')}
           AND signal_type = 'framework_signal'
           AND framework_field IS NOT NULL
         GROUP BY framework_field
         ORDER BY count DESC`,
        params
      );

      item.framework_breakdown = frameworkResult.rows.map(row => ({
        field: row.framework_field,
        count: parseInt(row.count, 10),
      }));
    }
  }

  return breakdown;
}
