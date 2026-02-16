import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';
import { runScopedAnalysis } from '../analysis/scoped-analysis.js';
import {
  getConversationState,
  createConversationState,
  appendMessage,
  updateContext,
  checkRateLimit,
  getMessageCount,
  isFollowUpLimitReached,
} from '../chat/conversation-state.js';
import { classifyDirectQuestion } from '../chat/intent-classifier.js';

const router = Router();

router.post('/:workspaceId/chat', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const { message, thread_id, scope } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const allowed = await checkRateLimit(workspaceId, 30);
    if (!allowed) {
      res.status(429).json({ error: 'Rate limit exceeded. Please try again in a few minutes.' });
      return;
    }

    const channelId = 'web';
    const threadTs = thread_id || `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    let state = await getConversationState(workspaceId, channelId, threadTs);
    const isFollowUp = !!state && (state.messages || []).length > 0;

    if (!state) {
      state = await createConversationState(workspaceId, channelId, threadTs, 'web');
    }

    const msgCount = await getMessageCount(workspaceId, channelId, threadTs);
    if (isFollowUpLimitReached(msgCount)) {
      res.status(429).json({
        error: 'This conversation has reached its limit. Please start a new conversation.',
        thread_id: threadTs,
      });
      return;
    }

    await appendMessage(workspaceId, channelId, threadTs, {
      role: 'user',
      content: message.trim(),
      timestamp: new Date().toISOString(),
    });

    let answer: string;
    let scopeType: any = scope?.type || state.context.last_scope?.type || 'workspace';
    let entityId = scope?.entity_id || state.context.last_scope?.entity_id;
    let repEmail = scope?.rep_email || state.context.last_scope?.rep_email;

    if (isFollowUp) {
      const recentMessages = (state.messages || []).slice(-6);
      const history = recentMessages.map(m =>
        `${m.role === 'user' ? 'User' : 'Pandora'}: ${m.content}`
      ).join('\n\n');

      const analysis = await runScopedAnalysis({
        workspace_id: workspaceId,
        question: message.trim(),
        scope: {
          type: scopeType,
          entity_id: entityId,
          rep_email: repEmail,
          skill_run_context: `Previous conversation:\n${history}`,
        },
        format: 'text',
        max_tokens: 2000,
      });
      answer = analysis.answer;
    } else {
      if (!scope) {
        const repResult = await query<any>(
          `SELECT DISTINCT owner_email FROM deals
           WHERE workspace_id = $1 AND status = 'open' AND owner_email IS NOT NULL
           LIMIT 20`,
          [workspaceId]
        );
        const repNames = repResult.rows.map((r: any) => r.owner_email);

        const skillIds = [
          'pipeline-hygiene', 'deal-risk-review', 'pipeline-coverage',
          'weekly-recap', 'single-thread-alert', 'data-quality-audit',
          'forecast-rollup', 'rep-scorecard',
        ];

        const route = await classifyDirectQuestion(workspaceId, message.trim(), skillIds, repNames);

        if (route.type === 'data_query' && route.filters?.rep) {
          const repMatch = await query<any>(
            `SELECT DISTINCT owner_email FROM deals
             WHERE workspace_id = $1 AND LOWER(owner_email) LIKE $2 LIMIT 1`,
            [workspaceId, `%${route.filters.rep.toLowerCase()}%`]
          );
          if (repMatch.rows.length > 0) {
            scopeType = 'rep';
            repEmail = repMatch.rows[0].owner_email;
          }
        } else if (route.type === 'skill_trigger' && route.skill_id) {
          const lastRun = await query<any>(
            `SELECT result FROM skill_runs
             WHERE workspace_id = $1 AND skill_id = $2 AND status = 'completed'
             ORDER BY completed_at DESC LIMIT 1`,
            [workspaceId, route.skill_id]
          );
          if (lastRun.rows.length > 0) {
            const summary = lastRun.rows[0].result?.narrative || lastRun.rows[0].result?.summary;
            if (summary) {
              answer = typeof summary === 'string' ? summary.slice(0, 2000) : JSON.stringify(summary).slice(0, 2000);
              await appendMessage(workspaceId, channelId, threadTs, {
                role: 'assistant',
                content: answer,
                timestamp: new Date().toISOString(),
              });
              res.json({ answer, thread_id: threadTs, scope: { type: scopeType } });
              return;
            }
          }
        }
      }

      const analysis = await runScopedAnalysis({
        workspace_id: workspaceId,
        question: message.trim(),
        scope: {
          type: scopeType,
          entity_id: entityId,
          rep_email: repEmail,
        },
        format: 'text',
        max_tokens: 2000,
      });
      answer = analysis.answer;
    }

    await appendMessage(workspaceId, channelId, threadTs, {
      role: 'assistant',
      content: answer,
      timestamp: new Date().toISOString(),
    });

    await updateContext(workspaceId, channelId, threadTs, {
      last_scope: { type: scopeType, entity_id: entityId, rep_email: repEmail },
    });

    res.json({
      answer,
      thread_id: threadTs,
      scope: { type: scopeType, entity_id: entityId, rep_email: repEmail },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[chat] Error:', msg);
    res.status(500).json({ error: 'Failed to process your question. Please try again.' });
  }
});

router.get('/:workspaceId/chat/:threadId/history', async (req: Request, res: Response): Promise<void> => {
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
