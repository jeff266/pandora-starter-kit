/**
 * Tool Call Logger
 *
 * Fire-and-forget logging for every tool invocation (ask_pandora, skill_run, playground).
 * All inserts are non-blocking — failures are silently swallowed.
 */

import { query } from '../db.js';

export interface ToolCallLogEntry {
  workspace_id?: string;
  tool_name: string;
  called_by: 'skill_run' | 'ask_pandora' | 'playground';
  skill_id?: string;
  duration_ms: number;
  result_row_count?: number;
  result_empty: boolean;
  error?: string;
}

/**
 * Fire-and-forget: insert a tool_call_logs row. Never throws.
 */
export function logToolCall(entry: ToolCallLogEntry): void {
  query(
    `INSERT INTO tool_call_logs
       (workspace_id, tool_name, called_by, skill_id, duration_ms, result_row_count, result_empty, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.workspace_id ?? null,
      entry.tool_name,
      entry.called_by,
      entry.skill_id ?? null,
      entry.duration_ms,
      entry.result_row_count ?? null,
      entry.result_empty,
      entry.error ?? null,
    ]
  ).catch(() => {}); // intentionally swallow — logging must never break callers
}

// ─── Helper: extract a normalised row count from a tool result ────────────────

export function extractResultRowCount(result: any): number | null {
  if (result == null) return null;
  // Prefer explicit total_count fields (query_deals, query_accounts, etc.)
  if (typeof result.total_count === 'number') return result.total_count;
  // Array results
  if (Array.isArray(result.deals)) return result.deals.length;
  if (Array.isArray(result.accounts)) return result.accounts.length;
  if (Array.isArray(result.contacts)) return result.contacts.length;
  if (Array.isArray(result.conversations)) return result.conversations.length;
  if (Array.isArray(result.events)) return result.events.length;
  if (Array.isArray(result.reps)) return result.reps.length;
  if (Array.isArray(result)) return result.length;
  // Compute results with a value
  if (typeof result.value === 'number') return 1;
  return null;
}

// ─── Stats query ─────────────────────────────────────────────────────────────

export interface ToolCallStat {
  tool_name: string;
  call_count: number;
  avg_duration_ms: number;
  empty_rate_pct: number;
  error_rate_pct: number;
  last_called_at: string | null;
}

export async function getToolCallStats(
  workspaceId: string,
  calledBy?: string,
  days: number = 7
): Promise<ToolCallStat[]> {
  const conditions = [
    'workspace_id = $1',
    `called_at >= NOW() - ($2 * INTERVAL '1 day')`,
  ];
  const values: any[] = [workspaceId, days];

  if (calledBy) {
    values.push(calledBy);
    conditions.push(`called_by = $${values.length}`);
  }

  const result = await query<any>(
    `SELECT
       tool_name,
       COUNT(*)::int                                                          AS call_count,
       ROUND(AVG(duration_ms))::int                                           AS avg_duration_ms,
       ROUND(100.0 * COUNT(*) FILTER (WHERE result_empty = true)  / COUNT(*))::int AS empty_rate_pct,
       ROUND(100.0 * COUNT(*) FILTER (WHERE error IS NOT NULL)     / COUNT(*))::int AS error_rate_pct,
       MAX(called_at)::text                                                   AS last_called_at
     FROM tool_call_logs
     WHERE ${conditions.join(' AND ')}
     GROUP BY tool_name
     ORDER BY call_count DESC`,
    values
  );

  return result.rows;
}
