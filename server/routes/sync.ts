import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';
import { syncWorkspace } from '../sync/orchestrator.js';
import { getJobQueue } from '../jobs/queue.js';

const router = Router();

router.post('/:id/sync', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.id;
  const { connectorType } = req.body || {};

  try {
    const wsResult = await query<{ id: string }>(
      'SELECT id FROM workspaces WHERE id = $1',
      [workspaceId]
    );

    if (wsResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    // Check for stale locks (syncs stuck in 'running' for > 1 hour)
    await query(
      `UPDATE sync_log
       SET status = 'failed',
           errors = '["Sync timed out (exceeded 1 hour)"]'::jsonb,
           completed_at = NOW()
       WHERE workspace_id = $1
         AND status = 'running'
         AND started_at < NOW() - INTERVAL '1 hour'`,
      [workspaceId]
    );

    const runningResult = await query<{ id: string }>(
      `SELECT id FROM sync_log
       WHERE workspace_id = $1 AND status IN ('pending', 'running')
       LIMIT 1`,
      [workspaceId]
    );

    if (runningResult.rows.length > 0) {
      res.status(409).json({ error: 'Sync already in progress for this workspace' });
      return;
    }

    const connectors = connectorType ? [connectorType] : undefined;

    const connResult = await query<{ connector_name: string }>(
      `SELECT connector_name FROM connections
       WHERE workspace_id = $1 AND status IN ('connected', 'synced', 'error', 'healthy')
       ${connectorType ? "AND connector_name = $2" : ""}`,
      connectorType ? [workspaceId, connectorType] : [workspaceId]
    );

    const connectorCount = connResult.rows.length;

    if (connectorCount === 0) {
      res.status(400).json({ error: 'No connected connectors found' });
      return;
    }

    const syncLogResult = await query<{ id: string }>(
      `INSERT INTO sync_log (workspace_id, connector_type, sync_type, status, started_at)
       VALUES ($1, $2, 'manual', 'pending', NOW())
       RETURNING id`,
      [workspaceId, connectorType || 'all']
    );

    const syncLogId = syncLogResult.rows[0].id;

    // Create background job instead of blocking
    const jobQueue = getJobQueue();
    const jobId = await jobQueue.createJob({
      workspaceId,
      jobType: 'sync',
      payload: {
        connectorType,
        syncLogId,
      },
      priority: 1, // Manual syncs get higher priority than scheduled
    });

    res.status(202).json({
      syncId: syncLogId,
      jobId,
      status: 'queued',
      message: `Sync queued for ${connectorCount} connector(s)`,
      statusUrl: `/api/workspaces/${workspaceId}/sync/jobs/${jobId}`,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Sync API] Manual sync error:', msg);
    res.status(500).json({ error: 'Failed to initiate sync' });
  }
});

router.get('/:id/sync/status', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.id;

  try {
    const connectorsResult = await query<{
      connector_name: string;
      status: string;
      last_sync_at: Date | null;
      error_message: string | null;
    }>(
      `SELECT connector_name, status, last_sync_at, error_message
       FROM connections
       WHERE workspace_id = $1
       ORDER BY connector_name`,
      [workspaceId]
    );

    const runningResult = await query<{ id: string; connector_type: string; started_at: Date }>(
      `SELECT id, connector_type, started_at FROM sync_log
       WHERE workspace_id = $1 AND status = 'running'
       ORDER BY started_at DESC
       LIMIT 1`,
      [workspaceId]
    );

    const lastFullSyncResult = await query<{ completed_at: Date }>(
      `SELECT completed_at FROM sync_log
       WHERE workspace_id = $1 AND connector_type = 'all'
         AND status IN ('completed', 'completed_with_errors')
       ORDER BY completed_at DESC
       LIMIT 1`,
      [workspaceId]
    );

    const isRunning = runningResult.rows.length > 0;

    res.json({
      isRunning,
      runningSyncId: isRunning ? runningResult.rows[0].id : null,
      connectors: connectorsResult.rows.map((row) => ({
        name: row.connector_name,
        status: row.status,
        lastSyncAt: row.last_sync_at,
        lastError: row.error_message,
      })),
      lastFullSync: lastFullSyncResult.rows[0]?.completed_at || null,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Sync API] Status error:', msg);
    res.status(500).json({ error: 'Failed to fetch sync status' });
  }
});

router.get('/:id/sync/jobs/:jobId', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.id;
  const jobId = req.params.jobId;

  try {
    const jobQueue = getJobQueue();
    const job = await jobQueue.getJob(jobId);

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    if (job.workspace_id !== workspaceId) {
      res.status(403).json({ error: 'Job does not belong to this workspace' });
      return;
    }

    res.json({
      id: job.id,
      status: job.status,
      jobType: job.job_type,
      progress: job.progress || null,
      result: job.result || null,
      error: job.error || null,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      createdAt: job.created_at,
      startedAt: job.started_at,
      completedAt: job.completed_at,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Sync API] Job status error:', msg);
    res.status(500).json({ error: 'Failed to fetch job status' });
  }
});

router.get('/:id/sync/jobs', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.id;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

  try {
    const jobQueue = getJobQueue();
    const jobs = await jobQueue.getJobsByWorkspace(workspaceId, limit);

    res.json({
      jobs: jobs.map(job => ({
        id: job.id,
        status: job.status,
        jobType: job.job_type,
        progress: job.progress || null,
        error: job.error || null,
        createdAt: job.created_at,
        startedAt: job.started_at,
        completedAt: job.completed_at,
      })),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Sync API] Jobs list error:', msg);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

router.get('/:id/sync/history', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.id;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const connector = req.query.connector as string | undefined;

  try {
    const historyResult = await query<{
      id: string;
      connector_type: string;
      sync_type: string;
      status: string;
      records_synced: number;
      errors: any;
      duration_ms: number | null;
      started_at: Date;
      completed_at: Date | null;
    }>(
      `SELECT id, connector_type, sync_type, status, records_synced,
              errors, duration_ms, started_at, completed_at
       FROM sync_log
       WHERE workspace_id = $1
         ${connector ? "AND connector_type = $3" : ""}
       ORDER BY started_at DESC
       LIMIT $2`,
      connector ? [workspaceId, limit, connector] : [workspaceId, limit]
    );

    res.json({
      entries: historyResult.rows.map((row) => ({
        id: row.id,
        connectorType: row.connector_type,
        syncType: row.sync_type,
        status: row.status,
        recordsSynced: row.records_synced,
        durationMs: row.duration_ms,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        errors: row.errors,
      })),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Sync API] History error:', msg);
    res.status(500).json({ error: 'Failed to fetch sync history' });
  }
});

export default router;
