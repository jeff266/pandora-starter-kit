/**
 * Custom Roles Management API
 *
 * Handles workspace role creation, editing, and deletion.
 * System roles (is_system = true) are read-only.
 * All routes mounted at /api/workspaces/:workspaceId/roles
 */

import { Router, Request, Response } from 'express';
import { requirePermission, requireFeature } from '../middleware/permissions.js';
import { query } from '../db.js';
import { PermissionSet, createPermissionSet } from '../permissions/types.js';
import { validateRoleInWorkspace } from '../permissions/guards.js';

const router = Router();

// Reserved role names that cannot be used for custom roles
const RESERVED_ROLE_NAMES = ['admin', 'manager', 'analyst', 'viewer'];

/**
 * Validate permission set structure
 * Ensures all required permission keys are present and all values are boolean
 */
function isValidPermissionSet(permissions: any): permissions is PermissionSet {
  if (!permissions || typeof permissions !== 'object') {
    return false;
  }

  const template = createPermissionSet(false);
  const requiredKeys = Object.keys(template);

  // Check that all required keys are present
  for (const key of requiredKeys) {
    if (!(key in permissions)) {
      return false;
    }
    if (typeof permissions[key] !== 'boolean') {
      return false;
    }
  }

  // Check that there are no extra keys
  const providedKeys = Object.keys(permissions);
  for (const key of providedKeys) {
    if (!(key in template)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if caller is trying to grant permissions they don't hold
 * Prevents privilege escalation
 */
function hasPrivilegeEscalation(
  callerPermissions: PermissionSet,
  requestedPermissions: PermissionSet
): { escalation: boolean; deniedPermissions: string[] } {
  const deniedPermissions: string[] = [];

  for (const [key, value] of Object.entries(requestedPermissions)) {
    if (value === true && callerPermissions[key as keyof PermissionSet] !== true) {
      deniedPermissions.push(key);
    }
  }

  return {
    escalation: deniedPermissions.length > 0,
    deniedPermissions,
  };
}

/**
 * GET /
 * List all roles for workspace
 */
router.get('/', requirePermission('members.view'), async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;

    const rolesResult = await query<{
      id: string;
      name: string;
      description: string | null;
      is_system: boolean;
      system_type: string | null;
      permissions: PermissionSet;
      member_count: string;
    }>(`
      SELECT
        wr.id,
        wr.name,
        wr.description,
        wr.is_system,
        wr.system_type,
        wr.permissions,
        COUNT(wm.id)::text as member_count
      FROM workspace_roles wr
      LEFT JOIN workspace_members wm
        ON wm.role_id = wr.id AND wm.status = 'active'
      WHERE wr.workspace_id = $1
      GROUP BY wr.id
      ORDER BY
        wr.is_system DESC,
        wr.name ASC
    `, [workspaceId]);

    const roles = rolesResult.rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      is_system: r.is_system,
      system_type: r.system_type,
      permissions: r.permissions,
      member_count: parseInt(r.member_count) || 0,
    }));

    res.json({ roles });
  } catch (err) {
    console.error('[roles] Error listing roles:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to list roles' });
  }
});

/**
 * GET /:roleId
 * Get single role with full details and member list
 */
router.get('/:roleId', requirePermission('members.view'), async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const roleId = req.params.roleId as string;

    // Get role details
    const roleResult = await query<{
      id: string;
      name: string;
      description: string | null;
      is_system: boolean;
      system_type: string | null;
      permissions: PermissionSet;
    }>(`
      SELECT
        id,
        name,
        description,
        is_system,
        system_type,
        permissions
      FROM workspace_roles
      WHERE id = $1 AND workspace_id = $2
    `, [roleId, workspaceId]);

    if (roleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }

    const role = roleResult.rows[0];

    // Get members holding this role
    const membersResult = await query<{
      id: string;
      user_id: string;
      name: string;
      email: string;
    }>(`
      SELECT
        wm.id,
        wm.user_id,
        u.name,
        u.email
      FROM workspace_members wm
      JOIN users u ON u.id = wm.user_id
      WHERE wm.role_id = $1
        AND wm.workspace_id = $2
        AND wm.status = 'active'
      ORDER BY u.name
    `, [roleId, workspaceId]);

    res.json({
      ...role,
      members: membersResult.rows.map(m => ({
        id: m.id,
        user_id: m.user_id,
        name: m.name,
        email: m.email,
      })),
    });
  } catch (err) {
    console.error('[roles] Error getting role:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to get role' });
  }
});

