/**
 * Quota Management API Routes
 *
 * Handles Excel/CSV upload, preview, confirmation, and CRUD operations for quotas.
 */

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db.js';
import {
  parseQuotaFile,
  classifyColumns,
  buildPreview,
  applyQuotas,
  type QuotaUploadPreview,
} from '../quotas/upload-parser.js';
import { requireWorkspaceAccess } from '../middleware/auth.js';
import {
  fetchHubSpotGoals,
  getPendingGoalsPreview,
  clearPendingGoalsPreview,
  type ResolvedQuota,
} from '../connectors/hubspot/goals-sync.js';

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
        id: string;
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
          rq.id,
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

router.post(
  '/workspaces/:workspaceId/quotas/sync-hubspot',
  async (req: Request<WorkspaceParams>, res: Response) => {
    try {
      const { workspaceId } = req.params;

      const connCheck = await query(
        `SELECT id FROM connections WHERE workspace_id = $1 AND connector_name = 'hubspot' AND status = 'healthy'`,
        [workspaceId]
      );

      if (connCheck.rows.length === 0) {
        res.status(400).json({ error: 'no_hubspot_connection' });
        return;
      }

      const result = await fetchHubSpotGoals(workspaceId);

      if (result.warnings.includes('missing_scope')) {
        res.status(403).json({
          error: 'missing_scope',
          message: 'HubSpot connection needs re-authorization to access Goals',
        });
        return;
      }

      const teamTotal = result.goals.reduce((sum, g) => sum + g.quota_amount, 0);
      const uniqueReps = new Set(result.goals.map(g => g.rep_email));
      const uniquePeriods = [...new Set(result.goals.map(g => g.period_label))];

      res.json({
        source: 'hubspot_goals',
        goals: result.goals,
        warnings: result.warnings,
        rawGoalCount: result.raw_count,
        filteredCount: result.goals.length,
        teamTotal,
        repCount: uniqueReps.size,
        periods: uniquePeriods,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Quotas] Sync HubSpot error:', message);
      res.status(500).json({ error: message });
    }
  }
);

router.post(
  '/workspaces/:workspaceId/quotas/sync-hubspot/confirm',
  async (req: Request<WorkspaceParams>, res: Response) => {
    try {
      const { workspaceId } = req.params;
      const { goals } = req.body as { goals: ResolvedQuota[] };

      if (!goals || !Array.isArray(goals) || goals.length === 0) {
        res.status(400).json({ error: 'No goals provided' });
        return;
      }

      const batchId = uuidv4();
      let inserted = 0;
      let updated = 0;
      let skipped = 0;

      for (const goal of goals) {
        const existingPeriod = await query<{ id: string }>(
          `SELECT id FROM quota_periods
           WHERE workspace_id = $1 AND start_date = $2 AND end_date = $3 AND period_type = $4
           LIMIT 1`,
          [workspaceId, goal.period_start, goal.period_end, goal.period_type]
        );

        let periodId: string;

        if (existingPeriod.rows.length > 0) {
          periodId = existingPeriod.rows[0].id;
        } else {
          const newPeriod = await query<{ id: string }>(
            `INSERT INTO quota_periods (workspace_id, name, period_type, start_date, end_date, team_quota)
             VALUES ($1, $2, $3, $4, $5, 0)
             RETURNING id`,
            [workspaceId, goal.period_label, goal.period_type, goal.period_start, goal.period_end]
          );
          periodId = newPeriod.rows[0].id;
        }

        try {
          const result = await query(
            `INSERT INTO rep_quotas (period_id, rep_name, rep_email, quota_amount, source, upload_batch_id)
             VALUES ($1, $2, $3, $4, 'hubspot_goals', $5)
             ON CONFLICT (period_id, rep_email) WHERE rep_email IS NOT NULL
             DO UPDATE SET
               quota_amount = EXCLUDED.quota_amount,
               rep_name = EXCLUDED.rep_name,
               upload_batch_id = EXCLUDED.upload_batch_id,
               updated_at = NOW()
             WHERE rep_quotas.source = 'hubspot_goals'
             RETURNING (xmax = 0) AS inserted`,
            [periodId, goal.rep_name, goal.rep_email, goal.quota_amount, batchId]
          );

          if (result.rows.length === 0) {
            skipped++;
          } else if (result.rows[0].inserted) {
            inserted++;
          } else {
            updated++;
          }
        } catch (error) {
          console.error(`[Quotas] Failed to upsert HubSpot goal for ${goal.rep_name}:`, error);
          skipped++;
        }
      }

      res.json({ inserted, updated, skipped, batchId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Quotas] Confirm HubSpot sync error:', message);
      res.status(500).json({ error: message });
    }
  }
);

router.delete(
  '/workspaces/:workspaceId/quotas/:quotaId',
  async (req: Request<QuotaIdParams>, res: Response) => {
    try {
      const { workspaceId, quotaId } = req.params;

      const checkResult = await query(
        `SELECT rq.id FROM rep_quotas rq
         JOIN quota_periods qp ON qp.id = rq.period_id
         WHERE rq.id = $1 AND qp.workspace_id = $2`,
        [quotaId, workspaceId]
      );

      if (checkResult.rows.length === 0) {
        res.status(404).json({ error: 'Quota not found' });
        return;
      }

      await query(`DELETE FROM rep_quotas WHERE id = $1`, [quotaId]);

      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Quotas] Delete quota error:', message);
      res.status(500).json({ error: message });
    }
  }
);

router.get(
  '/workspaces/:workspaceId/quotas/reps',
  async (req: Request<WorkspaceParams>, res: Response) => {
    try {
      const { workspaceId } = req.params;
      // Pull distinct reps from existing quotas (best name+email source)
      // supplemented by deal owners that have no quota record yet
      const result = await query<{ rep_name: string; rep_email: string | null }>(
        `SELECT rep_name, rep_email
         FROM rep_quotas
         WHERE period_id IN (SELECT id FROM quota_periods WHERE workspace_id = $1)
           AND rep_name IS NOT NULL
         GROUP BY rep_name, rep_email
         UNION
         SELECT DISTINCT owner as rep_name, NULL as rep_email
         FROM deals
         WHERE workspace_id = $1 AND owner IS NOT NULL
           AND owner NOT IN (
             SELECT rep_name FROM rep_quotas
             WHERE period_id IN (SELECT id FROM quota_periods WHERE workspace_id = $1)
               AND rep_name IS NOT NULL
           )
         ORDER BY rep_name`,
        [workspaceId]
      );
      res.json({ reps: result.rows });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  }
);

router.get(
  '/workspaces/:workspaceId/quotas/periods',
  async (req: Request<WorkspaceParams>, res: Response) => {
    try {
      const { workspaceId } = req.params;

      const result = await query<{
        id: string;
        name: string;
        period_type: string;
        start_date: string;
        end_date: string;
        team_quota: number;
      }>(
        `SELECT id, name, period_type, start_date, end_date, team_quota
         FROM quota_periods
         WHERE workspace_id = $1
         ORDER BY start_date DESC`,
        [workspaceId]
      );

      res.json({ periods: result.rows });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Quotas] Get periods error:', message);
      res.status(500).json({ error: message });
    }
  }
);

router.post(
  '/workspaces/:workspaceId/quotas/add',
  async (req: Request<WorkspaceParams>, res: Response) => {
    try {
      const { workspaceId } = req.params;
      const { rep_name, rep_email, quota_amount, period_start, period_end, period_type, period_label } = req.body;

      if (!rep_name || !quota_amount || !period_start || !period_end || !period_type) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
      }

      const existingPeriod = await query<{ id: string }>(
        `SELECT id FROM quota_periods
         WHERE workspace_id = $1 AND start_date = $2 AND end_date = $3 AND period_type = $4
         LIMIT 1`,
        [workspaceId, period_start, period_end, period_type]
      );

      let periodId: string;

      if (existingPeriod.rows.length > 0) {
        periodId = existingPeriod.rows[0].id;
      } else {
        const newPeriod = await query<{ id: string }>(
          `INSERT INTO quota_periods (workspace_id, name, period_type, start_date, end_date, team_quota)
           VALUES ($1, $2, $3, $4, $5, 0)
           RETURNING id`,
          [workspaceId, period_label || `${period_type} period`, period_type, period_start, period_end]
        );
        periodId = newPeriod.rows[0].id;
      }

      const result = await query<{ id: string }>(
        `INSERT INTO rep_quotas (period_id, rep_name, rep_email, quota_amount, source)
         VALUES ($1, $2, $3, $4, 'manual')
         RETURNING id`,
        [periodId, rep_name, rep_email || null, quota_amount]
      );

      res.json({ success: true, quotaId: result.rows[0].id });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Quotas] Add quota error:', message);
      res.status(500).json({ error: message });
    }
  }
);

router.get(
  '/workspaces/:workspaceId/quotas/pending-goals',
  async (req: Request<WorkspaceParams>, res: Response) => {
    try {
      const { workspaceId } = req.params;
      const preview = await getPendingGoalsPreview(workspaceId);

      res.json({
        pending: preview !== null,
        preview,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Quotas] Get pending goals error:', message);
      res.status(500).json({ error: message });
    }
  }
);

router.post(
  '/workspaces/:workspaceId/quotas/dismiss-pending-goals',
  async (req: Request<WorkspaceParams>, res: Response) => {
    try {
      const { workspaceId } = req.params;
      await clearPendingGoalsPreview(workspaceId);
      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Quotas] Dismiss pending goals error:', message);
      res.status(500).json({ error: message });
    }
  }
);

export default router;
