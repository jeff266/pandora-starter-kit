import { Router, type Request, type Response } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { query } from '../db.js';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { firefliesConnector } from '../connectors/fireflies/index.js';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { FirefliesClient, formatSentencesToTranscript } from '../connectors/fireflies/client.js';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import type { Connection, ConnectorCredentials } from '../connectors/_interface.js';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { linkConversations } from '../linker/entity-linker.js';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { getConnectorCredentials } from '../lib/credential-store.js';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import {
  fetchAndStoreDirectory,
  getDirectory,
  setTrackedUsers,
  getTrackedUsers,
  clearTrackedUsers,
  type NormalizedUser,
} from '../connectors/shared/tracked-users.js';

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
      user_directory: connection.metadata?.user_directory,
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
    const { mode = 'initial', since, lookbackDays } = req.body as { mode?: string; since?: string; lookbackDays?: number };

    // Get connection metadata (not credentials)
    const connResult = await query<{
      id: string;
      status: string;
      last_sync_at: Date | null;
    }>(
      `SELECT id, status, last_sync_at FROM connections
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

    // Get credentials from credential store
    const credentials = await getConnectorCredentials(workspaceId, 'fireflies');
    if (!credentials) {
      res.status(404).json({ error: 'Fireflies credentials not found.' });
      return;
    }

    const connection: Connection = {
      id: conn.id,
      workspaceId,
      connectorName: 'fireflies',
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
        result = await firefliesConnector.incrementalSync(connection, workspaceId, sinceDate);
        break;
      }
      case 'initial':
      default:
        result = await firefliesConnector.initialSync(connection, workspaceId, { lookbackDays: lookbackDays ? Number(lookbackDays) : undefined });
        break;
    }

    if (result.errors.length > 0 && result.errors[0]?.includes('No tracked users configured')) {
      res.status(400).json({
        error: 'No tracked users configured',
        action: `POST /api/workspaces/${workspaceId}/connectors/fireflies/users/track to select users`,
      });
      return;
    }

    res.json({
      success: result.errors.length === 0,
      mode,
      ...result,
    });

    linkConversations(workspaceId)
      .then(lr => {
        const total = lr.linked.tier1_email + lr.linked.tier2_native + lr.linked.tier3_inferred;
        console.log(`[Linker] Fireflies post-sync: ${total} linked, ${lr.stillUnlinked} unlinked (${lr.durationMs}ms)`);
      })
      .catch(err => console.error(`[Linker] Fireflies post-sync failed:`, err.message));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Fireflies Route] Sync error:', message);
    res.status(500).json({ error: message });
  }
});

router.get('/:workspaceId/connectors/fireflies/users', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;

    const dir = await getDirectory(workspaceId, 'fireflies');

    if (dir) {
      const fetchedAt = new Date(dir.fetchedAt);
      const hoursAgo = (Date.now() - fetchedAt.getTime()) / (1000 * 60 * 60);

      if (hoursAgo < 24) {
        const tracked = await getTrackedUsers(workspaceId, 'fireflies');
        res.json({
          users: dir.users,
          fetched_at: dir.fetchedAt,
          tracked_users: tracked,
        });
        return;
      }
    }

    // Get credentials from credential store
    const credentials = await getConnectorCredentials(workspaceId, 'fireflies');
    if (!credentials) {
      res.status(404).json({ error: 'Fireflies connection not found. Connect first.' });
      return;
    }

    const client = new FirefliesClient(credentials.apiKey);
    const rawUsers = await client.getUsers();
    const normalized: NormalizedUser[] = rawUsers
      .map(u => ({
        source_id: u.user_id,
        name: u.name || u.email,
        email: u.email,
        role: u.is_admin ? 'admin' : 'member',
        active: true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const directory = await fetchAndStoreDirectory(workspaceId, 'fireflies', normalized);
    const tracked = await getTrackedUsers(workspaceId, 'fireflies');

    res.json({
      users: directory.users,
      fetched_at: directory.fetched_at,
      tracked_users: tracked,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Fireflies Route] Get users error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/connectors/fireflies/users/refresh', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;

    // Get credentials from credential store
    const credentials = await getConnectorCredentials(workspaceId, 'fireflies');
    if (!credentials) {
      res.status(404).json({ error: 'Fireflies connection not found.' });
      return;
    }

    const client = new FirefliesClient(credentials.apiKey);
    const rawUsers = await client.getUsers();
    const normalized: NormalizedUser[] = rawUsers
      .map(u => ({
        source_id: u.user_id,
        name: u.name || u.email,
        email: u.email,
        role: u.is_admin ? 'admin' : 'member',
        active: true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const directory = await fetchAndStoreDirectory(workspaceId, 'fireflies', normalized);

    res.json({
      users: directory.users,
      fetched_at: directory.fetched_at,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Fireflies Route] Refresh users error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/connectors/fireflies/users/track', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;
    const { user_ids } = req.body as { user_ids?: string[] };

    if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
      res.status(400).json({ error: 'user_ids array is required' });
      return;
    }

    const tracked = await setTrackedUsers(workspaceId, 'fireflies', user_ids);
    res.json({ tracked_users: tracked });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Fireflies Route] Track users error:', message);
    res.status(400).json({ error: message });
  }
});

router.get('/:workspaceId/connectors/fireflies/users/track', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;
    const tracked = await getTrackedUsers(workspaceId, 'fireflies');
    res.json({ tracked_users: tracked, count: tracked.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

router.delete('/:workspaceId/connectors/fireflies/users/track', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;
    await clearTrackedUsers(workspaceId, 'fireflies');
    res.json({ success: true, message: 'All tracked users cleared' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/connectors/fireflies/transcript/:sourceId', async (req: Request<WorkspaceParams & { sourceId: string }>, res: Response) => {
  try {
    const { workspaceId, sourceId } = req.params;

    // Check connection status
    const connResult = await query<{ status: string }>(
      `SELECT status FROM connections
       WHERE workspace_id = $1 AND connector_name = 'fireflies'`,
      [workspaceId]
    );

    if (connResult.rows.length === 0) {
      res.status(404).json({ error: 'Fireflies connection not found. Connect first.' });
      return;
    }

    if (connResult.rows[0].status === 'disconnected') {
      res.status(400).json({ error: 'Fireflies connection is disconnected.' });
      return;
    }

    // Get credentials from credential store
    const credentials = await getConnectorCredentials(workspaceId, 'fireflies');
    if (!credentials) {
      res.status(404).json({ error: 'Fireflies credentials not found.' });
      return;
    }

    const client = new FirefliesClient(credentials.apiKey);
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