/**
 * POST /
 * Create custom role
 */
router.post('/', requireFeature('feature.custom_roles'), requirePermission('members.change_roles'), async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const { name, description, permissions } = req.body;

    // Validation: name is required
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Valid name is required' });
    }

    const normalizedName = name.trim();

    if (normalizedName.length === 0) {
      return res.status(400).json({ error: 'Name cannot be empty' });
    }

    // Validation: name cannot be reserved
    if (RESERVED_ROLE_NAMES.some(r => r.toLowerCase() === normalizedName.toLowerCase())) {
      return res.status(400).json({
        error: 'Role name is reserved',
        reserved_names: RESERVED_ROLE_NAMES,
      });
    }

    // Validation: name must be unique (case-insensitive)
    const existingRole = await query<{ id: string }>(`
      SELECT id
      FROM workspace_roles
      WHERE workspace_id = $1 AND LOWER(name) = LOWER($2)
    `, [workspaceId, normalizedName]);

    if (existingRole.rows.length > 0) {
      return res.status(409).json({ error: 'Role name already exists in this workspace' });
    }

    // Validation: permissions must be valid PermissionSet
    if (!permissions || !isValidPermissionSet(permissions)) {
      return res.status(400).json({
        error: 'Invalid permissions object',
        required: 'All permission keys must be present and all values must be boolean',
      });
    }

    // Validation: check privilege escalation
    if (!req.userPermissions) {
      return res.status(403).json({ error: 'Cannot determine caller permissions' });
    }

    const escalation = hasPrivilegeEscalation(req.userPermissions, permissions);
    if (escalation.escalation) {
      return res.status(403).json({
        error: 'Cannot grant permissions you do not hold',
        denied_permissions: escalation.deniedPermissions,
      });
    }

    // Create custom role
    const roleResult = await query<{ id: string }>(`
      INSERT INTO workspace_roles (
        workspace_id,
        name,
        description,
        is_system,
        permissions
      ) VALUES ($1, $2, $3, false, $4)
      RETURNING id
    `, [workspaceId, normalizedName, description || null, JSON.stringify(permissions)]);

    const roleId = roleResult.rows[0].id;

    res.status(201).json({
      id: roleId,
      name: normalizedName,
      description: description || null,
      is_system: false,
      permissions,
    });
  } catch (err) {
    console.error('[roles] Error creating role:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to create role' });
  }
});

/**
 * PATCH /:roleId
 * Update custom role
 */
