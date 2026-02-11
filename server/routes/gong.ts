import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';
import { gongConnector } from '../connectors/gong/index.js';
import { GongClient } from '../connectors/gong/client.js';
import type { Connection, ConnectorCredentials } from '../connectors/_interface.js';

const router = Router();

interface WorkspaceParams {
  workspaceId: string;
}

router.post('/:workspaceId/connectors/gong/connect', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;
    const { apiKey } = req.body as { apiKey?: string };

    if (!apiKey) {
      res.status(400).json({ error: 'apiKey is required (format: accessKey:accessKeySecret)' });
      return;
    }

    if (!apiKey.includes(':')) {
      res.status(400).json({ error: 'apiKey must be in format accessKey:accessKeySecret' });
      return;
    }

    const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (wsCheck.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const credentials: ConnectorCredentials = { apiKey };
    const connection = await gongConnector.connect(credentials, workspaceId);

    res.json({
      success: true,
      connection: {
        id: connection.id,
        connectorName: connection.connectorName,
        status: connection.status,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Gong Route] Connect error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/connectors/gong/sync', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;
    const { mode = 'initial', since, lookbackDays } = req.body as { mode?: string; since?: string; lookbackDays?: number };

    const connResult = await query<{
      id: string;
      credentials: any;
      status: string;
      last_sync_at: Date | null;
    }>(
      `SELECT id, credentials, status, last_sync_at FROM connections
       WHERE workspace_id = $1 AND connector_name = 'gong'`,
      [workspaceId]
    );

    if (connResult.rows.length === 0) {
      res.status(404).json({ error: 'Gong connection not found. Connect first.' });
      return;
    }

    const conn = connResult.rows[0];
    if (conn.status === 'disconnected') {
      res.status(400).json({ error: 'Gong connection is disconnected. Reconnect first.' });
      return;
    }

    const connection: Connection = {
      id: conn.id,
      workspaceId,
      connectorName: 'gong',
      status: conn.status as Connection['status'],
      credentials: conn.credentials,
    };

    let result;

    switch (mode) {
      case 'incremental': {
        const sinceDate = since
          ? new Date(since)
          : conn.last_sync_at
            ? new Date(conn.last_sync_at)
            : new Date(Date.now() - 24 * 60 * 60 * 1000);
        result = await gongConnector.incrementalSync(connection, workspaceId, sinceDate);
        break;
      }
      case 'initial':
      default:
        result = await gongConnector.initialSync(connection, workspaceId, { lookbackDays: lookbackDays ? Number(lookbackDays) : undefined });
        break;
    }

    res.json({
      success: result.errors.length === 0,
      mode,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Gong Route] Sync error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/connectors/gong/transcript/:sourceId', async (req: Request<WorkspaceParams & { sourceId: string }>, res: Response) => {
  try {
    const { workspaceId, sourceId } = req.params;

    const connResult = await query<{ credentials: any; status: string }>(
      `SELECT credentials, status FROM connections
       WHERE workspace_id = $1 AND connector_name = 'gong'`,
      [workspaceId]
    );

    if (connResult.rows.length === 0) {
      res.status(404).json({ error: 'Gong connection not found. Connect first.' });
      return;
    }

    const conn = connResult.rows[0];
    if (conn.status === 'disconnected') {
      res.status(400).json({ error: 'Gong connection is disconnected.' });
      return;
    }

    const client = new GongClient(conn.credentials.apiKey);
    const { call, transcript } = await client.getCallWithTranscript(sourceId);

    if (!transcript) {
      res.json({ success: true, sourceId, transcriptText: null });
      return;
    }

    const transcriptText = client.formatTranscriptAsText(transcript, call.parties || []);

    await query(
      `UPDATE conversations SET
        transcript_text = $1,
        updated_at = NOW()
      WHERE workspace_id = $2 AND source = 'gong' AND source_id = $3`,
      [transcriptText, workspaceId, sourceId]
    );

    res.json({ success: true, sourceId, transcriptText });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Gong Route] Transcript fetch error:', message);
    res.status(500).json({ error: message });
  }
});

router.get('/:workspaceId/connectors/gong/health', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;
    const health = await gongConnector.health(workspaceId);
    res.json(health);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Gong Route] Health check error:', message);
    res.status(500).json({ error: message });
  }
});

export default router;
