/**
 * usePermissions Hook
 *
 * Provides permission checks based on the current user's workspace role.
 * Mirrors the backend permission structure from server/permissions/system-roles.ts
 */

import { useWorkspace } from '../context/WorkspaceContext';

type Role = 'admin' | 'manager' | 'analyst' | 'member' | 'viewer';

// Permission mappings from server/permissions/system-roles.ts
const ROLE_PERMISSIONS: Record<Role, Record<string, boolean>> = {
  admin: {
    // Admin has all permissions
    'skills.run_manual': true,
    'skills.view_results': true,
    'skills.view_evidence': true,
    'skills.configure': true,
    'data.export': true,
    'members.view': true,
    'members.invite': true,
    'members.remove': true,
    'config.edit': true,
  },

  member: {
    'skills.run_manual': true,
    'skills.view_results': true,
    'skills.view_evidence': true,
    'skills.configure': false,
    'data.export': true,
    'members.view': true,
    'members.invite': false,
    'config.edit': false,
  },

  manager: {
    'skills.run_manual': true,
    'skills.view_results': true,
    'skills.view_evidence': true,
    'skills.configure': false,
    'data.export': true,
    'members.view': true,
    'members.invite': false,
    'config.edit': false,
  },

  analyst: {
    'skills.run_manual': true, // Updated to true per RBAC credit control fix
    'skills.view_results': true,
    'skills.view_evidence': true,
    'skills.configure': false,
    'data.export': false,
    'members.view': true,
    'members.invite': false,
    'config.edit': false,
  },

  viewer: {
    'skills.run_manual': false, // Viewers cannot run skills
    'skills.view_results': true,
    'skills.view_evidence': false,
    'skills.configure': false,
    'data.export': false,
    'members.view': true,
    'members.invite': false,
    'config.edit': false,
  },
};

export function usePermissions() {
  const { currentWorkspace } = useWorkspace();
  const role = (currentWorkspace?.role || 'viewer') as Role;

  /**
   * Check if the current user has a specific permission
   * @param permission - The permission key to check (e.g., 'skills.run_manual')
   * @returns true if user has permission, false otherwise
   */
  const hasPermission = (permission: string): boolean => {
    const rolePerms = ROLE_PERMISSIONS[role];

    // If permission not explicitly defined, default to false
    if (rolePerms[permission] === undefined) {
      return false;
    }

    return rolePerms[permission];
  };

  /**
   * Check if user is an admin (useful for admin-only UI)
   */
  const isAdmin = role === 'admin';

  /**
   * Check if user can run skills (convenience method)
   */
  const canRunSkills = hasPermission('skills.run_manual');

  const canAnnotateReports = role === 'admin' || role === 'manager';

  return {
    role,
    hasPermission,
    isAdmin,
    canRunSkills,
    canAnnotateReports,
  };
}
