import { Router, type Request, type Response } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { handleConversationTurn } from '../chat/orchestrator.js';
import { getConversationState } from '../chat/conversation-state.js';

const router = Router();

router.post('/:workspaceId/chat', requirePermission('skills.view_results'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const { message, thread_id, scope } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const threadTs = thread_id || `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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

    res.json({
      answer: result.answer,
      thread_id: result.thread_id,
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

router.get('/:workspaceId/chat/:threadId/history', requirePermission('skills.view_results'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId, threadId } = req.params;

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

export default router;
