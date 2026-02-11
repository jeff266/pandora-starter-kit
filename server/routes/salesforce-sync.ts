import { Router } from 'express';
import { query } from '../db.js';
import { getJobQueue } from '../jobs/queue.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('SalesforceSync');

router.post('/:workspaceId/connectors/salesforce/sync', async (req, res) => {
  const { workspaceId } = req.params;

  try {
    // Check for active Salesforce connection
    const connResult = await query(
      `SELECT credentials FROM connections
       WHERE workspace_id = $1 AND connector_name = 'salesforce' AND status IN ('connected', 'healthy', 'synced')`,
      [workspaceId]
    );

    if (connResult.rows.length === 0) {
      res.status(404).json({ error: 'No active Salesforce connection found' });
      return;
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

    // Get credentials with client ID/secret
    const credentials = connResult.rows[0].credentials;
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

export default router;
