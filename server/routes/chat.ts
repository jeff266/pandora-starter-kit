import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { handleConversationTurn } from '../chat/orchestrator.js';
import { getConversationState } from '../chat/conversation-state.js';
import {
  createChatSession,
  appendChatMessage,
  getChatSessions,
  getChatSessionWithMessages,
  deleteChatSession,
  getOrCreateSession,
} from '../chat/session-service.js';
import { query } from '../db.js';
import { processFeedback, type AgentFeedback } from '../agents/feedback-processor.js';

const router = Router();

/**
 * Helper to get user's workspace role
 */
async function getUserRole(workspaceId: string, userId: string): Promise<string> {
  const result = await query(
    `SELECT wr.system_type
     FROM workspace_members wm
     JOIN workspace_roles wr ON wm.role_id = wr.id
     WHERE wm.workspace_id = $1 AND wm.user_id = $2 AND wm.status = 'active'
     LIMIT 1`,
    [workspaceId, userId]
  );
  return result.rows[0]?.system_type || 'rep';
}

router.post('/:workspaceId/chat', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const { message, thread_id, scope, session_id } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const userId = req.user?.user_id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const threadTs = thread_id || `web_${randomUUID()}`;

    const result = await handleConversationTurn({
      surface: 'in_app',
      workspaceId,
      threadId: threadTs,
      channelId: 'web',
      message: message.trim(),
      scope: scope || undefined,
    });

    if (result.rate_limited) {
      res.status(429).json({ error: result.answer });
      return;
    }

    if (result.turn_limit_reached) {
      res.status(429).json({ error: result.answer, thread_id: threadTs });
      return;
    }

    // Persist to session (fire-and-forget to not slow response)
    let finalSessionId = session_id;
    if (!finalSessionId) {
      // Auto-create session from first message
      getOrCreateSession(workspaceId, userId, null, message.trim())
        .then((newSessionId) => {
          finalSessionId = newSessionId;
          // Save user message
          return appendChatMessage(
            finalSessionId,
            workspaceId,
            userId,
            'user',
            message.trim()
          );
        })
        .then(() => {
          // Save assistant response
          return appendChatMessage(
            finalSessionId!,
            workspaceId,
            userId,
            'assistant',
            result.answer,
            {
              router_decision: result.router_decision,
              data_strategy: result.data_strategy,
              tokens_used: result.tokens_used,
              tool_call_count: result.tool_call_count,
              latency_ms: result.latency_ms,
            }
          );
        })
        .catch((err) => {
          console.error('[chat] Failed to persist session:', err);
        });
    } else {
      // Append to existing session
      Promise.resolve()
        .then(() => appendChatMessage(finalSessionId!, workspaceId, userId, 'user', message.trim()))
        .then(() =>
          appendChatMessage(finalSessionId!, workspaceId, userId, 'assistant', result.answer, {
            router_decision: result.router_decision,
            data_strategy: result.data_strategy,
            tokens_used: result.tokens_used,
            tool_call_count: result.tool_call_count,
            latency_ms: result.latency_ms,
          })
        )
        .catch((err) => {
          console.error('[chat] Failed to append to session:', err);
        });
    }

    res.json({
      answer: result.answer,
      thread_id: result.thread_id,
      session_id: finalSessionId,
      scope: result.scope,
      router_decision: result.router_decision,
      data_strategy: result.data_strategy,
      tokens_used: result.tokens_used,
      response_id: result.response_id,
      feedback_enabled: result.feedback_enabled ?? false,
      entities_mentioned: result.entities_mentioned ?? { deals: [], accounts: [], reps: [] },
      ...(result.evidence ? { evidence: result.evidence } : {}),
      ...(result.tool_call_count != null ? { tool_call_count: result.tool_call_count } : {}),
      ...(result.latency_ms != null ? { latency_ms: result.latency_ms } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[chat] Error:', msg);
    res.status(500).json({ error: 'Failed to process your question. Please try again.' });
  }
});

router.get('/:workspaceId/chat/:threadId/history', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const threadId = req.params.threadId as string;

    const state = await getConversationState(workspaceId, 'web', threadId);
    if (!state) {
      res.json({ messages: [], thread_id: threadId });
      return;
    }

    res.json({
      messages: state.messages || [],
      thread_id: threadId,
      context: state.context,
      expires_at: state.expires_at,
    });
  } catch (err) {
    console.error('[chat] History error:', err);
    res.status(500).json({ error: 'Failed to load conversation history' });
  }
});

// ─── Session Management Endpoints ─────────────────────────────────────────────

/**
 * GET /api/workspaces/:workspaceId/chat/sessions
 * List chat sessions with role-based visibility
 */
router.get('/:workspaceId/chat/sessions', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const userId = req.user?.user_id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    const userRole = await getUserRole(workspaceId, userId);
    const sessions = await getChatSessions(workspaceId, userId, userRole, { limit, offset });

    // Get total count for pagination
    let countQuery: string;
    let countParams: any[];

    if (userRole === 'admin') {
      countQuery = 'SELECT COUNT(*) FROM chat_sessions WHERE workspace_id = $1';
      countParams = [workspaceId];
    } else if (userRole === 'manager') {
      countQuery = `
        SELECT COUNT(*) FROM chat_sessions
        WHERE workspace_id = $1
          AND (user_id = $2 OR user_id IN (
            SELECT report_id FROM user_reporting_lines
            WHERE workspace_id = $1 AND manager_id = $2
          ))
      `;
      countParams = [workspaceId, userId];
    } else {
      countQuery = 'SELECT COUNT(*) FROM chat_sessions WHERE workspace_id = $1 AND user_id = $2';
      countParams = [workspaceId, userId];
    }

    const countResult = await query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    res.json({ sessions, total });
  } catch (err) {
    console.error('[chat] List sessions error:', err);
    res.status(500).json({ error: 'Failed to load chat sessions' });
  }
});

