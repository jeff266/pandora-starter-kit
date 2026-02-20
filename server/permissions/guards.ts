/**
 * Permission Guards
 *
 * Shared validation functions that enforce business rules across the API.
 */

import { query } from '../db.js';

/**
 * Ensures that a workspace will not be left without any Admin members after
 * removing, demoting, or suspending a user.
 *
 * @param workspaceId - The workspace to check
 * @param affectedUserId - The user being removed/demoted/suspended
 * @throws Error if this action would leave the workspace with zero Admins
 */
export async function ensureNotLastAdmin(
  workspaceId: string,
  affectedUserId: string
): Promise<void> {
  // Count active Admin members excluding the affected user
  const result = await query<{ count: string }>(`
    SELECT COUNT(*) as count
    FROM workspace_members wm
    JOIN workspace_roles wr ON wr.id = wm.role_id
    WHERE wm.workspace_id = $1
      AND wm.status = 'active'
      AND wr.system_type = 'admin'
      AND wm.user_id != $2
  `, [workspaceId, affectedUserId]);

  const remainingAdmins = parseInt(result.rows[0]?.count || '0', 10);

  if (remainingAdmins === 0) {
    throw new Error('Cannot remove, suspend, or demote the last Admin. Workspace must have at least one active Admin member.');
  }
}

/**
 * Checks if a role is an Admin role
 *
 * @param roleId - The role ID to check
 * @returns True if the role is an Admin role
 */
export async function isAdminRole(roleId: string): Promise<boolean> {
  const result = await query<{ system_type: string }>(`
    SELECT system_type
    FROM workspace_roles
    WHERE id = $1
  `, [roleId]);

  return result.rows[0]?.system_type === 'admin';
}

/**
 * Validates that a role exists in the specified workspace
 *
 * @param roleId - The role ID to validate
 * @param workspaceId - The workspace to check
 * @throws Error if the role doesn't exist or doesn't belong to the workspace
 */
export async function validateRoleInWorkspace(
  roleId: string,
  workspaceId: string
): Promise<void> {
  const result = await query<{ id: string }>(`
    SELECT id
    FROM workspace_roles
    WHERE id = $1 AND workspace_id = $2
  `, [roleId, workspaceId]);

  if (result.rows.length === 0) {
    throw new Error('Role not found in this workspace');
  }
}
