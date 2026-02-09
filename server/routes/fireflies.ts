import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';
import { firefliesConnector } from '../connectors/fireflies/index.js';
import { FirefliesClient, formatSentencesToTranscript } from '../connectors/fireflies/client.js';
import type { Connection, ConnectorCredentials } from '../connectors/_interface.js';

const router = Router();

interface WorkspaceParams {
  workspaceId: string;
}

router.post('/:workspaceId/connectors/fireflies/connect', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;
    const { apiKey } = req.body as { apiKey?: string };

    if (!apiKey) {
      res.status(400).json({ error: 'apiKey is required' });
      return;
    }

    const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (wsCheck.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const credentials: ConnectorCredentials = { apiKey };
    const connection = await firefliesConnector.connect(credentials, workspaceId);

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
    console.error('[Fireflies Route] Connect error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/connectors/fireflies/sync', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;
    const { mode = 'initial', since } = req.body as { mode?: string; since?: string };

    const connResult = await query<{
      id: string;
      credentials: any;
      status: string;
      last_sync_at: Date | null;
    }>(
      `SELECT id, credentials, status, last_sync_at FROM connections
       WHERE workspace_id = $1 AND connector_name = 'fireflies'`,
      [workspaceId]
    );

    if (connResult.rows.length === 0) {
      res.status(404).json({ error: 'Fireflies connection not found. Connect first.' });
      return;
    }

    const conn = connResult.rows[0];
    if (conn.status === 'disconnected') {
      res.status(400).json({ error: 'Fireflies connection is disconnected. Reconnect first.' });
      return;
    }

    const connection: Connection = {
      id: conn.id,
      workspaceId,
      connectorName: 'fireflies',
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
        result = await firefliesConnector.incrementalSync(connection, workspaceId, sinceDate);
        break;
      }
      case 'initial':
      default:
        result = await firefliesConnector.initialSync(connection, workspaceId);
        break;
    }

    res.json({
      success: result.errors.length === 0,
      mode,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Fireflies Route] Sync error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/connectors/fireflies/transcript/:sourceId', async (req: Request<WorkspaceParams & { sourceId: string }>, res: Response) => {
  try {
    const { workspaceId, sourceId } = req.params;

    const connResult = await query<{ credentials: any; status: string }>(
      `SELECT credentials, status FROM connections
       WHERE workspace_id = $1 AND connector_name = 'fireflies'`,
      [workspaceId]
    );

    if (connResult.rows.length === 0) {
      res.status(404).json({ error: 'Fireflies connection not found. Connect first.' });
      return;
    }

    const conn = connResult.rows[0];
    if (conn.status === 'disconnected') {
      res.status(400).json({ error: 'Fireflies connection is disconnected.' });
      return;
    }

    const client = new FirefliesClient(conn.credentials.apiKey);
    const transcript = await client.getTranscript(sourceId);

    const transcriptText = transcript.sentences
      ? formatSentencesToTranscript(transcript.sentences)
      : null;

    if (transcriptText) {
      await query(
        `UPDATE conversations SET
          transcript_text = $1,
          updated_at = NOW()
        WHERE workspace_id = $2 AND source = 'fireflies' AND source_id = $3`,
        [transcriptText, workspaceId, sourceId]
      );
    }

    res.json({ success: true, sourceId, transcriptText });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Fireflies Route] Transcript fetch error:', message);
    res.status(500).json({ error: message });
  }
});

router.get('/:workspaceId/connectors/fireflies/health', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;
    const health = await firefliesConnector.health(workspaceId);
    res.json(health);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Fireflies Route] Health check error:', message);
    res.status(500).json({ error: message });
  }
});

export default router;
