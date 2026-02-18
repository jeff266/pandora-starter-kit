/**
 * Centralized chat message logger.
 * Fire-and-forget — never throws, never blocks the calling request.
 */

import { query } from '../db.js';

export type ChatSurface =
  | 'ask_pandora'
  | 'mc_query'
  | 'slack'
  | 'deal_dossier'
  | 'account_dossier';

export interface LogMessageParams {
  workspaceId: string;
  sessionId: string;
  surface: ChatSurface;
  role: 'user' | 'assistant';
  content: string;
  intentType?: string | null;
  scope?: Record<string, unknown> | null;
  tokenCost?: number | null;
}

export async function logChatMessage(params: LogMessageParams): Promise<void> {
  try {
    await query(
      `INSERT INTO chat_messages
         (workspace_id, session_id, surface, role, content, intent_type, scope, token_cost)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        params.workspaceId,
        params.sessionId,
        params.surface,
        params.role,
        params.content,
        params.intentType ?? null,
        params.scope ? JSON.stringify(params.scope) : null,
        params.tokenCost ?? null,
      ]
    );
  } catch (err) {
    console.error('[chat-logger] Failed to log message:', err instanceof Error ? err.message : err);
  }
}

export async function getChatHistory(
  workspaceId: string,
  sessionId: string,
  limit = 20
): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const rows = await query<{ role: string; content: string }>(
    `SELECT role, content
     FROM chat_messages
     WHERE workspace_id = $1 AND session_id = $2
     ORDER BY created_at ASC
     LIMIT $3`,
    [workspaceId, sessionId, limit]
  );
  return rows.rows as { role: 'user' | 'assistant'; content: string }[];
}
