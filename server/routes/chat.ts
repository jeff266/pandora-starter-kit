import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { handleConversationTurn } from '../chat/orchestrator.js';
import { extractSuggestedActions } from '../chat/action-extractor.js';
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
import { extractAgentFromConversation, loadChatMessages } from '../chat/conversation-extractor.js';
import { callLLM } from '../utils/llm-router.js';
import { detectCrumbTrail, recordCrumbTrail } from '../concierge/crumb-trail-detector.js';

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
    const { message, thread_id, scope, session_id, conciergeContext } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const userId = req.user?.user_id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const userRole = await getUserRole(workspaceId, userId);

    const threadTs = thread_id || `web_${randomUUID()}`;

    const result = await handleConversationTurn({
      surface: 'in_app',
      workspaceId,
      threadId: threadTs,
      channelId: 'web',
      message: message.trim(),
      userId,
      userRole: userRole as any,
      scope: scope || undefined,
      conciergeContext: conciergeContext || undefined,
    });

    if (result.rate_limited) {
      res.status(429).json({ error: result.answer });
      return;
    }

    if (result.turn_limit_reached) {
      res.status(429).json({ error: result.answer, thread_id: threadTs });
      return;
    }

    // Crumb trail: detect affirmation in Ask Pandora web conversations (fire-and-forget)
    const _crumbDetection = detectCrumbTrail(message.trim());
    if (_crumbDetection.signal !== 'neutral') {
      recordCrumbTrail(
        {
          workspaceId,
          userId,
          userMessage: message.trim(),
          triggerType: 'ask_pandora',
          triggerMessageId: threadTs,
          recommendationText: result.answer.slice(0, 300),
        },
        _crumbDetection
      ).catch(() => {});
    }

    // Extract suggested actions first so they can be included in saved metadata
    let suggestedActions: any[] = [];
    try {
      suggestedActions = await extractSuggestedActions(result.answer, [], workspaceId);
      if (suggestedActions.length > 0) {
        console.log('[chat] extracted suggested_actions:', suggestedActions.length);
      }
    } catch (err) {
      console.error('[chat] extractSuggestedActions failed:', err);
    }

    const assistantMetadata: Record<string, any> = {
      router_decision: result.router_decision,
      data_strategy: result.data_strategy,
      tokens_used: result.tokens_used,
      tool_call_count: result.tool_call_count,
      latency_ms: result.latency_ms,
      ...(result.evidence ? { evidence: result.evidence } : {}),
      ...(result.chart_specs?.length ? { chart_specs: result.chart_specs } : {}),
      ...(result.chart ? { chart: result.chart } : {}),
      ...(suggestedActions.length > 0 ? { suggested_actions: suggestedActions } : {}),
      ...(result.deliberation ? { deliberation: result.deliberation } : {}),
      ...((result as any).pandora_response ? { pandora_response: (result as any).pandora_response } : {}),
    };

    // Persist to session (fire-and-forget to not slow response)
    let finalSessionId = session_id;
    if (!finalSessionId) {
      // Auto-create session from first message
      getOrCreateSession(workspaceId, userId, null, message.trim())
        .then((newSessionId) => {
          finalSessionId = newSessionId;
          return appendChatMessage(finalSessionId, workspaceId, userId, 'user', message.trim());
        })
        .then(() =>
          appendChatMessage(finalSessionId!, workspaceId, userId, 'assistant', result.answer, assistantMetadata)
        )
        .catch((err) => {
          console.error('[chat] Failed to persist session:', err);
        });
    } else {
      // Append to existing session
      Promise.resolve()
        .then(() => appendChatMessage(finalSessionId!, workspaceId, userId, 'user', message.trim()))
        .then(() =>
          appendChatMessage(finalSessionId!, workspaceId, userId, 'assistant', result.answer, assistantMetadata)
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
      ...(result.inline_actions ? { inline_actions: result.inline_actions } : {}),
      ...(result.chart_specs?.length ? { chart_specs: result.chart_specs } : {}),
      ...(result.chart ? { chart: result.chart } : {}),
      ...(suggestedActions.length > 0 ? { suggested_actions: suggestedActions } : {}),
      ...(result.deliberation ? { deliberation: result.deliberation } : {}),
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

/**
 * POST /api/workspaces/:workspaceId/chat/extract-agent
 *
 * Runs extraction on an existing chat session.
 * Returns pre-filled modal data. Does NOT create an Agent.
 *
 * Body: { conversation_id: string }
 */
router.post('/:workspaceId/chat/extract-agent', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const { conversation_id } = req.body;

    if (!conversation_id) {
      res.status(400).json({ error: 'conversation_id required' });
      return;
    }

    let messages;
    try {
      messages = await loadChatMessages(workspaceId, conversation_id);
    } catch (err: any) {
      if (err.code === 'NOT_FOUND' || err.code === 'FORBIDDEN') {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      throw err;
    }

    const userMessageCount = messages.filter(m => m.role === 'user').length;
    if (userMessageCount < 1) {
      res.status(400).json({
        error: 'Conversation too short to extract an Agent',
        confidence: 'low',
      });
      return;
    }

    const result = await extractAgentFromConversation({
      messages,
      workspace_id: workspaceId,
      conversation_id,
    });

    console.log('[extract-agent]', {
      workspace_id: workspaceId,
      conversation_id,
      confidence: result.confidence,
      skills: result.detected_skills,
      tokens: result._deepseek_tokens_used,
      reasoning: result._reasoning,
    });

    const { _reasoning, _user_message_count, _deepseek_tokens_used, ...publicResult } = result;
    res.json(publicResult);
  } catch (err) {
    console.error('[chat] extract-agent error:', err);
    res.status(500).json({ error: 'Failed to extract agent from conversation' });
  }
});

// ─── Guided Agent Creation Chat ───────────────────────────────────────────────

const GUIDED_AGENT_SYSTEM_PROMPT = `You are helping a RevOps professional create a recurring automated Agent in Pandora.

Your job is to understand what business outcome they want to track and propose a configuration. You have exactly 3 turns to gather what you need.

TURN 1 (first response):
Ask one focused question about the business outcome they want to stay on top of.
Keep it short — one sentence. Example:
"What business outcome do you want to stay on top of week over week?"

TURN 2 (after their first answer):
You now know their goal. Ask one focused follow-up about cadence or context.
This is the last question before you build. Example:
"Got it — [restate their goal in 5 words]. Any particular cadence or meeting this should prep you for?"

TURN 3 (after their second answer):
You have everything you need. Do NOT ask another question.
Respond with exactly:
"Perfect. Let me build your Agent configuration based on what you've told me."

RULES:
- Never ask more than one question per turn.
- Never ask about specific skills or technical configuration — that's Pandora's job.
- Never say "I'll need to" or "I'll try to" — be confident.
- If the user gives you everything in their first message (goal + cadence), skip turn 2 and go straight to turn 3.
- Keep every response under 40 words.`;

const CADENCE_SIGNALS = /\b(daily|weekly|monday|friday|monthly|every\s+\w+)\b/i;
const GOAL_SIGNALS = /\b(pipeline|forecast|rep|quota|coverage|review|report|brief)\b/i;

function shouldSkipToExtract(messages: Array<{ role: string; content: string }>): boolean {
  const userMessages = messages.filter(m => m.role === 'user');
  if (userMessages.length >= 3) return true;
  if (userMessages.length >= 2) return true;
  // Early exit: first message has both goal and cadence signals
  const firstUserMessage = userMessages[0]?.content ?? '';
  if (
    userMessages.length >= 1 &&
    GOAL_SIGNALS.test(firstUserMessage) &&
    CADENCE_SIGNALS.test(firstUserMessage)
  ) {
    return true;
  }
  return false;
}

/**
 * POST /api/workspaces/:workspaceId/chat/guided-agent
 *
 * Single turn in the guided Agent creation conversation.
 * Uses a focused system prompt with a hard exit after 2 user turns (or early
 * exit when first message contains both goal + cadence signals).
 *
 * Body: { messages: {role, content}[], conversation_id?: string }
 * Response: { message: string, shouldExtract: boolean, conversation_id: string }
 */
router.post('/:workspaceId/chat/guided-agent', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const userId = (req as any).user?.id ?? 'anonymous';
    const { messages = [], conversation_id: incomingConvId } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'messages array required' });
      return;
    }

    // Determine or create conversation session
    let conversationId: string = incomingConvId ?? '';
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    const firstUserMessage = messages.find(m => m.role === 'user');

    if (!conversationId) {
      const session = await createChatSession(
        workspaceId,
        userId,
        firstUserMessage?.content ?? 'Guided agent creation'
      );
      conversationId = session.id;
    }

    // Persist the latest user message
    if (lastUserMessage) {
      await appendChatMessage(conversationId, workspaceId, userId, 'user', lastUserMessage.content);
    }

    const extract = shouldSkipToExtract(messages);
    const assistantMessage = extract
      ? 'Perfect. Let me build your Agent configuration based on what you\'ve told me.'
      : await (async () => {
          const llmMessages = messages.map((m: any) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }));
          const result = await callLLM(workspaceId, 'generate', {
            messages: llmMessages,
            systemPrompt: GUIDED_AGENT_SYSTEM_PROMPT,
            max_tokens: 150,
            temperature: 0.7,
          });
          return typeof result === 'string' ? result : (result as any).content ?? 'Got it. Tell me more.';
        })();

    // Persist assistant response
    await appendChatMessage(conversationId, workspaceId, userId, 'assistant', assistantMessage);

    res.json({
      message: assistantMessage,
      shouldExtract: extract,
      conversation_id: conversationId,
    });
  } catch (err) {
    console.error('[chat] guided-agent error:', err);
    res.status(500).json({ error: 'Failed to process guided agent message' });
  }
});

export default router;
