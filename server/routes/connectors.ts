import { Router, type Request, type Response } from 'express';
import { query as dbQuery } from '../db.js';
import { MondayTaskAdapter } from '../connectors/monday/adapter.js';
import { GoogleDriveDocumentAdapter } from '../connectors/google-drive/adapter.js';
import {
  getCredentials,
  storeCredentials,
  updateSyncStatus,
  updateSyncCursor,
} from '../connectors/adapters/credentials.js';
import { upsertTasks, upsertDocuments } from '../connectors/adapters/db-upsert.js';

const router = Router();

interface WorkspaceParams {
  workspaceId: string;
}

const mondayAdapter = new MondayTaskAdapter();
const googleDriveAdapter = new GoogleDriveDocumentAdapter();

router.get('/:workspaceId/connectors', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const result = await dbQuery(
      `SELECT id, connector_name as source_type, status, last_sync_at, error_message, metadata, created_at
       FROM connections
       WHERE workspace_id = $1
       ORDER BY created_at DESC`,
      [workspaceId]
    );
    const connectors = result.rows.map(r => {
      const meta = r.metadata || {};
      return {
        ...r,
        name: r.source_type,
        record_counts: meta.record_counts || null,
      };
    });
    res.json(connectors);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:workspaceId/connectors/monday/connect', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { apiKey, boardId } = req.body;

    if (!apiKey) {
      res.status(400).json({ error: 'apiKey is required' });
      return;
    }

    const testResult = await mondayAdapter.testConnection({ apiKey });
    if (!testResult.success) {
      res.status(400).json({ error: `Connection test failed: ${testResult.error}` });
      return;
    }

    const connection = await storeCredentials(workspaceId, 'monday', 'api_key', {
      apiKey,
      boardId: boardId || null,
    });

    res.json({
      success: true,
      connectionId: connection.id,
      message: 'Monday.com connected successfully',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Monday Route] Connect error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/connectors/monday/sync', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { mode = 'initial', boardId } = req.body;

    const conn = await getCredentials(workspaceId, 'monday');
    if (!conn) {
      res.status(404).json({ error: 'Monday.com connection not found. Connect first.' });
      return;
    }

    if (conn.status === 'disconnected') {
      res.status(400).json({ error: 'Monday.com connection is disconnected.' });
      return;
    }

    const effectiveBoardId = boardId || conn.credentials.boardId;
    if (!effectiveBoardId) {
      res.status(400).json({ error: 'boardId is required (pass in body or set during connect)' });
      return;
    }

    await updateSyncStatus(workspaceId, 'monday', 'syncing');

    let syncResult;
    if (mode === 'incremental' && conn.last_sync_at) {
      syncResult = await mondayAdapter.incrementalSync(
        conn.credentials,
        workspaceId,
        new Date(conn.last_sync_at),
        { boardId: effectiveBoardId }
      );
    } else {
      syncResult = await mondayAdapter.initialSync(
        conn.credentials,
        workspaceId,
        { boardId: effectiveBoardId }
      );
    }

    const tasks = syncResult.tasks;
    let dbResult = { inserted: 0, failed: 0 };

    if (tasks && tasks.succeeded.length > 0) {
      dbResult = await upsertTasks(tasks.succeeded);
    }

    await updateSyncStatus(workspaceId, 'monday', 'synced');
    await updateSyncCursor(workspaceId, 'monday', {
      lastSyncMode: mode,
      lastSyncAt: new Date().toISOString(),
      boardId: effectiveBoardId,
    });

    res.json({
      success: true,
      mode,
      tasks: {
        transformed: tasks?.succeeded.length || 0,
        transformFailed: tasks?.failed.length || 0,
        dbInserted: dbResult.inserted,
        dbFailed: dbResult.failed,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Monday Route] Sync error:', message);
    await updateSyncStatus(req.params.workspaceId, 'monday', 'error', message).catch(() => {});
    res.status(500).json({ error: message });
  }
});

router.get('/:workspaceId/connectors/monday/health', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;

    const conn = await getCredentials(workspaceId, 'monday');
    if (!conn) {
      res.json({ connected: false, status: 'not_connected' });
      return;
    }

    const healthResult = await mondayAdapter.health!(conn.credentials);

    res.json({
      connected: true,
      status: conn.status,
      lastSyncAt: conn.last_sync_at,
      healthy: healthResult.healthy,
      details: healthResult.details,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Monday Route] Health check error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/connectors/google-drive/connect', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { accessToken, refreshToken, clientId, clientSecret, expiresAt } = req.body;

    if (!accessToken) {
      res.status(400).json({ error: 'accessToken is required' });
      return;
    }

    const testResult = await googleDriveAdapter.testConnection({
      accessToken,
      refreshToken,
      clientId,
      clientSecret,
      expiresAt,
    });

    if (!testResult.success) {
      res.status(400).json({ error: `Connection test failed: ${testResult.error}` });
      return;
    }

    const connection = await storeCredentials(workspaceId, 'google-drive', 'oauth2', {
      accessToken,
      refreshToken: refreshToken || null,
      clientId: clientId || null,
      clientSecret: clientSecret || null,
      expiresAt: expiresAt || null,
    });

    res.json({
      success: true,
      connectionId: connection.id,
      message: 'Google Drive connected successfully',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Google Drive Route] Connect error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/connectors/google-drive/sync', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { mode = 'initial', query: fileQuery } = req.body;

    const conn = await getCredentials(workspaceId, 'google-drive');
    if (!conn) {
      res.status(404).json({ error: 'Google Drive connection not found. Connect first.' });
      return;
    }

    if (conn.status === 'disconnected') {
      res.status(400).json({ error: 'Google Drive connection is disconnected.' });
      return;
    }

    await updateSyncStatus(workspaceId, 'google-drive', 'syncing');

    let syncResult;
    const options = fileQuery ? { query: fileQuery } : undefined;

    if (mode === 'incremental' && conn.last_sync_at) {
      syncResult = await googleDriveAdapter.incrementalSync(
        conn.credentials,
        workspaceId,
        new Date(conn.last_sync_at),
        options
      );
    } else {
      syncResult = await googleDriveAdapter.initialSync(
        conn.credentials,
        workspaceId,
        options
      );
    }

    const docs = syncResult.documents;
    let dbResult = { inserted: 0, failed: 0 };

    if (docs && docs.succeeded.length > 0) {
      dbResult = await upsertDocuments(docs.succeeded);
    }

    await updateSyncStatus(workspaceId, 'google-drive', 'synced');
    await updateSyncCursor(workspaceId, 'google-drive', {
      lastSyncMode: mode,
      lastSyncAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      mode,
      documents: {
        transformed: docs?.succeeded.length || 0,
        transformFailed: docs?.failed.length || 0,
        dbInserted: dbResult.inserted,
        dbFailed: dbResult.failed,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Google Drive Route] Sync error:', message);
    await updateSyncStatus(req.params.workspaceId, 'google-drive', 'error', message).catch(() => {});
    res.status(500).json({ error: message });
  }
});

router.get('/:workspaceId/connectors/google-drive/health', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;

    const conn = await getCredentials(workspaceId, 'google-drive');
    if (!conn) {
      res.json({ connected: false, status: 'not_connected' });
      return;
    }

    const healthResult = await googleDriveAdapter.health!(conn.credentials);

    res.json({
      connected: true,
      status: conn.status,
      lastSyncAt: conn.last_sync_at,
      healthy: healthResult.healthy,
      details: healthResult.details,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Google Drive Route] Health check error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/connectors/google-drive/content/:sourceId', async (req: Request<WorkspaceParams & { sourceId: string }>, res: Response) => {
  try {
    const { workspaceId, sourceId } = req.params;

    const conn = await getCredentials(workspaceId, 'google-drive');
    if (!conn) {
      res.status(404).json({ error: 'Google Drive connection not found. Connect first.' });
      return;
    }

    const result = await googleDriveAdapter.extractContent!(conn.credentials, sourceId);

    if (result.text) {
      await dbQuery(
        `UPDATE documents SET
           content_text = $1,
           updated_at = NOW()
         WHERE workspace_id = $2 AND source = 'google-drive' AND source_id = $3`,
        [result.text, workspaceId, sourceId]
      );
    }

    res.json({
      success: true,
      sourceId,
      contentText: result.text,
      error: result.error,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Google Drive Route] Content extraction error:', message);
    res.status(500).json({ error: message });
  }
});

export default router;
