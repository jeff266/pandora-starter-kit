import { Router, type Request, type Response } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { query } from '../db.js';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { gongConnector } from '../connectors/gong/index.js';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { GongClient } from '../connectors/gong/client.js';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import type { Connection, ConnectorCredentials } from '../connectors/_interface.js';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { linkConversations } from '../linker/entity-linker.js';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { getConnectorCredentials } from '../lib/credential-store.js';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { classifyAndUpdateInternalStatus } from '../analysis/conversation-internal-filter.js';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { extractConversationSignals } from '../conversations/signal-extractor.js';
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
      user_directory: connection.metadata?.user_directory,
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

    // Get connection metadata (not credentials)
    const connResult = await query<{
      id: string;
      status: string;
      last_sync_at: Date | null;
    }>(
      `SELECT id, status, last_sync_at FROM connections
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

    // Get credentials from credential store
    const credentials = await getConnectorCredentials(workspaceId, 'gong');
    if (!credentials) {
      res.status(404).json({ error: 'Gong credentials not found.' });
      return;
    }

    const connection: Connection = {
      id: conn.id,
      workspaceId,
      connectorName: 'gong',
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
        result = await gongConnector.incrementalSync(connection, workspaceId, sinceDate);
        break;
      }
      case 'initial':
      default:
        result = await gongConnector.initialSync(connection, workspaceId, { lookbackDays: lookbackDays ? Number(lookbackDays) : undefined });
        break;
    }

    if (result.errors.length > 0 && result.errors[0]?.includes('No tracked users configured')) {
      res.status(400).json({
        error: 'No tracked users configured',
        action: `POST /api/workspaces/${workspaceId}/connectors/gong/users/track to select users`,
      });
      return;
    }

    res.json({
      success: result.errors.length === 0,
      mode,
      ...result,
    });

    linkConversations(workspaceId)
      .then(async (lr) => {
        const total = lr.linked.tier1_email + lr.linked.tier2_native + lr.linked.tier3_inferred;
        console.log(`[Linker] Gong post-sync: ${total} linked, ${lr.stillUnlinked} unlinked (${lr.durationMs}ms)`);

        classifyAndUpdateInternalStatus(workspaceId)
          .then(stats => console.log(`[InternalFilter] Gong post-sync: ${stats.classified} classified, ${stats.markedInternal} internal (${stats.durationMs}ms)`))
          .catch(err => console.error(`[InternalFilter] Gong post-sync failed:`, err.message));

        setTimeout(() => {
          extractConversationSignals(workspaceId)
            .then(sr => console.log(`[SignalExtractor] Gong post-sync: ${sr.extracted} extracted, ${sr.skipped} skipped (${sr.duration_ms}ms)`))
            .catch(err => console.error(`[SignalExtractor] Gong post-sync failed:`, err.message));
        }, 3000);
      })
      .catch(err => console.error(`[Linker] Gong post-sync failed:`, err.message));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Gong Route] Sync error:', message);
    res.status(500).json({ error: message });
  }
});

router.get('/:workspaceId/connectors/gong/users', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;

    const dir = await getDirectory(workspaceId, 'gong');

    if (dir) {
      const fetchedAt = new Date(dir.fetchedAt);
      const hoursAgo = (Date.now() - fetchedAt.getTime()) / (1000 * 60 * 60);

      if (hoursAgo < 24) {
        const tracked = await getTrackedUsers(workspaceId, 'gong');
        res.json({
          users: dir.users,
          fetched_at: dir.fetchedAt,
          tracked_users: tracked,
        });
        return;
      }
    }

    // Get credentials from credential store
    const credentials = await getConnectorCredentials(workspaceId, 'gong');
    if (!credentials) {
      res.status(404).json({ error: 'Gong connection not found. Connect first.' });
      return;
    }

    const client = new GongClient(credentials.apiKey);
    const rawUsers = await client.getAllUsers();
    const normalized: NormalizedUser[] = rawUsers
      .filter(u => u.active)
      .map(u => ({
        source_id: u.id,
        name: `${u.firstName} ${u.lastName}`.trim(),
        email: u.emailAddress,
        title: u.title,
        active: u.active,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const directory = await fetchAndStoreDirectory(workspaceId, 'gong', normalized);
    const tracked = await getTrackedUsers(workspaceId, 'gong');

    res.json({
      users: directory.users,
      fetched_at: directory.fetched_at,
      tracked_users: tracked,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Gong Route] Get users error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/connectors/gong/users/refresh', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;

    // Get credentials from credential store
    const credentials = await getConnectorCredentials(workspaceId, 'gong');
    if (!credentials) {
      res.status(404).json({ error: 'Gong connection not found.' });
      return;
    }

    const client = new GongClient(credentials.apiKey);
    const rawUsers = await client.getAllUsers();
    const normalized: NormalizedUser[] = rawUsers
      .filter(u => u.active)
      .map(u => ({
        source_id: u.id,
        name: `${u.firstName} ${u.lastName}`.trim(),
        email: u.emailAddress,
        title: u.title,
        active: u.active,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const directory = await fetchAndStoreDirectory(workspaceId, 'gong', normalized);

    res.json({
      users: directory.users,
      fetched_at: directory.fetched_at,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Gong Route] Refresh users error:', message);
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/connectors/gong/users/track', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;
    const { user_ids } = req.body as { user_ids?: string[] };

    if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
      res.status(400).json({ error: 'user_ids array is required' });
      return;
    }

    const tracked = await setTrackedUsers(workspaceId, 'gong', user_ids);
    res.json({ tracked_users: tracked });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Gong Route] Track users error:', message);
    res.status(400).json({ error: message });
  }
});

router.get('/:workspaceId/connectors/gong/users/track', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;
    const tracked = await getTrackedUsers(workspaceId, 'gong');
    res.json({ tracked_users: tracked, count: tracked.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

router.delete('/:workspaceId/connectors/gong/users/track', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;
    await clearTrackedUsers(workspaceId, 'gong');
    res.json({ success: true, message: 'All tracked users cleared' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

router.post('/:workspaceId/connectors/gong/transcript/:sourceId', async (req: Request<WorkspaceParams & { sourceId: string }>, res: Response) => {
  try {
    const { workspaceId, sourceId } = req.params;

    // Check connection status
    const connResult = await query<{ status: string }>(
      `SELECT status FROM connections
       WHERE workspace_id = $1 AND connector_name = 'gong'`,
      [workspaceId]
    );

    if (connResult.rows.length === 0) {
      res.status(404).json({ error: 'Gong connection not found. Connect first.' });
      return;
    }

    if (connResult.rows[0].status === 'disconnected') {
      res.status(400).json({ error: 'Gong connection is disconnected.' });
      return;
    }

    // Get credentials from credential store
    const credentials = await getConnectorCredentials(workspaceId, 'gong');
    if (!credentials) {
      res.status(404).json({ error: 'Gong credentials not found.' });
      return;
    }

    const client = new GongClient(credentials.apiKey);
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

router.post('/:workspaceId/connectors/gong/backfill-transcripts', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;
    const limit = Math.min(typeof req.body.limit === 'number' ? req.body.limit : 20, 100);

    const connResult = await query<{ status: string }>(
      `SELECT status FROM connections WHERE workspace_id = $1 AND connector_name = 'gong'`,
      [workspaceId]
    );
    if (connResult.rows.length === 0) {
      res.status(404).json({ error: 'Gong connection not found.' });
      return;
    }
    if (connResult.rows[0].status === 'disconnected') {
      res.status(400).json({ error: 'Gong connection is disconnected.' });
      return;
    }

    const credentials = await getConnectorCredentials(workspaceId, 'gong');
    if (!credentials) {
      res.status(404).json({ error: 'Gong credentials not found.' });
      return;
    }

    // Pull stored calls that need transcripts — parties already in source_data
    const pending = await query<{ source_id: string; source_data: any }>(
      `SELECT source_id, source_data
       FROM conversations
       WHERE workspace_id = $1
         AND source = 'gong'
         AND transcript_text IS NULL
       ORDER BY call_date DESC NULLS LAST
       LIMIT $2`,
      [workspaceId, limit]
    );

    if (pending.rows.length === 0) {
      res.json({ processed: 0, updated: 0, errors: [], message: 'No calls pending transcript backfill.' });
      return;
    }

    const client = new GongClient(credentials.apiKey);
    const callIds = pending.rows.map(r => r.source_id);
    const partyMap = new Map<string, any[]>(
      pending.rows.map(r => [r.source_id, r.source_data?.parties || []])
    );

    // Fetch transcripts in one batch (Gong accepts up to 100)
    const transcripts = await client.getTranscripts(callIds);

    let updated = 0;
    const errors: string[] = [];

    for (const transcript of transcripts) {
      try {
        const parties = partyMap.get(transcript.callId) || [];
        const text = client.formatTranscriptAsText(transcript, parties);
        if (!text) continue;

        await query(
          `UPDATE conversations SET transcript_text = $1, updated_at = NOW()
           WHERE workspace_id = $2 AND source = 'gong' AND source_id = $3
             AND transcript_text IS NULL`,
          [text, workspaceId, transcript.callId]
        );
        updated++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${transcript.callId}: ${msg}`);
      }
    }

    const noTranscript = callIds.length - transcripts.length;

    console.log(`[Gong Backfill] ${workspaceId}: ${updated} transcripts stored, ${noTranscript} calls had no transcript, ${errors.length} errors`);

    res.json({
      processed: pending.rows.length,
      updated,
      no_transcript_available: noTranscript,
      errors,
    });

    // Fire signal extraction for calls that now have transcripts
    if (updated > 0) {
      setTimeout(() => {
        extractConversationSignals(workspaceId, { limit: updated + 5 })
          .then(sr => console.log(`[SignalExtractor] Post-backfill: ${sr.extracted} extracted`))
          .catch(() => {});
      }, 2000);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Gong Route] Backfill error:', message);
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
