/**
 * Permission and Feature Flag Enforcement Middleware
 * Protects API routes based on role permissions and feature flags
 */

import { Request, Response, NextFunction } from 'express';
import { query } from '../db.js';
import { PermissionSet } from '../permissions/types.js';

// Extend Express Request with permission fields
declare global {
  namespace Express {
    interface Request {
      userPermissions?: PermissionSet;
      workspaceMember?: {
        id: string;
        userId: string;
        roleId: string;
        role: string;
        displayName: string;
        isActive: boolean;
      };
    }
  }
}

interface WorkspaceMemberResult {
  id: string;
  user_id: string;
  role_id: string | null;
  role: string;
  display_name: string;
  is_active: boolean;
  permissions: PermissionSet | null;
}

/**
 * Get workspace member info and permissions for a user
 * Shared query used by all permission middleware
 */
export async function getWorkspaceMember(
  workspaceId: string,
  userId: string
): Promise<{
  member: WorkspaceMemberResult | null;
  permissions: PermissionSet | null;
}> {
  const result = await query<WorkspaceMemberResult>(
    `SELECT 
      wm.id,
      wm.user_id,
      wm.role,
      wm.display_name,
      wm.is_active,
      wr.id as role_id,
      wr.permissions
    FROM workspace_members wm
    LEFT JOIN workspace_roles wr 
      ON wr.workspace_id = wm.workspace_id 
      AND wr.system_type = wm.role
    WHERE wm.workspace_id = $1 
      AND wm.user_id = $2`,
    [workspaceId, userId]
  );

  if (result.rows.length === 0) {
    return { member: null, permissions: null };
  }

  const member = result.rows[0];
  
  // Parse permissions JSONB
  let permissions: PermissionSet | null = null;
  if (member.permissions) {
    if (typeof member.permissions === 'string') {
      permissions = JSON.parse(member.permissions);
    } else {
      permissions = member.permissions as PermissionSet;
    }
  }

  return { member, permissions };
}

/**
 * Middleware: Require a specific permission
 * Usage: router.get('/path', requirePermission('connectors.view'), handler)
 */
export function requirePermission(permission: keyof PermissionSet) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const workspaceId = req.params.workspaceId;
    
    if (!workspaceId) {
      res.status(400).json({ error: 'Missing workspaceId parameter' });
      return;
    }

    // Check if user is authenticated via API key (bypass permission check for API keys)
    if (req.authMethod === 'api_key') {
      return next();
    }

    const userId = req.user?.user_id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      // Check if permissions already cached on request
      if (req.userPermissions && req.workspaceMember) {
        // Verify permission
        if (req.userPermissions[permission] !== true) {
          res.status(403).json({ 
            error: 'Insufficient permissions', 
            required: permission 
          });
          return;
        }
        return next();
      }

      // Fetch permissions
      const { member, permissions } = await getWorkspaceMember(workspaceId, userId);

      if (!member) {
        res.status(403).json({ error: 'Not a member of this workspace' });
        return;
      }

      if (!member.is_active) {
        res.status(403).json({ error: 'Workspace membership is not active' });
        return;
      }

      if (!permissions) {
        res.status(403).json({ error: 'No role assigned to workspace member' });
        return;
      }

      // Cache on request for subsequent middleware
      req.userPermissions = permissions;
      req.workspaceMember = {
        id: member.id,
        userId: member.user_id,
        roleId: member.role_id || '',
        role: member.role,
        displayName: member.display_name,
        isActive: member.is_active,
      };

      // Check permission
      if (permissions[permission] !== true) {
        res.status(403).json({ 
          error: 'Insufficient permissions', 
          required: permission 
        });
        return;
      }

      next();
    } catch (error) {
      console.error('[permissions] Error checking permission:', error);
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

/**
 * Middleware: Require at least one of the specified permissions
 * Usage: router.get('/path', requireAnyPermission('agents.edit_own', 'agents.edit_any'), handler)
 */
export function requireAnyPermission(...permissions: Array<keyof PermissionSet>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const workspaceId = req.params.workspaceId;
    
    if (!workspaceId) {
      res.status(400).json({ error: 'Missing workspaceId parameter' });
      return;
    }

    // Check if user is authenticated via API key (bypass permission check for API keys)
    if (req.authMethod === 'api_key') {
      return next();
    }

    const userId = req.user?.user_id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      // Check if permissions already cached on request
      let userPermissions = req.userPermissions;
      
      if (!userPermissions) {
        // Fetch permissions
        const { member, permissions } = await getWorkspaceMember(workspaceId, userId);

        if (!member) {
          res.status(403).json({ error: 'Not a member of this workspace' });
          return;
        }

        if (!member.is_active) {
          res.status(403).json({ error: 'Workspace membership is not active' });
          return;
        }

        if (!permissions) {
          res.status(403).json({ error: 'No role assigned to workspace member' });
          return;
        }

        // Cache on request
        req.userPermissions = permissions;
        req.workspaceMember = {
          id: member.id,
          userId: member.user_id,
          roleId: member.role_id || '',
          role: member.role,
          displayName: member.display_name,
          isActive: member.is_active,
        };
        
        userPermissions = permissions;
      }

      // Check if user has ANY of the required permissions
      const hasAnyPermission = permissions.some(perm => userPermissions![perm] === true);
      
      if (!hasAnyPermission) {
        res.status(403).json({ 
          error: 'Insufficient permissions', 
          required_any: permissions 
        });
        return;
      }

      next();
    } catch (error) {
      console.error('[permissions] Error checking permissions:', error);
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

/**
 * Middleware: Require a feature flag to be enabled
 * Usage: router.get('/path', requireFeature('feature.conversation_intelligence'), handler)
 */
export function requireFeature(flagKey: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const workspaceId = req.params.workspaceId;
    
    if (!workspaceId) {
      res.status(400).json({ error: 'Missing workspaceId parameter' });
      return;
    }

    try {
      const result = await query<{ key: string; value: any; expires_at: Date | null }>(
        `SELECT key, value, expires_at 
         FROM workspace_flags 
         WHERE workspace_id = $1 AND key = $2`,
        [workspaceId, flagKey]
      );

      if (result.rows.length === 0) {
        res.status(403).json({ 
          error: 'Feature not available', 
          feature: flagKey 
        });
        return;
      }

      const flag = result.rows[0];
      
      // Parse value if it's a string
      let value = flag.value;
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value);
        } catch {
          // If parse fails, treat as string
        }
      }

      // Check if flag is enabled
      if (value !== true) {
        res.status(403).json({ 
          error: 'Feature not available', 
          feature: flagKey 
        });
        return;
      }

      // Check if flag has expired
      if (flag.expires_at && new Date(flag.expires_at) < new Date()) {
        res.status(403).json({ 
          error: 'Feature access expired', 
          feature: flagKey 
        });
        return;
      }

      next();
    } catch (error) {
      console.error('[permissions] Error checking feature flag:', error);
      res.status(500).json({ error: 'Feature flag check failed' });
    }
  };
}
