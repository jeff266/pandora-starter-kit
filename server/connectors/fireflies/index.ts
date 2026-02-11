import { query } from '../../db.js';
import { FirefliesClient } from './client.js';
import { initialSync, incrementalSync } from './sync.js';
import { fetchAndStoreDirectory, type NormalizedUser } from '../shared/tracked-users.js';
import type {
  PandoraConnector,
  ConnectorCredentials,
  Connection,
  ConnectorHealth,
  SyncResult,
} from '../_interface.js';

export class FirefliesConnector implements PandoraConnector {
  readonly name = 'fireflies' as const;
  readonly category = 'conversations' as const;
  readonly authMethod = 'api_key' as const;

  async testConnection(credentials: ConnectorCredentials): Promise<{ success: boolean; error?: string; accountInfo?: any }> {
    if (!credentials.apiKey) {
      return { success: false, error: 'API key is required' };
    }

    const client = new FirefliesClient(credentials.apiKey);
    return client.testConnection();
  }

  async connect(credentials: ConnectorCredentials, workspaceId: string): Promise<Connection> {
    const testResult = await this.testConnection(credentials);
    if (!testResult.success) {
      throw new Error(`Connection test failed: ${testResult.error}`);
    }

    const existing = await query<{ id: string }>(
      `SELECT id FROM connections WHERE workspace_id = $1 AND connector_name = 'fireflies'`,
      [workspaceId]
    );

    let connectionId: string;

    if (existing.rows.length > 0) {
      connectionId = existing.rows[0].id;
      await query(
        `UPDATE connections SET
          credentials = $1,
          status = 'healthy',
          error_message = NULL,
          updated_at = NOW()
        WHERE id = $2`,
        [JSON.stringify(credentials), connectionId]
      );
    } else {
      const result = await query<{ id: string }>(
        `INSERT INTO connections (workspace_id, connector_name, auth_method, credentials, status, created_at, updated_at)
         VALUES ($1, 'fireflies', 'api_key', $2, 'healthy', NOW(), NOW())
         RETURNING id`,
        [workspaceId, JSON.stringify(credentials)]
      );
      connectionId = result.rows[0].id;
    }

    let userDirectory;
    try {
      const client = new FirefliesClient(credentials.apiKey!);
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
      userDirectory = await fetchAndStoreDirectory(workspaceId, 'fireflies', normalized);
      console.log(`[Fireflies] Fetched ${normalized.length} users for directory`);
    } catch (err: any) {
      console.warn(`[Fireflies] Failed to fetch user directory on connect: ${err.message}`);
    }

    return {
      id: connectionId,
      workspaceId,
      connectorName: 'fireflies',
      status: 'healthy',
      credentials,
      metadata: { ...testResult.accountInfo, user_directory: userDirectory },
    };
  }

  async disconnect(workspaceId: string): Promise<void> {
    await query(
      `UPDATE connections SET status = 'disconnected', updated_at = NOW()
       WHERE workspace_id = $1 AND connector_name = 'fireflies'`,
      [workspaceId]
    );
  }

  async initialSync(connection: Connection, workspaceId: string, options?: { lookbackDays?: number }): Promise<SyncResult> {
    const client = new FirefliesClient(connection.credentials.apiKey!);
    return initialSync(client, workspaceId, options);
  }

  async incrementalSync(connection: Connection, workspaceId: string, since: Date): Promise<SyncResult> {
    const client = new FirefliesClient(connection.credentials.apiKey!);
    return incrementalSync(client, workspaceId, since);
  }

  async health(workspaceId: string): Promise<ConnectorHealth> {
    const result = await query<{
      status: string;
      last_sync_at: Date | null;
      error_message: string | null;
      sync_cursor: any;
    }>(
      `SELECT status, last_sync_at, error_message, sync_cursor
       FROM connections
       WHERE workspace_id = $1 AND connector_name = 'fireflies'`,
      [workspaceId]
    );

    if (result.rows.length === 0) {
      return { status: 'disconnected' };
    }

    const conn = result.rows[0];
    const lastSyncRecords = conn.sync_cursor?.lastSyncRecords;

    return {
      status: conn.status as ConnectorHealth['status'],
      lastSync: conn.last_sync_at ?? undefined,
      recordsSynced: lastSyncRecords ?? undefined,
      errors: conn.error_message ? [{
        timestamp: new Date(),
        message: conn.error_message,
      }] : undefined,
    };
  }
}

export const firefliesConnector = new FirefliesConnector();