/**
 * GET /api/workspaces/:workspaceId/chat/sessions/:sessionId
 * Get full session with messages
 */
router.get('/:workspaceId/chat/sessions/:sessionId', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const sessionId = req.params.sessionId as string;
    const userId = req.user?.user_id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const userRole = await getUserRole(workspaceId, userId);
    const session = await getChatSessionWithMessages(sessionId, workspaceId, userId, userRole);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json(session);
  } catch (err) {
    console.error('[chat] Get session error:', err);
    res.status(500).json({ error: 'Failed to load session' });
  }
});

/**
 * POST /api/workspaces/:workspaceId/chat/sessions
 * Create a new chat session
 */
router.post('/:workspaceId/chat/sessions', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const { first_message } = req.body;
    const userId = req.user?.user_id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!first_message || typeof first_message !== 'string') {
      res.status(400).json({ error: 'first_message is required' });
      return;
    }

    const session = await createChatSession(workspaceId, userId, first_message);

    res.json({
      session_id: session.id,
      title: session.title,
    });
  } catch (err) {
    console.error('[chat] Create session error:', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

/**
 * DELETE /api/workspaces/:workspaceId/chat/sessions/:sessionId
 * Delete a chat session (owner or admin only)
 */
router.delete('/:workspaceId/chat/sessions/:sessionId', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const sessionId = req.params.sessionId as string;
    const userId = req.user?.user_id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const userRole = await getUserRole(workspaceId, userId);
    const deleted = await deleteChatSession(sessionId, workspaceId, userId, userRole);

    if (!deleted) {
      res.status(404).json({ error: 'Session not found or insufficient permissions' });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[chat] Delete session error:', err);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

/**
 * POST /api/workspaces/:workspaceId/chat/feedback
 * Submit thumbs up/down on a chat response
 */
async function getChatAgentId(workspaceId: string): Promise<string> {
  const existing = await query(
    `SELECT id FROM agents WHERE workspace_id = $1 AND template_id = 'pandora_chat' LIMIT 1`,
    [workspaceId]
  );
  if (existing.rows.length > 0) return existing.rows[0].id;
  const created = await query(
    `INSERT INTO agents (workspace_id, name, template_id, icon, skill_ids)
     VALUES ($1, 'Pandora Chat', 'pandora_chat', '✦', '{}')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [workspaceId]
  );
  if (created.rows.length > 0) return created.rows[0].id;
  const refetch = await query(`SELECT id FROM agents WHERE workspace_id = $1 AND template_id = 'pandora_chat' LIMIT 1`, [workspaceId]);
  return refetch.rows[0].id;
}

router.post('/:workspaceId/chat/feedback', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const userId = req.user?.user_id;
    const { response_id, signal, comment } = req.body as { response_id: string; signal: 'thumbs_up' | 'thumbs_down'; comment?: string };

    if (!response_id || !signal || !['thumbs_up', 'thumbs_down'].includes(signal)) {
      res.status(400).json({ error: 'response_id and signal (thumbs_up|thumbs_down) required' });
      return;
    }

    const agentId = await getChatAgentId(workspaceId);
    const rating = signal === 'thumbs_up' ? 5 : 1;

    const result = await query(
      `INSERT INTO agent_feedback
        (workspace_id, agent_id, generation_id, user_id, feedback_type, signal, rating, comment)
       VALUES ($1, $2, $3, $4, 'overall', $5, $6, $7)
       RETURNING *`,
      [workspaceId, agentId, response_id, userId ?? null, signal, rating, comment ?? null]
    );

    const feedback = result.rows[0] as AgentFeedback;
    await processFeedback(feedback).catch(() => null);

    res.json({ ok: true, feedback_id: feedback.id });
  } catch (err) {
    console.error('[chat] feedback error:', err);
    res.status(500).json({ error: 'Failed to record feedback' });
  }
});

/**
 * POST /api/workspaces/:workspaceId/chat/repeated-question
 * Internal: record implicit negative signal when a question is repeated
 */
router.post('/:workspaceId/chat/repeated-question', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const { message } = req.body as { message: string };

    if (!message) {
      res.status(400).json({ error: 'message required' });
      return;
    }

    const prevResult = await query(
      `SELECT cm.content, cm.metadata
       FROM chat_messages cm
       WHERE cm.workspace_id = $1 AND cm.role = 'user'
       AND cm.created_at > NOW() - INTERVAL '7 days'
       AND LOWER(cm.content) = LOWER($2)
       ORDER BY cm.created_at DESC
       LIMIT 1`,
      [workspaceId, message]
    );

    if (prevResult.rows.length === 0) {
      res.json({ ok: true, found: false });
      return;
    }

    const agentId = await getChatAgentId(workspaceId);
    await query(
      `INSERT INTO agent_feedback
        (workspace_id, agent_id, generation_id, feedback_type, signal, rating, comment)
       VALUES ($1, $2, $3, 'overall', 'repeated_question', 1, $4)`,
      [workspaceId, agentId, randomUUID(), `User repeated this question — previous answer was likely unsatisfactory: "${message.substring(0, 200)}"`]
    );

    res.json({ ok: true, found: true });
  } catch (err) {
    console.error('[chat] repeated-question error:', err);
    res.status(500).json({ error: 'Failed to record signal' });
  }
});

export default router;