router.patch('/:roleId', requireFeature('feature.custom_roles'), requirePermission('members.change_roles'), async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const roleId = req.params.roleId as string;
    const { name, description, permissions } = req.body;

    // Get current role
    const roleResult = await query<{
      id: string;
      name: string;
      description: string | null;
      is_system: boolean;
      permissions: PermissionSet;
    }>(`
      SELECT id, name, description, is_system, permissions
      FROM workspace_roles
      WHERE id = $1 AND workspace_id = $2
    `, [roleId, workspaceId]);

    if (roleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }

    const currentRole = roleResult.rows[0];

    // GUARD: Cannot edit system roles
    if (currentRole.is_system) {
      return res.status(403).json({ error: 'Cannot edit system roles' });
    }

    let updatedName = currentRole.name;
    let updatedDescription = currentRole.description;
    let updatedPermissions = currentRole.permissions;

    // Update name if provided
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Invalid name' });
      }

      const normalizedName = name.trim();

      // Check if name is reserved
      if (RESERVED_ROLE_NAMES.some(r => r.toLowerCase() === normalizedName.toLowerCase())) {
        return res.status(400).json({
          error: 'Role name is reserved',
          reserved_names: RESERVED_ROLE_NAMES,
        });
      }

      // Check if name is unique (excluding current role)
      const existingRole = await query<{ id: string }>(`
        SELECT id
        FROM workspace_roles
        WHERE workspace_id = $1 AND LOWER(name) = LOWER($2) AND id != $3
      `, [workspaceId, normalizedName, roleId]);

      if (existingRole.rows.length > 0) {
        return res.status(409).json({ error: 'Role name already exists in this workspace' });
      }

      updatedName = normalizedName;
    }

    // Update description if provided
    if (description !== undefined) {
      updatedDescription = description || null;
    }

    // Update permissions if provided (partial update)
    if (permissions !== undefined) {
      if (typeof permissions !== 'object' || permissions === null) {
        return res.status(400).json({ error: 'Invalid permissions object' });
      }

      // Merge partial permissions with existing
      const mergedPermissions = { ...currentRole.permissions };

      for (const [key, value] of Object.entries(permissions)) {
        if (!(key in mergedPermissions)) {
          return res.status(400).json({
            error: `Invalid permission key: ${key}`,
          });
        }
        if (typeof value !== 'boolean') {
          return res.status(400).json({
            error: `Permission value for ${key} must be boolean`,
          });
        }
        mergedPermissions[key as keyof PermissionSet] = value;
      }

      // GUARD: Check privilege escalation
      if (!req.userPermissions) {
        return res.status(403).json({ error: 'Cannot determine caller permissions' });
      }

      const escalation = hasPrivilegeEscalation(req.userPermissions, mergedPermissions);
      if (escalation.escalation) {
        return res.status(403).json({
          error: 'Cannot grant permissions you do not hold',
          denied_permissions: escalation.deniedPermissions,
        });
      }

      updatedPermissions = mergedPermissions;
    }

    // Update role
    await query<Record<string, never>>(`
      UPDATE workspace_roles
      SET
        name = $1,
        description = $2,
        permissions = $3
      WHERE id = $4
    `, [updatedName, updatedDescription, JSON.stringify(updatedPermissions), roleId]);

    res.json({
      id: roleId,
      name: updatedName,
      description: updatedDescription,
      is_system: false,
      permissions: updatedPermissions,
    });
  } catch (err) {
    console.error('[roles] Error updating role:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

/**
 * DELETE /:roleId
 * Delete custom role
 */
router.delete('/:roleId', requirePermission('members.change_roles'), async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const roleId = req.params.roleId as string;

    // Get role details
    const roleResult = await query<{
      id: string;
      is_system: boolean;
    }>(`
      SELECT id, is_system
      FROM workspace_roles
      WHERE id = $1 AND workspace_id = $2
    `, [roleId, workspaceId]);

    if (roleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }

    const role = roleResult.rows[0];

    // GUARD: Cannot delete system roles
    if (role.is_system) {
      return res.status(403).json({ error: 'Cannot delete system roles' });
    }

    // GUARD: Cannot delete if members hold this role
    const memberCount = await query<{ count: string }>(`
      SELECT COUNT(*)::text as count
      FROM workspace_members
      WHERE role_id = $1 AND workspace_id = $2 AND status IN ('active', 'pending')
    `, [roleId, workspaceId]);

    const count = parseInt(memberCount.rows[0]?.count || '0');

    if (count > 0) {
      return res.status(409).json({
        error: 'Role has members',
        count,
        suggestion: 'Reassign members to a different role before deleting',
      });
    }

    // Delete role
    await query<Record<string, never>>(`
      DELETE FROM workspace_roles
      WHERE id = $1
    `, [roleId]);

    res.json({ deleted: true });
  } catch (err) {
    console.error('[roles] Error deleting role:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to delete role' });
  }
});

export default router;
