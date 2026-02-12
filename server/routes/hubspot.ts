import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';
import { hubspotConnector } from '../connectors/hubspot/index.js';
import { populateDealContactsFromSourceData } from '../connectors/hubspot/sync.js';
import type { Connection, ConnectorCredentials } from '../connectors/_interface.js';
import { decryptCredentials, isEncrypted } from '../lib/encryption.js';

const router = Router();

interface WorkspaceParams {
  workspaceId: string;
}

router.post('/:workspaceId/connectors/hubspot/connect', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;
    const { accessToken, refreshToken } = req.body as { accessToken?: string; refreshToken?: string };

    if (!accessToken) {
      res.status(400).json({ error: 'accessToken is required' });
      return;
    }

    const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (wsCheck.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const credentials: ConnectorCredentials = { accessToken, refreshToken };
    const connection = await hubspotConnector.connect(credentials, workspaceId);

    res.json({
      success: true,
      connection: {
        id: connection.id,
        connectorName: connection.connectorName,
        status: connection.status,
        accountInfo: connection.metadata,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[HubSpot Route] Connect error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/connectors/hubspot/sync', async (req: Request<WorkspaceParams>, res: Response) => {
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
       WHERE workspace_id = $1 AND connector_name = 'hubspot'`,
      [workspaceId]
    );

    if (connResult.rows.length === 0) {
      res.status(404).json({ error: 'HubSpot connection not found. Connect first.' });
      return;
    }

    const conn = connResult.rows[0];
    if (conn.status === 'disconnected') {
      res.status(400).json({ error: 'HubSpot connection is disconnected. Reconnect first.' });
      return;
    }

    // Decrypt credentials if encrypted
    let credentials = conn.credentials;
    if (credentials && isEncrypted(credentials)) {
      credentials = decryptCredentials(credentials);
    }

    const connection: Connection = {
      id: conn.id,
      workspaceId,
      connectorName: 'hubspot',
      status: conn.status as Connection['status'],
      credentials,
    };

    let result;

    switch (mode) {
      case 'incremental': {
        const sinceDate = since
          ? new Date(since)
          : conn.last_sync_at
            ? new Date(conn.last_sync_at)
            : new Date(Date.now() - 24 * 60 * 60 * 1000);
        result = await hubspotConnector.incrementalSync(connection, workspaceId, sinceDate);
        break;
      }
      case 'backfill':
        result = await hubspotConnector.backfillSync!(connection, workspaceId);
        break;
      case 'initial':
      default:
        result = await hubspotConnector.initialSync(connection, workspaceId);
        break;
    }

    res.json({
      success: result.errors.length === 0,
      mode,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[HubSpot Route] Sync error:', message);
    res.status(500).json({ error: message });
  }
});

router.get('/:workspaceId/connectors/hubspot/health', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;
    const health = await hubspotConnector.health(workspaceId);
    res.json(health);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[HubSpot Route] Health check error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/connectors/hubspot/discover-schema', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;

    const connResult = await query<{ id: string; credentials: any; status: string }>(
      `SELECT id, credentials, status FROM connections
       WHERE workspace_id = $1 AND connector_name = 'hubspot'`,
      [workspaceId]
    );

    if (connResult.rows.length === 0) {
      res.status(404).json({ error: 'HubSpot connection not found. Connect first.' });
      return;
    }

    const conn = connResult.rows[0];

    // Decrypt credentials if encrypted
    let credentials = conn.credentials;
    if (credentials && isEncrypted(credentials)) {
      credentials = decryptCredentials(credentials);
    }

    const connection: Connection = {
      id: conn.id,
      workspaceId,
      connectorName: 'hubspot',
      status: conn.status as Connection['status'],
      credentials,
    };

    const schema = await hubspotConnector.discoverSchema!(connection);

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
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[HubSpot Route] Schema discovery error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/connectors/hubspot/populate-deal-contacts', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const populated = await populateDealContactsFromSourceData(workspaceId);
    res.json({ success: true, populated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[HubSpot Route] Populate deal contacts error:', message);
    res.status(500).json({ error: message });
  }
});

export default router;
