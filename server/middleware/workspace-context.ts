/**
 * Workspace Context Middleware
 * Attaches workspace, member, and data-visibility scope to all workspace-scoped requests.
 */

import { Request, Response, NextFunction } from 'express';
import { query } from '../db.js';
import { getDataVisibilityScope, DataScope } from '../permissions/data-visibility.js';

declare global {
  namespace Express {
    interface Request {
      workspace?: { id: string; name: string };
      dataScope?: DataScope;
    }
  }
}

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  created_at: Date;
}

interface WorkspaceMemberWithPerms {
  id: string;
  user_id: string;
  role_id: string;
  pandora_role: string;
  status: string;
  permissions: any;
}

/**
 * Middleware: Attach workspace context + data-visibility scope to request.
 * Runs on all /api/workspaces/:workspaceId/* routes.
 *
 * Does NOT enforce permissions — that is requirePermission's job.
 * Sets req.workspace and req.dataScope for downstream handlers.
 */
export async function attachWorkspaceContext(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const workspaceId = req.params.workspaceId;

  if (!workspaceId) {
    return next();
  }

  try {
    const workspaceResult = await query<WorkspaceRow>(
      `SELECT id, name, slug, plan, created_at FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    if (workspaceResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    req.workspace = { id: workspaceResult.rows[0].id, name: workspaceResult.rows[0].name } as any;

    if (req.user?.user_id) {
      const memberResult = await query<WorkspaceMemberWithPerms>(
        `SELECT wm.id, wm.user_id, wm.role_id, wm.pandora_role, wm.status, wr.permissions
         FROM workspace_members wm
         LEFT JOIN workspace_roles wr ON wr.id = wm.role_id
         WHERE wm.workspace_id = $1 AND wm.user_id = $2`,
        [workspaceId, req.user.user_id]
      );

      if (memberResult.rows.length > 0) {
        const member = memberResult.rows[0];

        req.workspaceMember = {
          id: member.id,
          userId: member.user_id,
          roleId: member.role_id || '',
          role: member.pandora_role,
          displayName: '',
          isActive: member.status === 'active',
        };

        let permissions: Record<string, boolean> = {};
        if (member.permissions) {
          permissions = typeof member.permissions === 'string'
            ? JSON.parse(member.permissions)
            : member.permissions;
        }

        req.dataScope = getDataVisibilityScope(permissions);
      }
    }

    next();
  } catch (error) {
    console.error('[workspace-context] Error loading workspace context:', error);
    res.status(500).json({ error: 'Failed to load workspace context' });
  }
}
