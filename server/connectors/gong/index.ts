import { query } from '../../db.js';
import { GongClient } from './client.js';
import { initialSync, incrementalSync } from './sync.js';
import { fetchAndStoreDirectory, type NormalizedUser } from '../shared/tracked-users.js';
import type {
  PandoraConnector,
  ConnectorCredentials,
  Connection,
  ConnectorHealth,
  SyncResult,
} from '../_interface.js';

export class GongConnector implements PandoraConnector {
  readonly name = 'gong' as const;
  readonly category = 'conversations' as const;
  readonly authMethod = 'basic' as const;

  async testConnection(credentials: ConnectorCredentials): Promise<{ success: boolean; error?: string; accountInfo?: any }> {
    if (!credentials.apiKey) {
      return { success: false, error: 'API key is required (format: accessKey:accessKeySecret)' };
    }

    const client = new GongClient(credentials.apiKey);
    return client.testConnection();
  }

  async connect(credentials: ConnectorCredentials, workspaceId: string): Promise<Connection> {
    const testResult = await this.testConnection(credentials);
    if (!testResult.success) {
      throw new Error(`Connection test failed: ${testResult.error}`);
    }

    const existing = await query<{ id: string }>(
      `SELECT id FROM connections WHERE workspace_id = $1 AND connector_name = 'gong'`,
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
         VALUES ($1, 'gong', 'basic', $2, 'healthy', NOW(), NOW())
         RETURNING id`,
        [workspaceId, JSON.stringify(credentials)]
      );
      connectionId = result.rows[0].id;
    }

    let userDirectory;
    try {
      const client = new GongClient(credentials.apiKey!);
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
      userDirectory = await fetchAndStoreDirectory(workspaceId, 'gong', normalized);
      console.log(`[Gong] Fetched ${normalized.length} active users for directory`);
    } catch (err: any) {
      console.warn(`[Gong] Failed to fetch user directory on connect: ${err.message}`);
    }

    return {
      id: connectionId,
      workspaceId,
      connectorName: 'gong',
      status: 'healthy',
      credentials,
      metadata: { ...testResult.accountInfo, user_directory: userDirectory },
    };
  }

  async disconnect(workspaceId: string): Promise<void> {
    await query(
      `UPDATE connections SET status = 'disconnected', updated_at = NOW()
       WHERE workspace_id = $1 AND connector_name = 'gong'`,
      [workspaceId]
    );
  }

  async initialSync(connection: Connection, workspaceId: string, options?: { lookbackDays?: number }): Promise<SyncResult> {
    const client = new GongClient(connection.credentials.apiKey!);
    return initialSync(client, workspaceId, options);
  }

  async incrementalSync(connection: Connection, workspaceId: string, since: Date): Promise<SyncResult> {
    const client = new GongClient(connection.credentials.apiKey!);
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
       WHERE workspace_id = $1 AND connector_name = 'gong'`,
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

export const gongConnector = new GongConnector();
