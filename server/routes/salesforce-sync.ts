import { Router } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { query } from '../db.js';
import { getJobQueue } from '../jobs/queue.js';
import { createLogger } from '../utils/logger.js';
import { salesforceAdapter } from '../connectors/salesforce/adapter.js';
import { getFreshCredentials } from '../utils/salesforce-token-refresh.js';


const router = Router();
const logger = createLogger('SalesforceSync');

router.post('/:workspaceId/connectors/salesforce/sync', async (req, res) => {
  const { workspaceId } = req.params;

  try {
    // Check for Salesforce connection (including error state for recovery)
    const connResult = await query<{ status: string }>(
      `SELECT status FROM connections
       WHERE workspace_id = $1 AND connector_name = 'salesforce' AND status IN ('connected', 'healthy', 'synced', 'error')`,
      [workspaceId]
    );

    if (connResult.rows.length === 0) {
      res.status(404).json({ error: 'No active Salesforce connection found' });
      return;
    }

    // If connection is in error state, attempt token refresh to recover
    if (connResult.rows[0].status === 'error') {
      logger.info('Connection in error state, attempting token refresh recovery', { workspaceId });
      try {
        const refreshedCreds = await getFreshCredentials(workspaceId);
        if (refreshedCreds) {
          await query(
            `UPDATE connections SET status = 'connected', error_message = NULL, updated_at = NOW()
             WHERE workspace_id = $1 AND connector_name = 'salesforce'`,
            [workspaceId]
          );
          logger.info('Connection recovered from error state via token refresh', { workspaceId });
        }
      } catch (refreshErr) {
        logger.error('Token refresh recovery failed', { workspaceId, error: (refreshErr as Error).message });
        res.status(401).json({
          error: 'Salesforce connection requires re-authentication',
          message: (refreshErr as Error).message,
        });
        return;
      }
    }

    // Clean up stale locks (syncs stuck in 'running' for > 1 hour)
    await query(
      `UPDATE sync_log
       SET status = 'failed',
           errors = '["Sync timed out (exceeded 1 hour)"]'::jsonb,
           completed_at = NOW()
       WHERE workspace_id = $1
         AND connector_type = 'salesforce'
         AND status = 'running'
         AND started_at < NOW() - INTERVAL '1 hour'`,
      [workspaceId]
    );

    // Check for running sync (prevent duplicates)
    const runningResult = await query(
      `SELECT id FROM sync_log
       WHERE workspace_id = $1 AND connector_type = 'salesforce' AND status IN ('pending', 'running')
       LIMIT 1`,
      [workspaceId]
    );

    if (runningResult.rows.length > 0) {
      res.status(409).json({
        error: 'Salesforce sync already in progress for this workspace',
        syncId: runningResult.rows[0].id
      });
      return;
    }

    // Create sync_log entry
    const syncLogResult = await query(
      `INSERT INTO sync_log (workspace_id, connector_type, sync_type, status, started_at)
       VALUES ($1, 'salesforce', 'manual', 'pending', NOW())
       RETURNING id`,
      [workspaceId]
    );

    const syncLogId = syncLogResult.rows[0].id;

    // Get fresh credentials (auto-refresh if needed)
    const credentials = await getFreshCredentials(workspaceId);
    credentials.clientId = process.env.SALESFORCE_CLIENT_ID;
    credentials.clientSecret = process.env.SALESFORCE_CLIENT_SECRET;

    // Auto-detect sync mode based on last_sync_at watermark
    const lastSyncResult = await query<{ last_sync_at: Date | null }>(
      `SELECT last_sync_at FROM connections
       WHERE workspace_id = $1 AND connector_name = 'salesforce'`,
      [workspaceId]
    );
    const mode = lastSyncResult.rows[0]?.last_sync_at ? 'incremental' : 'full';

    logger.info('Salesforce sync mode auto-detected', { workspaceId, mode, lastSyncAt: lastSyncResult.rows[0]?.last_sync_at });

    // Create background job
    const jobQueue = getJobQueue();
    const jobId = await jobQueue.createJob({
      workspaceId,
      jobType: 'salesforce_sync',
      payload: {
        credentials,
        syncLogId,
        mode,
      },
      priority: 1, // Manual syncs get higher priority
    });

    logger.info('Salesforce sync job created', { workspaceId, jobId, syncLogId });

    // Return 202 immediately (non-blocking)
    res.status(202).json({
      syncId: syncLogId,
      jobId,
      status: 'queued',
      message: 'Salesforce sync queued',
      statusUrl: `/api/workspaces/${workspaceId}/sync/jobs/${jobId}`,
    });
  } catch (error) {
    logger.error('Failed to queue Salesforce sync', { error });
    res.status(500).json({
      error: 'Failed to queue sync',
      message: (error as Error).message
    });
  }
});

