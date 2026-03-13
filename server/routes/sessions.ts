import { Router } from 'express';
import { getConversationState, updateContext } from '../chat/conversation-state.js';
import { getOrCreateSessionContext } from '../agents/session-context.js';
import { createAccumulatedDocument, addContribution, overrideSection, removeContribution } from '../documents/accumulator.js';
import { synthesizeDocument } from '../documents/synthesizer.js';
import { distributeDocument } from '../documents/distributor.js';
import type { DocumentContribution } from '../documents/types.js';

const router = Router();

// GET current accumulator state
router.get('/:workspaceId/sessions/:threadId/document', async (req, res) => {
  const { workspaceId, threadId } = req.params;
  try {
    const state = await getConversationState(workspaceId, 'command_center', threadId);
    if (!state) return res.status(404).json({ error: 'Session not found' });

    const sessionContext = await getOrCreateSessionContext(state.context, workspaceId);
    res.json(sessionContext.accumulatedDocument || null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST move contribution
router.post('/:workspaceId/sessions/:threadId/document/contribution/:contributionId/move', async (req, res) => {
  const { workspaceId, threadId, contributionId } = req.params;
  const { targetSectionId } = req.body;

  try {
    const state = await getConversationState(workspaceId, 'command_center', threadId);
    if (!state) return res.status(404).json({ error: 'Session not found' });

    const sessionContext = await getOrCreateSessionContext(state.context, workspaceId);
    if (!sessionContext.accumulatedDocument) {
      return res.status(400).json({ error: 'No document in session' });
    }

    overrideSection(sessionContext.accumulatedDocument, contributionId, targetSectionId);

    // Save back to state.context
    // Note: getConversationState returns the state, but we need to update it.
    // In this codebase, updateContext is used.
    const { updateContext } = await import('../chat/conversation-state.js');
    await updateContext(workspaceId, 'command_center', threadId, { sessionContext });

    res.json(sessionContext.accumulatedDocument);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST synthesize document
router.post('/:workspaceId/sessions/:threadId/document/synthesize', async (req, res) => {
  const { workspaceId, threadId } = req.params;
  const { metrics } = req.body;

  try {
    const state = await getConversationState(workspaceId, 'command_center', threadId);
    if (!state) return res.status(404).json({ error: 'Session not found' });

    const sessionContext = await getOrCreateSessionContext(state.context, workspaceId);
    if (!sessionContext.accumulatedDocument) {
      return res.status(400).json({ error: 'No document in session' });
    }

    const synthesis = await synthesizeDocument({
      workspaceId,
      sessionId: threadId,
      document: sessionContext.accumulatedDocument,
      workspaceMetrics: metrics
    });

    res.json(synthesis);
  } catch (err: any) {
    console.error('[Sessions Route] Synthesis error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST remove contribution
router.post('/:workspaceId/sessions/:threadId/document/contribution/:contributionId/remove', async (req, res) => {
  const { workspaceId, threadId, contributionId } = req.params;

  try {
    const state = await getConversationState(workspaceId, 'command_center', threadId);
    if (!state) return res.status(404).json({ error: 'Session not found' });

    const sessionContext = await getOrCreateSessionContext(state.context, workspaceId);
    if (!sessionContext.accumulatedDocument) {
      return res.status(400).json({ error: 'No document in session' });
    }

    removeContribution(sessionContext.accumulatedDocument, contributionId);

    // Save back to state.context
    await updateContext(workspaceId, 'command_center', threadId, { sessionContext });

    res.json(sessionContext.accumulatedDocument);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST distribute document
router.post('/:workspaceId/sessions/:threadId/document/distribute', async (req: any, res) => {
  const { workspaceId, threadId } = req.params;
  const { channel, recipient, subject, body, filename, filepath } = req.body;

  try {
    const state = await getConversationState(workspaceId, 'command_center', threadId);
    if (!state) return res.status(404).json({ error: 'Session not found' });

    const sessionContext = await getOrCreateSessionContext(state.context, workspaceId);
    if (!sessionContext.accumulatedDocument) {
      return res.status(400).json({ error: 'No document in session' });
    }

    const result = await distributeDocument(
      workspaceId,
      sessionContext.accumulatedDocument,
      channel,
      { recipient, subject, body, filename, filepath }
    );

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:workspaceId/sessions/seed-wbr', async (req, res) => {
  const { workspaceId } = req.params;
  const { sessionId, contributions } = req.body as {
    sessionId: string;
    contributions: Array<{
      id: string;
      type: 'finding' | 'chart' | 'table' | 'recommendation';
      title: string;
      body?: string;
      severity?: 'critical' | 'warning' | 'info';
    }>;
  };

  if (!sessionId || !Array.isArray(contributions) || contributions.length === 0) {
    return res.status(400).json({ error: 'sessionId and contributions[] required' });
  }

  try {
    const doc = createAccumulatedDocument(sessionId, workspaceId, 'WBR');
    const now = new Date().toISOString();

    for (const c of contributions) {
      const contribution: DocumentContribution = {
        id: c.id,
        type: c.type,
        title: c.title,
        body: c.body,
        severity: c.severity,
        timestamp: now,
      };
      addContribution(doc, contribution);
    }

    res.json({ document: doc, contributionCount: contributions.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Sessions] WBR seed error:', message);
    res.status(500).json({ error: message });
  }
});

export default router;
