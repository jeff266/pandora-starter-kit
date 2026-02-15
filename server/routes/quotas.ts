/**
 * Quota Management API Routes
 *
 * Handles Excel/CSV upload, preview, confirmation, and CRUD operations for quotas.
 */

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import { query } from '../db.js';
import {
  parseQuotaFile,
  classifyColumns,
  buildPreview,
  applyQuotas,
  type QuotaUploadPreview,
} from '../quotas/upload-parser.js';
import { requireWorkspaceAccess } from '../middleware/auth.js';

const router = Router();
router.use(requireWorkspaceAccess);

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.xlsx', '.xls', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only .xlsx, .xls, and .csv files are allowed.'));
    }
  },
});

interface WorkspaceParams {
  workspaceId: string;
}

interface QuotaIdParams extends WorkspaceParams {
  quotaId: string;
}

interface BatchIdParams extends WorkspaceParams {
  batchId: string;
}

/**
 * POST /api/workspaces/:workspaceId/quotas/upload
 * Upload Excel/CSV file, parse, and return preview (does not write to DB)
 */
router.post(
  '/workspaces/:workspaceId/quotas/upload',
  upload.single('file'),
  async (req: Request<WorkspaceParams>, res: Response) => {
    try {
      const { workspaceId } = req.params;

      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      // Step 1: Parse file
      const parsed = parseQuotaFile(req.file.buffer, req.file.originalname);

      // Step 2: Classify columns with AI
      const classification = await classifyColumns(
        parsed.headers,
        parsed.sampleRows,
        workspaceId
      );

      // Step 3: Build preview
      const preview = buildPreview(parsed, classification);

      res.json({
        success: true,
        ...preview,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[QuotaUpload] Upload error:', message);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * POST /api/workspaces/:workspaceId/quotas/confirm
 * Confirm and apply quotas to database
 */
router.post(
  '/workspaces/:workspaceId/quotas/confirm',
  async (req: Request<WorkspaceParams>, res: Response) => {
    try {
      const { workspaceId } = req.params;
      const { uploadId, preview, overrides } = req.body as {
        uploadId: string;
        preview: QuotaUploadPreview;
        overrides?: any;
      };

      if (!uploadId || !preview) {
        res.status(400).json({ error: 'Missing uploadId or preview' });
        return;
      }

      // Apply quotas to database
      const result = await applyQuotas(workspaceId, preview, { overrides });

      res.json({
        success: true,
        ...result,
        message: `Successfully ${result.inserted > 0 ? 'created' : 'updated'} ${result.inserted + result.updated} quotas`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[QuotaUpload] Confirm error:', message);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /api/workspaces/:workspaceId/quotas
 * Get quotas for a workspace (defaults to current quarter)
 */
router.get(
  '/workspaces/:workspaceId/quotas',
  async (req: Request<WorkspaceParams>, res: Response) => {
    try {
      const { workspaceId } = req.params;
      const { period_start, period_end } = req.query;

      let periodFilter = '';
      let params: any[] = [workspaceId];

      if (period_start && period_end) {
        periodFilter = `AND qp.start_date = $2 AND qp.end_date = $3`;
        params.push(period_start, period_end);
      } else {
        // Default to current quarter
        periodFilter = `AND qp.start_date <= CURRENT_DATE AND qp.end_date >= CURRENT_DATE`;
      }

      const result = await query<{
        quota_id: string;
        rep_name: string;
        rep_email: string | null;
        quota_amount: number;
        period_name: string;
        period_type: string;
        period_start: string;
        period_end: string;
        source: string;
        upload_batch_id: string | null;
        team_quota: number;
      }>(
        `SELECT
          rq.id as quota_id,
          rq.rep_name,
          rq.rep_email,
          rq.quota_amount,
          qp.name as period_name,
          qp.period_type,
          qp.start_date as period_start,
          qp.end_date as period_end,
          rq.source,
          rq.upload_batch_id,
          qp.team_quota
        FROM rep_quotas rq
        JOIN quota_periods qp ON qp.id = rq.period_id
        WHERE qp.workspace_id = $1 ${periodFilter}
        ORDER BY rq.quota_amount DESC`,
        params
      );

      if (result.rows.length === 0) {
        res.json({
          quotas: [],
          teamTotal: 0,
          period: null,
          repCount: 0,
        });
        return;
      }

      const quotas = result.rows;
      const teamTotal = quotas.reduce((sum, q) => sum + Number(q.quota_amount), 0);
      const period = {
        name: quotas[0].period_name,
        type: quotas[0].period_type,
        start: quotas[0].period_start,
        end: quotas[0].period_end,
        teamQuota: Number(quotas[0].team_quota),
      };

      res.json({
        quotas,
        teamTotal,
        period,
        repCount: quotas.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[QuotaUpload] Get quotas error:', message);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * PUT /api/workspaces/:workspaceId/quotas/:quotaId
 * Update a single quota
 */
router.put(
  '/workspaces/:workspaceId/quotas/:quotaId',
  async (req: Request<QuotaIdParams>, res: Response) => {
    try {
      const { workspaceId, quotaId } = req.params;
      const { rep_name, rep_email, quota_amount } = req.body;

      // Verify quota belongs to workspace
      const checkResult = await query(
        `SELECT 1 FROM rep_quotas rq
         JOIN quota_periods qp ON qp.id = rq.period_id
         WHERE rq.id = $1 AND qp.workspace_id = $2`,
        [quotaId, workspaceId]
      );

      if (checkResult.rows.length === 0) {
        res.status(404).json({ error: 'Quota not found' });
        return;
      }

      // Update quota
      await query(
        `UPDATE rep_quotas
         SET rep_name = COALESCE($1, rep_name),
             rep_email = COALESCE($2, rep_email),
             quota_amount = COALESCE($3, quota_amount),
             updated_at = NOW()
         WHERE id = $4`,
        [rep_name, rep_email, quota_amount, quotaId]
      );

      res.json({ success: true, message: 'Quota updated successfully' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[QuotaUpload] Update quota error:', message);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * DELETE /api/workspaces/:workspaceId/quotas/batch/:batchId
 * Delete all quotas from a specific upload batch
 */
router.delete(
  '/workspaces/:workspaceId/quotas/batch/:batchId',
  async (req: Request<BatchIdParams>, res: Response) => {
    try {
      const { workspaceId, batchId } = req.params;

      // Verify batch belongs to workspace
      const checkResult = await query(
        `SELECT COUNT(*) as count FROM rep_quotas rq
         JOIN quota_periods qp ON qp.id = rq.period_id
         WHERE rq.upload_batch_id = $1 AND qp.workspace_id = $2`,
        [batchId, workspaceId]
      );

      const count = Number(checkResult.rows[0]?.count || 0);

      if (count === 0) {
        res.status(404).json({ error: 'Batch not found or already deleted' });
        return;
      }

      // Delete quotas
      await query(
        `DELETE FROM rep_quotas
         WHERE upload_batch_id = $1
           AND period_id IN (
             SELECT id FROM quota_periods WHERE workspace_id = $2
           )`,
        [batchId, workspaceId]
      );

      res.json({
        success: true,
        deleted: count,
        message: `Deleted ${count} quotas from batch`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[QuotaUpload] Delete batch error:', message);
      res.status(500).json({ error: message });
    }
  }
);

export default router;
