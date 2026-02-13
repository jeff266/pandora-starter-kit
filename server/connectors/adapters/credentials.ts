import { query } from '../../db.js';
import { getConnectorCredentials, setConnectorCredentials } from '../../lib/credential-store.js';

type ConnectorHook = (workspaceId: string, connectorName: string, credentials: Record<string, any>) => Promise<void>;
type DisconnectHook = (workspaceId: string, connectorName: string) => Promise<void>;

let _onConnectedHook: ConnectorHook | null = null;
let _onDisconnectedHook: DisconnectHook | null = null;

export function setOnConnectorConnectedHook(hook: ConnectorHook) {
  _onConnectedHook = hook;
}

export function setOnConnectorDisconnectedHook(hook: DisconnectHook) {
  _onDisconnectedHook = hook;
}

export interface StoredConnection {
  id: string;
  workspace_id: string;
  connector_name: string;
  auth_method: string;
  credentials: Record<string, any>;
  status: string;
  last_sync_at: Date | null;
  sync_cursor: Record<string, any> | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function getCredentials(
  workspaceId: string,
  connectorName: string
): Promise<StoredConnection | null> {
  const result = await query<Omit<StoredConnection, 'credentials'>>(
    `SELECT id, workspace_id, connector_name, auth_method, status, last_sync_at, sync_cursor, error_message, created_at, updated_at
     FROM connections
     WHERE workspace_id = $1 AND connector_name = $2`,
    [workspaceId, connectorName]
  );
  const row = result.rows[0];
  if (!row) return null;

  // Get decrypted credentials from credential store
  const credentials = await getConnectorCredentials(workspaceId, connectorName);
  if (!credentials) return null;

  return {
    ...row,
    credentials,
  };
}

export async function storeCredentials(
  workspaceId: string,
  connectorName: string,
  authMethod: string,
  credentials: Record<string, any>
): Promise<StoredConnection> {
  // Store credentials using credential store (handles encryption)
  await setConnectorCredentials(workspaceId, connectorName, credentials);

  // Update connection metadata
  const result = await query<Omit<StoredConnection, 'credentials'>>(
    `INSERT INTO connections (id, workspace_id, connector_name, auth_method, status, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, 'connected', NOW(), NOW())
     ON CONFLICT (workspace_id, connector_name)
     DO UPDATE SET
       auth_method = $3,
       status = 'connected',
       error_message = NULL,
       updated_at = NOW()
     RETURNING id, workspace_id, connector_name, auth_method, status, last_sync_at, sync_cursor, error_message, created_at, updated_at`,
    [workspaceId, connectorName, authMethod]
  );

  const row = {
    ...result.rows[0],
    credentials,
  };

  if (_onConnectedHook) {
    _onConnectedHook(workspaceId, connectorName, credentials).catch((err) => {
      console.error('[credentials] onConnectedHook failed (non-fatal):', err instanceof Error ? err.message : err);
    });
  }

  return row;
}

export async function updateSyncStatus(
  workspaceId: string,
  connectorName: string,
  status: string,
  lastError?: string
): Promise<void> {
  await query(
    `UPDATE connections SET
       status = $3,
       last_sync_at = CASE WHEN $3 = 'synced' THEN NOW() ELSE last_sync_at END,
       error_message = $4,
       updated_at = NOW()
     WHERE workspace_id = $1 AND connector_name = $2`,
    [workspaceId, connectorName, status, lastError || null]
  );
}

export async function updateSyncCursor(
  workspaceId: string,
  connectorName: string,
  syncCursor: Record<string, any>
): Promise<void> {
  await query(
    `UPDATE connections SET
       sync_cursor = $3,
       updated_at = NOW()
     WHERE workspace_id = $1 AND connector_name = $2`,
    [workspaceId, connectorName, JSON.stringify(syncCursor)]
  );
}
