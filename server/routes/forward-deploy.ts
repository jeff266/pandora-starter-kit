/**
 * Forward Deploy Admin Routes — Phase 8
 *
 * Admin-only endpoints for seeding workspaces with metrics and calibration checklist.
 */

import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../middleware/permissions.js';
import {
  seedWorkspaceForForwardDeploy,
  seedAllExistingWorkspaces,
} from '../lib/forward-deploy-seeder.js';

const router = Router();

/**
 * POST /api/admin/forward-deploy/seed/:workspaceId
 *
 * Seeds a single workspace with metrics and calibration checklist.
 * Pre-populates from existing workspace_config.
 * Idempotent - safe to run multiple times.
 */
router.post(
  '/forward-deploy/seed/:workspaceId',
  requirePermission('config.view'),
  async (req: Request, res: Response) => {
    const workspaceId = req.params.workspaceId as string;

    try {
      console.log(`[ForwardDeploy] Seeding workspace ${workspaceId}`);
      const result = await seedWorkspaceForForwardDeploy(workspaceId);

      res.json({
        success: true,
        ...result,
      });
    } catch (err: any) {
      console.error('[ForwardDeploy] Seed failed:', err?.message);
      res.status(500).json({
        success: false,
        error: 'Seed failed',
        message: err?.message,
      });
    }
  }
);

/**
 * POST /api/admin/forward-deploy/seed-all
 *
 * Seeds all existing workspaces with metrics and calibration checklist.
 * Pre-populates from existing workspace_config.
 * Returns summary of all workspaces seeded.
 */
router.post(
  '/forward-deploy/seed-all',
  requirePermission('config.view'),
  async (req: Request, res: Response) => {
    try {
      console.log(`[ForwardDeploy] Seeding all workspaces`);
      const results = await seedAllExistingWorkspaces();

      res.json({
        success: true,
        workspaces_processed: results.length,
        results,
      });
    } catch (err: any) {
      console.error('[ForwardDeploy] Bulk seed failed:', err?.message);
      res.status(500).json({
        success: false,
        error: 'Bulk seed failed',
        message: err?.message,
      });
    }
  }
);

export default router;
