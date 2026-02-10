import { query } from '../db.js';
import { getAdapterRegistry } from '../connectors/adapters/registry.js';
import { getCredentials, updateSyncStatus, updateSyncCursor } from '../connectors/adapters/credentials.js';
import { upsertTasks, upsertDocuments } from '../connectors/adapters/db-upsert.js';
import {
  isTaskAdapter,
  isDocumentAdapter,
  type BaseSourceAdapter,
  type SyncCapable,
  type NormalizedTask,
  type NormalizedDocument,
  type SyncResult,
} from '../connectors/adapters/types.js';

interface OrchestratorResult {
  connector: string;
  category: string;
  status: 'success' | 'skipped' | 'error';
  message?: string;
  counts?: Record<string, { transformed: number; failed: number; dbInserted: number; dbFailed: number }>;
}

export async function syncWorkspace(
  workspaceId: string,
  options?: { connectors?: string[]; mode?: 'initial' | 'incremental' }
): Promise<OrchestratorResult[]> {
  const registry = getAdapterRegistry();
  const results: OrchestratorResult[] = [];
  const sourceTypes = options?.connectors || registry.listSourceTypes();

  for (const sourceType of sourceTypes) {
    const adapter = registry.get(sourceType);
    if (!adapter) {
      results.push({
        connector: sourceType,
        category: 'unknown',
        status: 'skipped',
        message: `Adapter '${sourceType}' not found in registry`,
      });
      continue;
    }

    const conn = await getCredentials(workspaceId, sourceType);
    if (!conn || conn.status === 'disconnected') {
      results.push({
        connector: sourceType,
        category: adapter.category,
        status: 'skipped',
        message: conn ? 'Connection is disconnected' : 'No connection configured',
      });
      continue;
    }

    try {
      await updateSyncStatus(workspaceId, sourceType, 'syncing');

      const syncable = adapter as BaseSourceAdapter & SyncCapable;
      const mode = options?.mode || (conn.last_sync_at ? 'incremental' : 'initial');

      let syncResult;
      if (mode === 'incremental' && conn.last_sync_at) {
        syncResult = await syncable.incrementalSync(
          conn.credentials,
          workspaceId,
          new Date(conn.last_sync_at)
        );
      } else {
        syncResult = await syncable.initialSync(conn.credentials, workspaceId);
      }

      const counts: Record<string, { transformed: number; failed: number; dbInserted: number; dbFailed: number }> = {};

      if (isTaskAdapter(adapter) && syncResult.tasks) {
        const tasks = syncResult.tasks as SyncResult<NormalizedTask>;
        const dbResult = await upsertTasks(tasks.succeeded);
        counts.tasks = {
          transformed: tasks.succeeded.length,
          failed: tasks.failed.length,
          dbInserted: dbResult.inserted,
          dbFailed: dbResult.failed,
        };
      }

      if (isDocumentAdapter(adapter) && syncResult.documents) {
        const docs = syncResult.documents as SyncResult<NormalizedDocument>;
        const dbResult = await upsertDocuments(docs.succeeded);
        counts.documents = {
          transformed: docs.succeeded.length,
          failed: docs.failed.length,
          dbInserted: dbResult.inserted,
          dbFailed: dbResult.failed,
        };
      }

      await updateSyncStatus(workspaceId, sourceType, 'synced');
      await updateSyncCursor(workspaceId, sourceType, {
        lastSyncMode: mode,
        lastSyncAt: new Date().toISOString(),
      });

      results.push({
        connector: sourceType,
        category: adapter.category,
        status: 'success',
        counts,
      });

      console.log(`[Orchestrator] ${sourceType} sync complete:`, counts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Orchestrator] ${sourceType} sync failed:`, message);

      await updateSyncStatus(workspaceId, sourceType, 'error', message).catch(() => {});

      results.push({
        connector: sourceType,
        category: adapter.category,
        status: 'error',
        message,
      });
    }
  }

  return results;
}

export async function getWorkspaceSyncStatus(workspaceId: string): Promise<Array<{
  connector: string;
  status: string;
  lastSyncAt: Date | null;
  errorMessage: string | null;
}>> {
  const result = await query<{
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

  return result.rows.map((row) => ({
    connector: row.connector_name,
    status: row.status,
    lastSyncAt: row.last_sync_at,
    errorMessage: row.error_message,
  }));
}
