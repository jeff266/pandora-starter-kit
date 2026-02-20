import { Router } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { query } from '../db.js';
import { backfillStageHistory, getBackfillStats } from '../connectors/hubspot/stage-history-backfill.js';
import { getDealStageHistory } from '../analysis/stage-history-queries.js';
import { getConnectorCredentials } from '../lib/credential-store.js';

const router = Router();

async function validateWorkspace(workspaceId: string, res: any): Promise<boolean> {
  const result = await query<{ id: string }>('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Workspace not found' });
    return false;
  }
  return true;
}

router.post('/:workspaceId/connectors/hubspot/backfill-stage-history', requirePermission('connectors.trigger_sync'), async (req, res) => {
  try {
    const { workspaceId } = req.params;
    if (!(await validateWorkspace(workspaceId, res))) return;

    // Check if HubSpot connection exists and is active
    const connResult = await query<{ status: string }>(
      `SELECT status FROM connections WHERE workspace_id = $1 AND connector_name = 'hubspot' AND status IN ('connected', 'synced', 'healthy')`,
      [workspaceId]
    );

    if (connResult.rows.length === 0) {
      res.status(404).json({ error: 'No connected HubSpot integration found' });
      return;
    }

    // Get credentials from credential store
    const creds = await getConnectorCredentials(workspaceId, 'hubspot');
    if (!creds) {
      res.status(404).json({ error: 'HubSpot credentials not found' });
      return;
    }

    const accessToken = creds.accessToken || creds.access_token;
    if (!accessToken) {
      res.status(400).json({ error: 'HubSpot access token not found in credentials' });
      return;
    }

    backfillStageHistory(workspaceId, accessToken)
      .then((result) => {
        console.log(`[Stage History] Backfill complete for workspace ${workspaceId}:`, result);
      })
      .catch((err) => {
        console.error(`[Stage History] Backfill failed for workspace ${workspaceId}:`, err);
      });

    res.status(202).json({ message: 'Backfill started', workspace_id: workspaceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Stage History] Backfill start error:', message);
    res.status(500).json({ error: message });
  }
});

router.get('/:workspaceId/connectors/hubspot/backfill-stage-history/stats', requirePermission('data.deals_view'), async (req, res) => {
  try {
    const { workspaceId } = req.params;
    if (!(await validateWorkspace(workspaceId, res))) return;

    const stats = await getBackfillStats(workspaceId);
    res.json(stats);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Stage History] Get stats error:', message);
    res.status(500).json({ error: message });
  }
});

router.get('/:workspaceId/deals/:dealId/stage-history', requirePermission('data.deals_view'), async (req, res) => {
  try {
    const { workspaceId, dealId } = req.params;
    if (!(await validateWorkspace(workspaceId, res))) return;

    const history = await getDealStageHistory(workspaceId, dealId);
    res.json(history);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Stage History] Get deal stage history error:', message);
    res.status(500).json({ error: message });
  }
});

export default router;
