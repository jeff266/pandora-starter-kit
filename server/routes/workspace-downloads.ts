/**
 * Workspace Downloads API
 *
 * Endpoints for managing persistent downloadable files from agent runs and deliverables.
 */

import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { query } from '../db.js';

const router = Router({ mergeParams: true });

/**
 * GET /api/workspaces/:workspaceId/downloads
 * List all workspace downloads
 */
router.get('/', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await query(
      `SELECT id, agent_run_id, deliverable_id, filename, format,
              file_size_bytes, created_by, is_public, created_at,
              expires_at, downloaded_count, last_downloaded_at
       FROM workspace_downloads
       WHERE workspace_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [workspaceId, limit, offset]
    );

    const countResult = await query(
      'SELECT COUNT(*) FROM workspace_downloads WHERE workspace_id = $1',
      [workspaceId]
    );

    res.json({
      downloads: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        limit,
        offset,
      },
    });
  } catch (err) {
    console.error('[workspace-downloads] Error listing downloads:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to list downloads' });
  }
});

/**
 * GET /api/workspaces/:workspaceId/downloads/:downloadId
 * Get download metadata
 */
router.get('/:downloadId', async (req, res) => {
  try {
    const { workspaceId, downloadId } = req.params;

    const result = await query(
      `SELECT id, agent_run_id, deliverable_id, filename, format,
              file_path, file_size_bytes, created_by, is_public,
              created_at, expires_at, downloaded_count, last_downloaded_at
       FROM workspace_downloads
       WHERE id = $1 AND workspace_id = $2`,
      [downloadId, workspaceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Download not found' });
    }

    const download = result.rows[0];

    // Check if expired
    if (download.expires_at && new Date(download.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Download has expired' });
    }

    res.json({ download });
  } catch (err) {
    console.error('[workspace-downloads] Error fetching download:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to fetch download' });
  }
});

/**
 * GET /api/workspaces/:workspaceId/downloads/:downloadId/file
 * Stream the actual file
 */
router.get('/:downloadId/file', async (req, res) => {
  try {
    const { workspaceId, downloadId } = req.params;

    const result = await query(
      `SELECT id, filename, format, file_path, expires_at
       FROM workspace_downloads
       WHERE id = $1 AND workspace_id = $2`,
      [downloadId, workspaceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Download not found' });
    }

    const download = result.rows[0];

    // Check if expired
    if (download.expires_at && new Date(download.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Download has expired' });
    }

    // Build absolute file path
    const filePath = path.join(
      process.cwd(),
      'workspace_storage',
      download.file_path
    );

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (err) {
      console.error('[workspace-downloads] File not found:', filePath);
      return res.status(404).json({ error: 'File not found on disk' });
    }

    // Increment download count
    await query(
      `UPDATE workspace_downloads
       SET downloaded_count = downloaded_count + 1,
           last_downloaded_at = NOW()
       WHERE id = $1`,
      [downloadId]
    );

    // Determine MIME type
    const mimeTypes: Record<string, string> = {
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pdf: 'application/pdf',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      html: 'text/html',
      json: 'application/json',
    };

    const mimeType = mimeTypes[download.format] || 'application/octet-stream';

    // Set headers and stream file
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${download.filename}"`);

    const fileBuffer = await fs.readFile(filePath);
    res.send(fileBuffer);
  } catch (err) {
    console.error('[workspace-downloads] Error streaming file:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to stream file' });
  }
});

/**
 * DELETE /api/workspaces/:workspaceId/downloads/:downloadId
 * Delete a download (file + database record)
 */
router.delete('/:downloadId', async (req, res) => {
  try {
    const { workspaceId, downloadId } = req.params;

    const result = await query(
      'SELECT file_path FROM workspace_downloads WHERE id = $1 AND workspace_id = $2',
      [downloadId, workspaceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Download not found' });
    }

    const filePath = path.join(
      process.cwd(),
      'workspace_storage',
      result.rows[0].file_path
    );

    // Delete file from disk (ignore errors if already deleted)
    try {
      await fs.unlink(filePath);
    } catch (err) {
      console.warn('[workspace-downloads] File already deleted:', filePath);
    }

    // Delete database record
    await query(
      'DELETE FROM workspace_downloads WHERE id = $1 AND workspace_id = $2',
      [downloadId, workspaceId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('[workspace-downloads] Error deleting download:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to delete download' });
  }
});

/**
 * DELETE /api/workspaces/:workspaceId/downloads
 * Cleanup expired downloads for workspace
 */
router.delete('/', async (req, res) => {
  try {
    const { workspaceId } = req.params;

    // Find expired downloads
    const result = await query(
      `SELECT id, file_path
       FROM workspace_downloads
       WHERE workspace_id = $1
         AND expires_at IS NOT NULL
         AND expires_at < NOW()`,
      [workspaceId]
    );

    let deletedCount = 0;

    for (const row of result.rows) {
      const filePath = path.join(
        process.cwd(),
        'workspace_storage',
        row.file_path
      );

      // Delete file
      try {
        await fs.unlink(filePath);
      } catch (err) {
        console.warn('[workspace-downloads] File already deleted:', filePath);
      }

      // Delete database record
      await query(
        'DELETE FROM workspace_downloads WHERE id = $1',
        [row.id]
      );

      deletedCount++;
    }

    console.log(`[workspace-downloads] Cleaned up ${deletedCount} expired downloads for workspace ${workspaceId}`);

    res.json({ deleted_count: deletedCount });
  } catch (err) {
    console.error('[workspace-downloads] Error cleaning up downloads:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to cleanup downloads' });
  }
});

export default router;
