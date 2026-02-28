/**
 * Chat Session Service
 * Manages persistent conversation history for Ask Pandora
 */

import { query } from '../db.js';

export interface ChatSession {
  id: string;
  workspace_id: string;
  user_id: string;
  entity_type?: string | null;  // 'deal', 'account', etc.
  entity_id?: string | null;    // ID of the entity
  title: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  message_count: number;
}

export interface ChatSessionWithPreview {
  id: string;
  title: string;
  created_at: string;
  last_message_at: string;
  message_count: number;
  user_id: string;
  user_name?: string;  // For admin view
  user_email?: string; // For admin view
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  metadata?: Record<string, any>;
}

export interface ChatSessionWithMessages extends ChatSessionWithPreview {
  messages: ChatMessage[];
}

/**
 * Create a new chat session with auto-generated title
 */
export async function createChatSession(
  workspaceId: string,
  userId: string,
  firstMessage: string,
  options?: {
    entityType?: string;
    entityId?: string;
  }
): Promise<ChatSession> {
  // Generate title from first message (max 80 chars, truncate at word boundary)
  let title = firstMessage.trim().slice(0, 80);
  if (firstMessage.length > 80) {
    const lastSpace = title.lastIndexOf(' ');
    if (lastSpace > 40) {
      title = title.slice(0, lastSpace) + '...';
    } else {
      title += '...';
    }
  }

  const result = await query(
    `INSERT INTO chat_sessions (workspace_id, user_id, entity_type, entity_id, title, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     RETURNING *`,
    [workspaceId, userId, options?.entityType || null, options?.entityId || null, title]
  );

  return result.rows[0] as any;
}

/**
 * Append a message to a session and update session metadata
 */
