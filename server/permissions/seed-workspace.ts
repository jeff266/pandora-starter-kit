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
 * @param workspaceId - The workspace to seed
 * @param userId - The global user ID (users.id) who will be the workspace admin
 * @param plan - The plan tier (starter, growth, pro, enterprise)
 */
export async function seedNewWorkspace(
  workspaceId: string,
  userId: string,
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

    // 2. Get user details for workspace_members
    const userResult = await query(
      `SELECT email, name, avatar_url FROM users WHERE id = $1`,
      [userId]
    );
    if (userResult.rows.length === 0) {
      throw new Error(`User ${userId} not found`);
    }
    const user = userResult.rows[0];

    // 3. Create or update workspace_members record with admin role
    await query(
      `INSERT INTO workspace_members (
        workspace_id,
        user_id,
        display_name,
        email,
        avatar_url,
        role,
        is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (workspace_id, user_id)
      DO UPDATE SET
        role = EXCLUDED.role,
        is_active = EXCLUDED.is_active`,
      [workspaceId, userId, user.name, user.email, user.avatar_url, 'admin', true]
    );

    // 4. Insert workspace_flags rows
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
