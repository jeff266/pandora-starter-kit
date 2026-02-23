/**
 * Document Download Routes
 * Serve generated documents (docx/xlsx) with security checks
 */

import { Router, type Request, type Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { requireWorkspaceAccess } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/workspaces/:workspaceId/documents/:filename
 * Download generated documents with workspace security check
 */
router.get('/:workspaceId/documents/:filename', requireWorkspaceAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId, filename } = req.params;

    // Security: validate filename format - must start with workspaceId
    const safeName = path.basename(filename); // Prevent path traversal
    if (!safeName.startsWith(workspaceId)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Security: only allow docx and xlsx extensions
    const ext = path.extname(safeName).toLowerCase();
    if (!['.docx', '.xlsx'].includes(ext)) {
      res.status(400).json({ error: 'Invalid file type' });
      return;
    }

    const filePath = path.join('/tmp/pandora-docs', safeName);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Document not found or expired' });
      return;
    }

    // Set content type based on extension
    const contentType = ext === '.docx'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);

    // Stream file to response
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

export default router;