export async function appendChatMessage(
  sessionId: string,
  workspaceId: string,
  userId: string,
  role: 'user' | 'assistant',
  content: string,
  metadata?: Record<string, any>
): Promise<void> {
  // Insert message
  await query(
    `INSERT INTO chat_session_messages (session_id, workspace_id, user_id, role, content, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [sessionId, workspaceId, userId, role, content, JSON.stringify(metadata || {})]
  );

  // Update session stats
  await query(
    `UPDATE chat_sessions
     SET last_message_at = NOW(),
         updated_at = NOW(),
         message_count = message_count + 1
     WHERE id = $1`,
    [sessionId]
  );
}

/**
 * Get user's role in a workspace
 */
async function getUserWorkspaceRole(
  workspaceId: string,
  userId: string
): Promise<string | null> {
  const result = await query(
    `SELECT wr.system_type
     FROM workspace_members wm
     JOIN workspace_roles wr ON wm.role_id = wr.id
     WHERE wm.workspace_id = $1 AND wm.user_id = $2 AND wm.status = 'active'
     LIMIT 1`,
    [workspaceId, userId]
  );

  return result.rows[0]?.system_type || null;
}

/**
 * Get sessions list with role-based visibility
 */
export async function getChatSessions(
  workspaceId: string,
  requestingUserId: string,
  requestingUserRole: string,
  options?: { limit?: number; offset?: number }
): Promise<ChatSessionWithPreview[]> {
  const limit = options?.limit || 20;
  const offset = options?.offset || 0;

  let sqlQuery: string;
  let params: any[];

  if (requestingUserRole === 'admin') {
    // Admins see all sessions in workspace
    sqlQuery = `
      SELECT
        cs.id,
        cs.title,
        cs.created_at,
        cs.last_message_at,
        cs.message_count,
        cs.user_id,
        u.name as user_name,
        u.email as user_email
      FROM chat_sessions cs
      JOIN users u ON cs.user_id = u.id
      WHERE cs.workspace_id = $1
      ORDER BY cs.last_message_at DESC NULLS LAST, cs.created_at DESC
      LIMIT $2 OFFSET $3
    `;
    params = [workspaceId, limit, offset];
  } else if (requestingUserRole === 'manager') {
    // Managers see own sessions + reports' sessions
    // For now, just own sessions (reporting lines to be implemented in Phase 2)
    sqlQuery = `
      SELECT
        cs.id,
        cs.title,
        cs.created_at,
        cs.last_message_at,
        cs.message_count,
        cs.user_id,
        u.name as user_name,
        u.email as user_email
      FROM chat_sessions cs
      JOIN users u ON cs.user_id = u.id
      WHERE cs.workspace_id = $1
        AND (cs.user_id = $2 OR cs.user_id IN (
          SELECT report_id FROM user_reporting_lines
          WHERE workspace_id = $1 AND manager_id = $2
        ))
      ORDER BY cs.last_message_at DESC NULLS LAST, cs.created_at DESC
      LIMIT $3 OFFSET $4
    `;
    params = [workspaceId, requestingUserId, limit, offset];
  } else {
    // Rep or other roles: only own sessions
    sqlQuery = `
      SELECT
        cs.id,
        cs.title,
        cs.created_at,
        cs.last_message_at,
        cs.message_count,
        cs.user_id
      FROM chat_sessions cs
      WHERE cs.workspace_id = $1 AND cs.user_id = $2
      ORDER BY cs.last_message_at DESC NULLS LAST, cs.created_at DESC
      LIMIT $3 OFFSET $4
    `;
    params = [workspaceId, requestingUserId, limit, offset];
  }

  const result = await query(sqlQuery, params);
  return result.rows as any;
}

/**
 * Get full session with messages
 * Returns null if session not found or user doesn't have access
 */
export async function getChatSessionWithMessages(
  sessionId: string,
  workspaceId: string,
  requestingUserId: string,
  requestingUserRole: string
): Promise<ChatSessionWithMessages | null> {
  // Check access based on role
  let hasAccess = false;

  if (requestingUserRole === 'admin') {
    // Admin can access any session in workspace
    const result = await query(
      'SELECT 1 FROM chat_sessions WHERE id = $1 AND workspace_id = $2',
      [sessionId, workspaceId]
    );
    hasAccess = result.rows.length > 0;
  } else if (requestingUserRole === 'manager') {
    // Manager can access own + reports' sessions
    const result = await query(
      `SELECT 1 FROM chat_sessions
       WHERE id = $1 AND workspace_id = $2
         AND (user_id = $3 OR user_id IN (
           SELECT report_id FROM user_reporting_lines
           WHERE workspace_id = $2 AND manager_id = $3
         ))`,
      [sessionId, workspaceId, requestingUserId]
    );
    hasAccess = result.rows.length > 0;
  } else {
    // Rep can only access own sessions
    const result = await query(
      'SELECT 1 FROM chat_sessions WHERE id = $1 AND workspace_id = $2 AND user_id = $3',
      [sessionId, workspaceId, requestingUserId]
    );
    hasAccess = result.rows.length > 0;
  }

  if (!hasAccess) {
    return null;
  }

  // Fetch session metadata
  const sessionResult = await query(
    `SELECT
       cs.id,
       cs.title,
       cs.created_at,
       cs.last_message_at,
       cs.message_count,
       cs.user_id,
       u.name as user_name,
       u.email as user_email
     FROM chat_sessions cs
     JOIN users u ON cs.user_id = u.id
     WHERE cs.id = $1`,
    [sessionId]
  );

  if (sessionResult.rows.length === 0) {
    return null;
  }

  // Fetch messages
  const messagesResult = await query(
    `SELECT id, role, content, created_at, metadata
     FROM chat_session_messages
     WHERE session_id = $1
     ORDER BY created_at ASC`,
    [sessionId]
  );

  return ({
    ...sessionResult.rows[0],
    messages: messagesResult.rows.map((row: any) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      created_at: row.created_at,
      metadata: row.metadata,
    })),
  }) as any;
}

/**
 * Delete a chat session (only owner or admin)
 */
export async function deleteChatSession(
  sessionId: string,
  workspaceId: string,
  requestingUserId: string,
  requestingUserRole: string
): Promise<boolean> {
  let canDelete = false;

  if (requestingUserRole === 'admin') {
    // Admin can delete any session in workspace
    const result = await query(
      'SELECT 1 FROM chat_sessions WHERE id = $1 AND workspace_id = $2',
      [sessionId, workspaceId]
    );
    canDelete = result.rows.length > 0;
  } else {
    // Non-admin can only delete own sessions
    const result = await query(
      'SELECT 1 FROM chat_sessions WHERE id = $1 AND workspace_id = $2 AND user_id = $3',
      [sessionId, workspaceId, requestingUserId]
    );
    canDelete = result.rows.length > 0;
  }

  if (!canDelete) {
    return false;
  }

  // Delete session (cascade will delete messages)
  await query('DELETE FROM chat_sessions WHERE id = $1', [sessionId]);
  return true;
}

/**
 * Get or create session helper
 */
export async function getOrCreateSession(
  workspaceId: string,
  userId: string,
  sessionId: string | null,
  firstMessage: string,
  options?: {
    entityType?: string;
    entityId?: string;
  }
): Promise<string> {
  if (sessionId) {
    // Verify session exists and belongs to user
    const result = await query(
      'SELECT id FROM chat_sessions WHERE id = $1 AND workspace_id = $2 AND user_id = $3',
      [sessionId, workspaceId, userId]
    );
    if (result.rows.length > 0) {
      return sessionId;
    }
  }

  // If entity-scoped, check for existing session for this entity
  if (options?.entityType && options?.entityId) {
    const result = await query(
      `SELECT id FROM chat_sessions
       WHERE workspace_id = $1 AND user_id = $2
         AND entity_type = $3 AND entity_id = $4
       ORDER BY last_message_at DESC NULLS LAST
       LIMIT 1`,
      [workspaceId, userId, options.entityType, options.entityId]
    );
    if (result.rows.length > 0) {
      return result.rows[0].id;
    }
  }

  // Create new session
  const session = await createChatSession(workspaceId, userId, firstMessage, options);
  return session.id;
}

/**
 * Get messages for an entity (e.g., all Q&A for a specific deal)
 */
export async function getEntityMessages(
  workspaceId: string,
  entityType: string,
  entityId: string,
  requestingUserId: string
): Promise<ChatMessage[]> {
  // Get the most recent session for this entity
  const sessionResult = await query(
    `SELECT id FROM chat_sessions
     WHERE workspace_id = $1 AND entity_type = $2 AND entity_id = $3
     ORDER BY last_message_at DESC NULLS LAST
     LIMIT 1`,
    [workspaceId, entityType, entityId]
  );

  if (sessionResult.rows.length === 0) {
    return [];
  }

  const sessionId = sessionResult.rows[0].id;

  // Fetch messages
  const messagesResult = await query(
    `SELECT id, role, content, created_at, metadata
     FROM chat_session_messages
     WHERE session_id = $1
     ORDER BY created_at ASC`,
    [sessionId]
  );

  return messagesResult.rows.map((row: any) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    created_at: row.created_at,
    metadata: row.metadata,
  }));
}
