/**
 * Deal Stage History API Routes
 *
 * Endpoints for backfilling and querying stage history data.
 */

import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';
import { backfillStageHistory, getBackfillStats } from '../connectors/hubspot/stage-history-backfill.js';

const router = Router();

interface WorkspaceParams {
  workspaceId: string;
}

/**
 * POST /api/workspaces/:workspaceId/connectors/hubspot/backfill-stage-history
 * Trigger stage history backfill for a workspace
 */
router.post(
  '/workspaces/:workspaceId/connectors/hubspot/backfill-stage-history',
  async (req: Request<WorkspaceParams>, res: Response) => {
    try {
      const { workspaceId } = req.params;

      // Get HubSpot access token
      const credResult = await query<{ credentials: any }>(
        `SELECT credentials FROM connections
         WHERE workspace_id = $1 AND source = 'hubspot' AND status = 'connected'
         LIMIT 1`,
        [workspaceId]
      );

      if (credResult.rows.length === 0) {
        res.status(404).json({ error: 'HubSpot not connected for this workspace' });
        return;
      }

      const accessToken = credResult.rows[0].credentials?.access_token;
      if (!accessToken) {
        res.status(400).json({ error: 'No HubSpot access token found' });
        return;
      }

      // Count deals to process
      const countResult = await query(
        `SELECT COUNT(*) as count
         FROM deals d
         WHERE d.workspace_id = $1
           AND d.source = 'hubspot'
           AND NOT EXISTS (
             SELECT 1 FROM deal_stage_history dsh
             WHERE dsh.deal_id = d.id AND dsh.source = 'hubspot_history'
           )`,
        [workspaceId]
      );

      const dealsToProcess = Number(countResult.rows[0]?.count || 0);

      // Return immediately with 202 Accepted
      res.status(202).json({
        status: 'started',
        dealsToProcess,
        message: 'Backfill started in background',
      });

      // Run backfill in background (non-blocking)
      backfillStageHistory(workspaceId, accessToken)
        .then(result => {
          console.log(`[Stage History] Backfill complete for workspace ${workspaceId}:`, result);
        })
        .catch(err => {
          console.error(`[Stage History] Backfill error for workspace ${workspaceId}:`, err);
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Stage History] Backfill trigger error:', message);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /api/workspaces/:workspaceId/stage-history/stats
 * Get stage history statistics for a workspace
 */
router.get(
  '/workspaces/:workspaceId/stage-history/stats',
  async (req: Request<WorkspaceParams>, res: Response) => {
    try {
      const { workspaceId } = req.params;

      const stats = await getBackfillStats(workspaceId);

      res.json(stats);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Stage History] Stats error:', message);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /api/workspaces/:workspaceId/deals/:dealId/stage-history
 * Get stage history for a specific deal
 */
router.get(
  '/workspaces/:workspaceId/deals/:dealId/stage-history',
  async (req: Request<WorkspaceParams & { dealId: string }>, res: Response) => {
    try {
      const { workspaceId, dealId } = req.params;

      // Verify deal belongs to workspace
      const dealCheck = await query(
        `SELECT id, name FROM deals WHERE id = $1 AND workspace_id = $2`,
        [dealId, workspaceId]
      );

      if (dealCheck.rows.length === 0) {
        res.status(404).json({ error: 'Deal not found' });
        return;
      }

      const history = await query(
        `SELECT
          dsh.*,
          EXTRACT(EPOCH FROM dsh.duration_in_previous_stage_ms / 1000)::INTEGER as duration_seconds,
          ROUND(dsh.duration_in_previous_stage_ms / 86400000.0, 1) as duration_days
         FROM deal_stage_history dsh
         WHERE dsh.deal_id = $1
         ORDER BY dsh.changed_at ASC`,
        [dealId]
      );

      res.json({
        deal: dealCheck.rows[0],
        history: history.rows,
        totalTransitions: history.rows.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Stage History] Get history error:', message);
      res.status(500).json({ error: message });
    }
  }
);

export default router;
