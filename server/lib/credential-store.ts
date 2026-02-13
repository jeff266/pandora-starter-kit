/**
 * Credential Store Access Layer
 *
 * Centralized access to encrypted credentials.
 * This is the ONLY way the app should read/write credentials.
 * Direct database access to credentials is not recommended.
 */

import { encryptCredentials, decryptCredentials, isEncrypted } from './encryption.js';
import { query } from '../db.js';

// ============================================================================
// Connector Credentials
// ============================================================================

/**
 * Get connector credentials for a workspace
 * Returns decrypted credentials or null if not found
 */
export async function getConnectorCredentials(
  workspaceId: string,
  connectorName: string
): Promise<Record<string, any> | null> {
  const result = await query<{ credentials: any }>(
    `SELECT credentials FROM connections
     WHERE workspace_id = $1 AND connector_name = $2`,
    [workspaceId, connectorName]
  );

  if (result.rows.length === 0) return null;

  const raw = result.rows[0].credentials;

  // Handle string (encrypted) vs object (plaintext legacy) formats
  if (typeof raw === 'string' && isEncrypted(raw)) {
    return decryptCredentials(raw);
  }

  // Legacy plaintext JSONB — return as-is
  // (migration script will encrypt these over time)
  if (typeof raw === 'object' && raw !== null) {
    return raw;
  }

  return null;
}

/**
 * Set connector credentials for a workspace
 * Automatically encrypts before storage
 */
export async function setConnectorCredentials(
  workspaceId: string,
  connectorName: string,
  credentials: Record<string, any>
): Promise<void> {
  const encrypted = encryptCredentials(credentials);

  await query(
    `UPDATE connections
     SET credentials = $3, updated_at = NOW()
     WHERE workspace_id = $1 AND connector_name = $2`,
    [workspaceId, connectorName, JSON.stringify(encrypted)]
  );
}

/**
 * Create new connection with encrypted credentials
 */
export async function createConnection(
  workspaceId: string,
  connectorName: string,
  authMethod: string,
  credentials: Record<string, any>,
  metadata?: Record<string, any>
): Promise<string> {
  const encrypted = encryptCredentials(credentials);

  const result = await query<{ id: string }>(
    `INSERT INTO connections
      (workspace_id, connector_name, auth_method, credentials, metadata, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'healthy', NOW(), NOW())
     RETURNING id`,
    [workspaceId, connectorName, authMethod, JSON.stringify(encrypted), metadata ? JSON.stringify(metadata) : null]
  );

  return result.rows[0].id;
}

// ============================================================================
// Enrichment API Keys
// ============================================================================

/**
 * Get enrichment API keys for a workspace
 * Returns decrypted keys
 */
export async function getEnrichmentKeys(
  workspaceId: string
): Promise<{
  apollo_api_key: string | null;
  serper_api_key: string | null;
  linkedin_rapidapi_key: string | null;
}> {
  const result = await query<{ credentials: any }>(
    `SELECT credentials FROM connections
     WHERE workspace_id = $1 AND connector_name = 'enrichment_config'
     LIMIT 1`,
    [workspaceId]
  );

  if (result.rows.length === 0) {
    return {
      apollo_api_key: null,
      serper_api_key: null,
      linkedin_rapidapi_key: null,
    };
  }

  const raw = result.rows[0].credentials;

  if (typeof raw === 'string' && isEncrypted(raw)) {
    const decrypted = decryptCredentials(raw);
    return {
      apollo_api_key: decrypted.apollo_api_key || null,
      serper_api_key: decrypted.serper_api_key || null,
      linkedin_rapidapi_key: decrypted.linkedin_rapidapi_key || null,
    };
  }

  // Legacy plaintext or JSONB object
  if (typeof raw === 'object' && raw !== null) {
    return {
      apollo_api_key: raw.apollo_api_key || null,
      serper_api_key: raw.serper_api_key || null,
      linkedin_rapidapi_key: raw.linkedin_rapidapi_key || null,
    };
  }

  return {
    apollo_api_key: null,
    serper_api_key: null,
    linkedin_rapidapi_key: null,
  };
}

/**
 * Set enrichment API keys for a workspace
 * Merges with existing keys and encrypts before storage
 */
export async function setEnrichmentKeys(
  workspaceId: string,
  keys: {
    apollo_api_key?: string;
    serper_api_key?: string;
    linkedin_rapidapi_key?: string;
  }
): Promise<void> {
  // Merge with existing keys (don't overwrite unset fields)
  const existing = await getEnrichmentKeys(workspaceId);
  const merged = { ...existing, ...keys };

  // Remove nulls/undefined
  Object.keys(merged).forEach((k) => {
    if (merged[k as keyof typeof merged] === null || merged[k as keyof typeof merged] === undefined) {
      delete merged[k as keyof typeof merged];
    }
  });

  const encrypted = encryptCredentials(merged);

  await query(
    `INSERT INTO connections (workspace_id, connector_name, credentials, status, created_at, updated_at)
     VALUES ($1, 'enrichment_config', $2, 'healthy', NOW(), NOW())
     ON CONFLICT (workspace_id, connector_name)
     DO UPDATE SET credentials = $2, updated_at = NOW()`,
    [workspaceId, JSON.stringify(encrypted)]
  );
}

// ============================================================================
// Credential Refresh Helpers
// ============================================================================

/**
 * Update specific credential fields (e.g., refresh access token)
 * Reads existing credentials, updates specific fields, re-encrypts
 */
export async function updateCredentialFields(
  workspaceId: string,
  connectorName: string,
  updates: Record<string, any>
): Promise<void> {
  const existing = await getConnectorCredentials(workspaceId, connectorName);

  if (!existing) {
    throw new Error(`No credentials found for ${connectorName} in workspace ${workspaceId}`);
  }

  const updated = { ...existing, ...updates };
  await setConnectorCredentials(workspaceId, connectorName, updated);
}
