/**
 * Backfill workspace_members for users who exist in user_workspaces
 * but have no corresponding workspace_members row.
 *
 * This bridges the old auth system (user_workspaces) with the newer
 * RBAC system (workspace_members + workspace_roles). Runs at startup
 * so existing workspaces are never locked out of RBAC-gated routes.
 *
 * Also seeds workspace_roles for any workspace that has users in
 * user_workspaces but no workspace_roles yet (e.g., the demo workspace).
 */

import { query } from '../db.js';
import { SYSTEM_ROLE_PERMISSIONS } from '../permissions/system-roles.js';

const ROLE_META: Record<string, { name: string; description: string }> = {
  admin:  { name: 'Admin',  description: 'Full access to all workspace settings, connectors, members, and billing.' },
  member: { name: 'Member', description: 'Standard workspace access' },
  viewer: { name: 'Viewer', description: 'Read-only access to dashboards and reports.' },
};

async function ensureWorkspaceRoles(workspaceId: string): Promise<string | null> {
  const existing = await query<{ id: string }>(
    `SELECT id FROM workspace_roles WHERE workspace_id = $1 AND system_type = 'admin' LIMIT 1`,
    [workspaceId]
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const systemTypes = ['admin', 'member', 'viewer'] as const;
  let adminRoleId: string | null = null;

  for (const systemType of systemTypes) {
    const permissions = (SYSTEM_ROLE_PERMISSIONS as any)[systemType] ?? {};
    const meta = ROLE_META[systemType];
    const result = await query<{ id: string }>(
      `INSERT INTO workspace_roles (workspace_id, name, description, is_system, system_type, permissions)
       VALUES ($1, $2, $3, true, $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [workspaceId, meta.name, meta.description, systemType, JSON.stringify(permissions)]
    );
    if (systemType === 'admin' && result.rows.length > 0) {
      adminRoleId = result.rows[0].id;
    }
  }

  if (!adminRoleId) {
    const re = await query<{ id: string }>(
      `SELECT id FROM workspace_roles WHERE workspace_id = $1 AND system_type = 'admin' LIMIT 1`,
      [workspaceId]
    );
    adminRoleId = re.rows[0]?.id ?? null;
  }

  return adminRoleId;
}

export async function backfillWorkspaceMembers(): Promise<void> {
  try {
    const missing = await query<{ user_id: string; workspace_id: string }>(
      `SELECT uw.user_id, uw.workspace_id
       FROM user_workspaces uw
       WHERE NOT EXISTS (
         SELECT 1 FROM workspace_members wm
         WHERE wm.user_id = uw.user_id AND wm.workspace_id = uw.workspace_id
       )`
    );

    if (missing.rows.length === 0) return;

    let backfilled = 0;
    for (const row of missing.rows) {
      const adminRoleId = await ensureWorkspaceRoles(row.workspace_id);
      if (!adminRoleId) continue;

      await query(
        `INSERT INTO workspace_members (workspace_id, user_id, role_id, status, pandora_role, accepted_at)
         VALUES ($1, $2, $3, 'active', 'admin', now())
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [row.workspace_id, row.user_id, adminRoleId]
      );
      backfilled++;
    }

    if (backfilled > 0) {
      console.log(`[WorkspaceMembers] Backfilled ${backfilled} missing workspace_members row(s)`);
    }
  } catch (err) {
    console.warn('[WorkspaceMembers] Backfill failed (non-fatal):', err instanceof Error ? err.message : err);
  }
}
