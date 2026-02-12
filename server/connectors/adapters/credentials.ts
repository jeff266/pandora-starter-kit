import { query } from '../../db.js';
import { encryptCredentials, decryptCredentials, isEncrypted } from '../../lib/encryption.js';

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
  const result = await query<StoredConnection>(
    `SELECT * FROM connections
     WHERE workspace_id = $1 AND connector_name = $2`,
    [workspaceId, connectorName]
  );
  const row = result.rows[0];
  if (!row) return null;

  // Decrypt credentials if encrypted (backward compatible)
  if (row.credentials && isEncrypted(row.credentials)) {
    row.credentials = decryptCredentials(row.credentials as any);
  }

  return row;
}

export async function storeCredentials(
  workspaceId: string,
  connectorName: string,
  authMethod: string,
  credentials: Record<string, any>
): Promise<StoredConnection> {
  // Encrypt credentials before storing
  const encrypted = encryptCredentials(credentials);

  const result = await query<StoredConnection>(
    `INSERT INTO connections (id, workspace_id, connector_name, auth_method, credentials, status, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 'connected', NOW(), NOW())
     ON CONFLICT (workspace_id, connector_name)
     DO UPDATE SET
       credentials = $4,
       auth_method = $3,
       status = 'connected',
       error_message = NULL,
       updated_at = NOW()
     RETURNING *`,
    [workspaceId, connectorName, authMethod, JSON.stringify(encrypted)]
  );

  // Decrypt for return value (callers expect plain object)
  const row = result.rows[0];
  if (row.credentials && isEncrypted(row.credentials)) {
    row.credentials = decryptCredentials(row.credentials as any);
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
