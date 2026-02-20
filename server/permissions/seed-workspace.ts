/**
 * Workspace Seeding
 * Seeds new workspaces with system roles, creator membership, and feature flags
 */

import { query } from '../db.js';
import { SYSTEM_ROLE_PERMISSIONS } from './system-roles.js';
import { getFlagsForPlan } from './feature-flags.js';

interface SeedResult {
  roles: {
    admin: string;
    manager: string;
    analyst: string;
    viewer: string;
  };
  memberCreated: boolean;
  flagsSeeded: number;
}

/**
 * Seed a new workspace with system roles, creator membership, and feature flags
 * Runs in a single transaction
 */
export async function seedNewWorkspace(
  workspaceId: string,
  creatorId: string,
  plan: string
): Promise<SeedResult> {
  const client = await query('BEGIN');

  try {
    // 1. Insert four workspace_roles rows
    const roleIds: Record<string, string> = {};
    const systemTypes = ['admin', 'manager', 'analyst', 'viewer'] as const;

    for (const systemType of systemTypes) {
      const permissions = SYSTEM_ROLE_PERMISSIONS[systemType];
      const result = await query(
        `INSERT INTO workspace_roles (
          workspace_id,
          name,
          description,
          is_system,
          system_type,
          permissions
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id`,
        [
          workspaceId,
          systemType.charAt(0).toUpperCase() + systemType.slice(1), // Capitalize first letter
          `System ${systemType} role`,
          true,
          systemType,
          JSON.stringify(permissions),
        ]
      );
      roleIds[systemType] = result.rows[0].id;
    }

    // 2. Update creator's role in workspace_users table
    // Note: Using workspace_users table (existing schema) instead of workspace_members
    await query(
      `UPDATE workspace_users
       SET role = $1
       WHERE id = $2 AND workspace_id = $3`,
      ['admin', creatorId, workspaceId]
    );

    // 3. Insert workspace_flags rows
    const flags = getFlagsForPlan(plan);
    for (const flag of flags) {
      await query(
        `INSERT INTO workspace_flags (
          workspace_id,
          key,
          value,
          flag_type,
          set_by
        ) VALUES ($1, $2, $3, $4, $5)`,
        [workspaceId, flag.key, JSON.stringify(flag.value), flag.flag_type, 'system']
      );
    }

    await query('COMMIT');

    return {
      roles: {
        admin: roleIds.admin,
        manager: roleIds.manager,
        analyst: roleIds.analyst,
        viewer: roleIds.viewer,
      },
      memberCreated: true,
      flagsSeeded: flags.length,
    };
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }
}
