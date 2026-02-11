import { Router } from 'express';
import { query } from '../db.js';
import { syncSalesforce } from '../connectors/salesforce/sync.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('SalesforceSync');

router.post('/:workspaceId/connectors/salesforce/sync', async (req, res) => {
  const { workspaceId } = req.params;

  const result = await query(
    `SELECT credentials FROM connector_configs
     WHERE workspace_id = $1 AND source = 'salesforce' AND status IN ('connected', 'healthy', 'synced')`,
    [workspaceId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'No active Salesforce connection found' });
  }

  const credentials = result.rows[0].credentials;

  credentials.clientId = process.env.SALESFORCE_CLIENT_ID;
  credentials.clientSecret = process.env.SALESFORCE_CLIENT_SECRET;

  try {
    const syncResult = await syncSalesforce(workspaceId, credentials);

    await query(
      `UPDATE connector_configs SET status = 'synced', last_synced_at = NOW() WHERE workspace_id = $1 AND source = 'salesforce'`,
      [workspaceId]
    );

    res.json(syncResult);
  } catch (error) {
    logger.error('Sync failed', { error });

    await query(
      `UPDATE connector_configs SET status = 'error' WHERE workspace_id = $1 AND source = 'salesforce'`,
      [workspaceId]
    );

    res.status(500).json({ error: 'Sync failed', message: (error as Error).message });
  }
});

export default router;
