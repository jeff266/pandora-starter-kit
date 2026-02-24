/**
 * Document Download Routes
 * Serve generated documents (docx/xlsx) with security checks
 */

import { Router, type Request, type Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { testDocumentGeneration, formatDocumentResponse } from '../chat/document-synthesizer.js';
import pool from '../db.js';

const router = Router();

/**
 * GET /:workspaceId/generated-docs/:filename
 * Download generated documents with workspace security check
 */
router.get('/:workspaceId/generated-docs/:filename', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId, filename } = req.params;

    const safeName = path.basename(filename);
    if (!safeName.startsWith(workspaceId)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const ext = path.extname(safeName).toLowerCase();
    if (!['.docx', '.xlsx'].includes(ext)) {
      res.status(400).json({ error: 'Invalid file type' });
      return;
    }

    const filePath = path.join('/tmp/pandora-docs', safeName);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Document not found or expired' });
      return;
    }

    const contentType = ext === '.docx'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);

    stream.on('error', (err) => {
      console.error('[documents] Stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to download document' });
      }
    });

  } catch (err) {
    console.error('[documents] Download error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to download document' });
    }
  }
});

/**
 * POST /:workspaceId/generated-docs/test-generate
 * Generate DOCX/XLSX from an existing chat message (no Claude call)
 */
router.post('/:workspaceId/generated-docs/test-generate', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const { messageId } = req.body;

    let chatContent: string;

    if (messageId) {
      const result = await pool.query(
        'SELECT content FROM chat_messages WHERE id = $1 AND workspace_id = $2',
        [messageId, workspaceId]
      );
      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Chat message not found' });
        return;
      }
      chatContent = result.rows[0].content;
    } else {
      const result = await pool.query(
        `SELECT content FROM chat_messages
         WHERE workspace_id = $1 AND role = 'assistant'
         AND (content ILIKE '%framework%' OR content ILIKE '%document%' OR content ILIKE '%analysis%')
         AND LENGTH(content) > 2000
         ORDER BY created_at DESC LIMIT 1`,
        [workspaceId]
      );
      if (result.rows.length === 0) {
        res.status(404).json({ error: 'No suitable chat messages found for document generation' });
        return;
      }
      chatContent = result.rows[0].content;
    }

    console.log(`[documents] Test generate: using ${chatContent.length} chars of chat content`);

    const synthOutput = await testDocumentGeneration(workspaceId, chatContent);

    const downloadLinks = {
      docx: `/api/workspaces/${workspaceId}/generated-docs/${synthOutput.docxFilename}`,
      xlsx: `/api/workspaces/${workspaceId}/generated-docs/${synthOutput.xlsxFilename}`,
      docxFilename: synthOutput.docxFilename,
      xlsxFilename: synthOutput.xlsxFilename,
      message: 'Documents generated successfully from existing chat content (no Claude credits used)',
    };

    res.json(downloadLinks);
  } catch (err) {
    console.error('[documents] Test generate error:', err);
    res.status(500).json({ error: 'Failed to generate test documents', details: (err as Error).message });
  }
});

export default router;