// Test connection
router.post('/:workspaceId/connectors/salesforce/test', async (req, res) => {
  const { workspaceId } = req.params;

  try {
    const connResult = await query<{ id: string; status: string }>(
      `SELECT id, status FROM connections
       WHERE workspace_id = $1 AND connector_name = 'salesforce'`,
      [workspaceId]
    );

    if (connResult.rows.length === 0) {
      res.status(404).json({ error: 'Salesforce connection not found. Connect first.' });
      return;
    }

    const conn = connResult.rows[0];

    const credentials = await getFreshCredentials(workspaceId);
    const result = await salesforceAdapter.testConnection(credentials);

    res.json({
      success: result.success,
      message: result.success ? 'Connection successful' : 'Connection failed',
      error: result.error,
    });
  } catch (error) {
    logger.error('Failed to test Salesforce connection', { error });
    res.status(500).json({
      error: 'Failed to test connection',
      message: (error as Error).message
    });
  }
});

// Discover schema
router.post('/:workspaceId/connectors/salesforce/discover-schema', async (req, res) => {
  const { workspaceId } = req.params;

  try {
    const connResult = await query<{ id: string; status: string }>(
      `SELECT id, status FROM connections
       WHERE workspace_id = $1 AND connector_name = 'salesforce'`,
      [workspaceId]
    );

    if (connResult.rows.length === 0) {
      res.status(404).json({ error: 'Salesforce connection not found. Connect first.' });
      return;
    }

    const credentials = await getFreshCredentials(workspaceId);

    if (!salesforceAdapter.discoverSchema) {
      res.status(501).json({ error: 'Schema discovery not implemented for Salesforce' });
      return;
    }

    const schema = await salesforceAdapter.discoverSchema(credentials);

    const summary = {
      objectTypes: schema.objectTypes.map(ot => ({
        name: ot.name,
        totalFields: ot.fields.length,
        customFields: ot.fields.filter(f => f.custom).length,
      })),
    };

    res.json({
      success: true,
      summary,
      schema,
    });
  } catch (error) {
    logger.error('Failed to discover Salesforce schema', { error });
    res.status(500).json({
      error: 'Failed to discover schema',
      message: (error as Error).message
    });
  }
});

// Health check
router.get('/:workspaceId/connectors/salesforce/health', async (req, res) => {
  const { workspaceId } = req.params;

  try {
    const credentials = await getFreshCredentials(workspaceId);
    const health = await salesforceAdapter.health(credentials);
    res.json(health);
  } catch (error) {
    logger.error('Failed to check Salesforce health', { error });
    res.status(500).json({
      error: 'Failed to check health',
      message: (error as Error).message
    });
  }
});

// Disconnect
router.delete('/:workspaceId/connectors/salesforce/disconnect', async (req, res) => {
  const { workspaceId } = req.params;

  try {
    const result = await query(
      `UPDATE connections
       SET credentials = NULL, status = 'disconnected', updated_at = NOW()
       WHERE workspace_id = $1 AND connector_name = 'salesforce'
       RETURNING id`,
      [workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Salesforce connection not found' });
      return;
    }

    logger.info('Salesforce connection disconnected', { workspaceId });

    res.json({
      success: true,
      message: 'Salesforce connection disconnected',
    });
  } catch (error) {
    logger.error('Failed to disconnect Salesforce', { error });
    res.status(500).json({
      error: 'Failed to disconnect',
      message: (error as Error).message
    });
  }
});

export default router;
