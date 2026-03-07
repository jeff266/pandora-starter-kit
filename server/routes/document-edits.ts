import { Router } from 'express';
import { captureDocumentEdit } from '../documents/edit-capture.js';
import { getConversationState } from '../chat/conversation-state.js';
import { getOrCreateSessionContext } from '../agents/session-context.js';

const router = Router();

/**
 * Capture an edit for a document section.
 * POST /api/workspaces/:workspaceId/documents/:documentId/edit
 */
router.post('/:workspaceId/documents/:documentId/edit', async (req, res) => {
  const { workspaceId, documentId } = req.params;
  const { 
    threadId,
    sectionId, 
    rawText, 
    editedText, 
    systemPrompt,
    voiceProfileSnapshot,
    quarterPhaseAtTime,
    attainmentPctAtTime 
  } = req.body;

  if (!sectionId || !rawText || !editedText || !threadId) {
    return res.status(400).json({ error: 'Missing required fields: threadId, sectionId, rawText, editedText' });
  }

  try {
    const state = await getConversationState(workspaceId, 'command_center', threadId);
    if (!state) return res.status(404).json({ error: 'Session not found' });

    const sessionContext = await getOrCreateSessionContext(state.context, workspaceId);
    if (!sessionContext.accumulatedDocument) {
      return res.status(400).json({ error: 'No document in session' });
    }

    const templateType = sessionContext.accumulatedDocument.templateType;

    const edit = await captureDocumentEdit({
      workspaceId,
      documentId,
      templateType,
      sectionId,
      rawText,
      editedText,
      editedBy: req.user?.email || 'system',
      systemPrompt,
      voiceProfileSnapshot,
      quarterPhaseAtTime,
      attainmentPctAtTime
    });

    res.json(edit);
  } catch (err: any) {
    console.error('[Document Edits Route] Edit capture error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
