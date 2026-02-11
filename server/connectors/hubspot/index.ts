import { query } from '../../db.js';
import { HubSpotClient } from './client.js';
import { initialSync, incrementalSync, backfillAssociations } from './sync.js';
import { discoverSchema as runSchemaDiscovery, discoverPipelines, storeSchemaMetadata } from './schema-discovery.js';
import type {
  PandoraConnector,
  ConnectorCredentials,
  Connection,
  ConnectorHealth,
  SourceSchema,
  SyncResult,
} from '../_interface.js';

export class HubSpotConnector implements PandoraConnector {
  readonly name = 'hubspot' as const;
  readonly category = 'crm' as const;
  readonly authMethod = 'oauth' as const;

  async testConnection(credentials: ConnectorCredentials): Promise<{ success: boolean; error?: string; accountInfo?: any }> {
    if (!credentials.accessToken) {
      return { success: false, error: 'Access token is required' };
    }

    const client = new HubSpotClient(credentials.accessToken);
    return client.testConnection();
  }

  async connect(credentials: ConnectorCredentials, workspaceId: string): Promise<Connection> {
    const testResult = await this.testConnection(credentials);
    if (!testResult.success) {
      throw new Error(`Connection test failed: ${testResult.error}`);
    }

    const existing = await query<{ id: string }>(
      `SELECT id FROM connections WHERE workspace_id = $1 AND connector_name = 'hubspot'`,
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
        WHERE id = $2 AND workspace_id = $3`,
        [JSON.stringify(credentials), connectionId, workspaceId]
      );
    } else {
      const result = await query<{ id: string }>(
        `INSERT INTO connections (workspace_id, connector_name, auth_method, credentials, status, created_at, updated_at)
         VALUES ($1, 'hubspot', 'oauth', $2, 'healthy', NOW(), NOW())
         RETURNING id`,
        [workspaceId, JSON.stringify(credentials)]
      );
      connectionId = result.rows[0].id;
    }

    return {
      id: connectionId,
      workspaceId,
      connectorName: 'hubspot',
      status: 'healthy',
      credentials,
      metadata: testResult.accountInfo,
    };
  }

  async disconnect(workspaceId: string): Promise<void> {
    await query(
      `UPDATE connections SET status = 'disconnected', updated_at = NOW()
       WHERE workspace_id = $1 AND connector_name = 'hubspot'`,
      [workspaceId]
    );
  }

  async discoverSchema(connection: Connection): Promise<SourceSchema> {
    const client = new HubSpotClient(connection.credentials.accessToken!);
    const schema = await runSchemaDiscovery(client);
    const pipelines = await discoverPipelines(client);
    await storeSchemaMetadata(connection.workspaceId, schema, pipelines);
    return schema;
  }

  async initialSync(connection: Connection, workspaceId: string): Promise<SyncResult> {
    const client = new HubSpotClient(connection.credentials.accessToken!);
    return initialSync(client, workspaceId);
  }

  async incrementalSync(connection: Connection, workspaceId: string, since: Date): Promise<SyncResult> {
    const client = new HubSpotClient(connection.credentials.accessToken!);
    return incrementalSync(client, workspaceId, since);
  }

  async backfillSync(connection: Connection, workspaceId: string): Promise<SyncResult> {
    const client = new HubSpotClient(connection.credentials.accessToken!);
    return backfillAssociations(client, workspaceId);
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
       WHERE workspace_id = $1 AND connector_name = 'hubspot'`,
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

export const hubspotConnector = new HubSpotConnector();
