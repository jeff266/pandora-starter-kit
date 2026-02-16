import { query } from '../db.js';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ConversationContext {
  entities_discussed: string[];
  skills_referenced: string[];
  filters_active: Record<string, any> | null;
  last_scope?: {
    type: string;
    entity_id?: string;
    rep_email?: string;
  };
}

export interface ConversationState {
  id: string;
  workspace_id: string;
  thread_ts: string;
  channel_id: string;
  source: 'slack' | 'web';
  messages: ConversationMessage[];
  context: ConversationContext;
  skill_run_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

const TTL_HOURS = 24;
const MAX_MESSAGES_PER_THREAD = 20;
const MAX_FOLLOW_UPS = 10;

export async function getConversationState(
  workspaceId: string,
  channelId: string,
  threadTs: string
): Promise<ConversationState | null> {
  const result = await query<any>(
    `SELECT * FROM conversation_state
     WHERE workspace_id = $1 AND channel_id = $2 AND thread_ts = $3
     AND expires_at > now()`,
    [workspaceId, channelId, threadTs]
  );
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    thread_ts: row.thread_ts,
    channel_id: row.channel_id,
    source: row.source,
    messages: row.messages || [],
    context: row.context || { entities_discussed: [], skills_referenced: [], filters_active: null },
    skill_run_id: row.skill_run_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
  };
}

export async function createConversationState(
  workspaceId: string,
  channelId: string,
  threadTs: string,
  source: 'slack' | 'web' = 'slack',
  skillRunId?: string
): Promise<ConversationState> {
  const expiresAt = new Date(Date.now() + TTL_HOURS * 60 * 60 * 1000).toISOString();
  const context: ConversationContext = {
    entities_discussed: [],
    skills_referenced: [],
    filters_active: null,
  };

  const result = await query<any>(
    `INSERT INTO conversation_state (workspace_id, channel_id, thread_ts, source, messages, context, skill_run_id, expires_at)
     VALUES ($1, $2, $3, $4, '[]'::jsonb, $5::jsonb, $6, $7)
     ON CONFLICT (workspace_id, channel_id, thread_ts)
     DO UPDATE SET updated_at = now(), expires_at = $7
     RETURNING *`,
    [workspaceId, channelId, threadTs, source, JSON.stringify(context), skillRunId || null, expiresAt]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    thread_ts: row.thread_ts,
    channel_id: row.channel_id,
    source: row.source,
    messages: row.messages || [],
    context: row.context || context,
    skill_run_id: row.skill_run_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
  };
}

export async function appendMessage(
  workspaceId: string,
  channelId: string,
  threadTs: string,
  message: ConversationMessage
): Promise<void> {
  await query(
    `UPDATE conversation_state
     SET messages = (
       CASE
         WHEN jsonb_array_length(messages) >= $5
         THEN messages - 0 || $4::jsonb
         ELSE messages || $4::jsonb
       END
     ),
     updated_at = now()
     WHERE workspace_id = $1 AND channel_id = $2 AND thread_ts = $3`,
    [workspaceId, channelId, threadTs, JSON.stringify(message), MAX_MESSAGES_PER_THREAD]
  );
}

export async function updateContext(
  workspaceId: string,
  channelId: string,
  threadTs: string,
  updates: Partial<ConversationContext>
): Promise<void> {
  const result = await query<any>(
    `SELECT context FROM conversation_state
     WHERE workspace_id = $1 AND channel_id = $2 AND thread_ts = $3`,
    [workspaceId, channelId, threadTs]
  );
  if (result.rows.length === 0) return;

  const current = result.rows[0].context || {};
  const merged: ConversationContext = {
    entities_discussed: [
      ...new Set([...(current.entities_discussed || []), ...(updates.entities_discussed || [])])
    ],
    skills_referenced: [
      ...new Set([...(current.skills_referenced || []), ...(updates.skills_referenced || [])])
    ],
    filters_active: updates.filters_active ?? current.filters_active ?? null,
    last_scope: updates.last_scope ?? current.last_scope,
  };

  await query(
    `UPDATE conversation_state
     SET context = $4::jsonb, updated_at = now()
     WHERE workspace_id = $1 AND channel_id = $2 AND thread_ts = $3`,
    [workspaceId, channelId, threadTs, JSON.stringify(merged)]
  );
}

export async function getMessageCount(
  workspaceId: string,
  channelId: string,
  threadTs: string
): Promise<number> {
  const result = await query<any>(
    `SELECT jsonb_array_length(messages) AS count FROM conversation_state
     WHERE workspace_id = $1 AND channel_id = $2 AND thread_ts = $3`,
    [workspaceId, channelId, threadTs]
  );
  return result.rows.length > 0 ? (result.rows[0].count || 0) : 0;
}

export function isFollowUpLimitReached(messageCount: number): boolean {
  return messageCount >= MAX_FOLLOW_UPS * 2;
}

export async function cleanupExpiredConversations(): Promise<number> {
  const result = await query(
    `DELETE FROM conversation_state WHERE expires_at < now()`
  );
  return result.rowCount || 0;
}

export async function checkRateLimit(workspaceId: string, maxPerHour: number = 20): Promise<boolean> {
  const windowStart = new Date();
  windowStart.setMinutes(0, 0, 0);

  const result = await query<any>(
    `INSERT INTO conversation_rate_limits (workspace_id, window_start, request_count)
     VALUES ($1, $2, 1)
     ON CONFLICT (workspace_id, window_start)
     DO UPDATE SET request_count = conversation_rate_limits.request_count + 1
     RETURNING request_count`,
    [workspaceId, windowStart.toISOString()]
  );

  return (result.rows[0]?.request_count || 0) <= maxPerHour;
}

export async function cleanupRateLimits(): Promise<void> {
  await query(
    `DELETE FROM conversation_rate_limits WHERE window_start < now() - interval '2 hours'`
  );
}
