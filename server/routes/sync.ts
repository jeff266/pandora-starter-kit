import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';
import { syncWorkspace } from '../sync/orchestrator.js';

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

    const runningResult = await query<{ id: string }>(
      `SELECT id FROM sync_log
       WHERE workspace_id = $1 AND status = 'running'
       LIMIT 1`,
      [workspaceId]
    );

    if (runningResult.rows.length > 0) {
      res.status(409).json({ error: 'Sync already running for this workspace' });
      return;
    }

    const connectors = connectorType ? [connectorType] : undefined;

    const connResult = await query<{ connector_name: string }>(
      `SELECT connector_name FROM connections
       WHERE workspace_id = $1 AND status IN ('connected', 'synced', 'error')
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
       VALUES ($1, $2, 'manual', 'running', NOW())
       RETURNING id`,
      [workspaceId, connectorType || 'all']
    );

    const syncId = syncLogResult.rows[0].id;

    res.status(202).json({
      syncId,
      status: 'started',
      message: `Sync initiated for ${connectorCount} connector(s)`,
    });

    const startTime = Date.now();
    try {
      const results = await syncWorkspace(workspaceId, { connectors });

      const totalRecords = results.reduce((sum, r) => {
        if (!r.counts) return sum;
        return sum + Object.values(r.counts).reduce((s, c) => s + c.dbInserted, 0);
      }, 0);

      const errors = results
        .filter((r) => r.status === 'error')
        .map((r) => r.message || 'Unknown error');

      await query(
        `UPDATE sync_log
         SET status = $1, records_synced = $2, errors = $3,
             duration_ms = $4, completed_at = NOW()
         WHERE id = $5`,
        [
          errors.length > 0 ? 'completed_with_errors' : 'completed',
          totalRecords,
          JSON.stringify(errors),
          Date.now() - startTime,
          syncId,
        ]
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await query(
        `UPDATE sync_log
         SET status = 'failed', errors = $1, duration_ms = $2, completed_at = NOW()
         WHERE id = $3`,
        [JSON.stringify([msg]), Date.now() - startTime, syncId]
      ).catch(() => {});
    }
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
