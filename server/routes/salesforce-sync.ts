import { Router } from 'express';
import { query } from '../db.js';
import { syncSalesforce } from '../connectors/salesforce/sync.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('SalesforceSync');

router.post('/:workspaceId/connectors/salesforce/sync', async (req, res) => {
  const { workspaceId } = req.params;

  try {
    const result = await query(
      `SELECT credentials FROM connections
       WHERE workspace_id = $1 AND connector_name = 'salesforce' AND status IN ('connected', 'healthy', 'synced')`,
      [workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'No active Salesforce connection found' });
      return;
    }

    const credentials = result.rows[0].credentials;

    credentials.clientId = process.env.SALESFORCE_CLIENT_ID;
    credentials.clientSecret = process.env.SALESFORCE_CLIENT_SECRET;

    const syncResult = await syncSalesforce(workspaceId, credentials);

    await query(
      `UPDATE connections SET status = 'synced', last_sync_at = NOW() WHERE workspace_id = $1 AND connector_name = 'salesforce'`,
      [workspaceId]
    );

    res.json(syncResult);
  } catch (error) {
    logger.error('Sync failed', { error });

    await query(
      `UPDATE connections SET status = 'error' WHERE workspace_id = $1 AND connector_name = 'salesforce'`,
      [workspaceId]
    ).catch(() => {});

    res.status(500).json({ error: 'Sync failed', message: (error as Error).message });
  }
});

export default router;
