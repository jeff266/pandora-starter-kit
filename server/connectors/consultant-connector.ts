/**
 * Consultant Connector Service
 *
 * CRUD operations for user-scoped consultant connectors.
 * Unlike workspace connectors (in the `connections` table), these are tied to
 * a user and used to sync call data across multiple workspaces.
 */

import { query } from '../db.js';

export interface ConsultantConnector {
  id: string;
  user_id: string;
  source: string;
  status: string;
  credentials: Record<string, any>;
  last_synced_at: string | null;
  sync_config: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export async function createConsultantConnector(
  userId: string,
  source: string,
  credentials: Record<string, any>,
  syncConfig: Record<string, any> = {}
): Promise<ConsultantConnector> {
  const result = await query<ConsultantConnector>(
    `INSERT INTO consultant_connectors (user_id, source, credentials, sync_config)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, source) DO UPDATE SET
       credentials = EXCLUDED.credentials,
       status = 'connected',
       sync_config = EXCLUDED.sync_config,
       updated_at = NOW()
     RETURNING *`,
    [userId, source, JSON.stringify(credentials), JSON.stringify(syncConfig)]
  );
  return result.rows[0];
}

export async function getConsultantConnectors(userId: string): Promise<ConsultantConnector[]> {
  const result = await query<ConsultantConnector>(
    `SELECT * FROM consultant_connectors WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

export async function getConsultantConnector(connectorId: string): Promise<ConsultantConnector | null> {
  const result = await query<ConsultantConnector>(
    `SELECT * FROM consultant_connectors WHERE id = $1`,
    [connectorId]
  );
  return result.rows[0] || null;
}

export async function updateConsultantConnector(
  connectorId: string,
  updates: Partial<Pick<ConsultantConnector, 'status' | 'credentials' | 'last_synced_at' | 'sync_config'>>
): Promise<ConsultantConnector | null> {
  const setClauses: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (updates.status !== undefined) {
    setClauses.push(`status = $${paramIndex++}`);
    params.push(updates.status);
  }
  if (updates.credentials !== undefined) {
    setClauses.push(`credentials = $${paramIndex++}`);
    params.push(JSON.stringify(updates.credentials));
  }
  if (updates.last_synced_at !== undefined) {
    setClauses.push(`last_synced_at = $${paramIndex++}`);
    params.push(updates.last_synced_at);
  }
  if (updates.sync_config !== undefined) {
    setClauses.push(`sync_config = $${paramIndex++}`);
    params.push(JSON.stringify(updates.sync_config));
  }

  params.push(connectorId);

  const result = await query<ConsultantConnector>(
    `UPDATE consultant_connectors SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    params
  );
  return result.rows[0] || null;
}

export async function deleteConsultantConnector(connectorId: string): Promise<void> {
  await query(`DELETE FROM consultant_connectors WHERE id = $1`, [connectorId]);
}

export async function getActiveConsultantConnectors(): Promise<ConsultantConnector[]> {
  const result = await query<ConsultantConnector>(
    `SELECT * FROM consultant_connectors WHERE status = 'connected' ORDER BY last_synced_at ASC NULLS FIRST`,
  );
  return result.rows;
}

export async function getWorkspacesForUser(userId: string): Promise<Array<{ id: string; name: string }>> {
  const result = await query<{ id: string; name: string }>(
    `SELECT w.id, w.name
     FROM user_workspaces uw
     JOIN workspaces w ON w.id = uw.workspace_id
     WHERE uw.user_id = $1`,
    [userId]
  );
  return result.rows;
}

export async function getUserEmail(userId: string): Promise<string | null> {
  const result = await query<{ email: string }>(
    `SELECT email FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0]?.email || null;
}
