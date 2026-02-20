/**
 * Workspace Context Middleware
 * Attaches workspace and member data to all workspace-scoped requests
 */

import { Request, Response, NextFunction } from 'express';
import { query } from '../db.js';

// Extend Express Request with workspace context
declare global {
  namespace Express {
    interface Request {
      workspace?: {
        id: string;
        name: string;
        slug?: string;
        plan?: string;
        createdAt?: Date;
      };
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

interface WorkspaceMemberRow {
  id: string;
  user_id: string;
  role: string;
  display_name: string;
  is_active: boolean;
}

/**
 * Middleware: Attach workspace context to request
 * Runs on all /api/workspaces/:workspaceId/* routes
 * 
 * Does NOT enforce permissions - that's requirePermission's job
 * Just makes workspace data available to downstream handlers
 */
export async function attachWorkspaceContext(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const workspaceId = req.params.workspaceId;

  if (!workspaceId) {
    // This middleware should only run on routes with :workspaceId param
    return next();
  }

  try {
    // Query workspace
    const workspaceResult = await query<WorkspaceRow>(
      `SELECT id, name, slug, plan, created_at 
       FROM workspaces 
       WHERE id = $1`,
      [workspaceId]
    );

    if (workspaceResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const workspace = workspaceResult.rows[0];

    // Attach to request
    req.workspace = {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      plan: workspace.plan,
      createdAt: workspace.created_at,
    };

    // If user is authenticated, check if they're a member (any status)
    // This is informational only - doesn't block access
    if (req.user?.user_id) {
      const memberResult = await query<WorkspaceMemberRow>(
        `SELECT id, user_id, role, display_name, is_active
         FROM workspace_members
         WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, req.user.user_id]
      );

      if (memberResult.rows.length > 0) {
        const member = memberResult.rows[0];
        req.workspaceMember = {
          id: member.id,
          userId: member.user_id,
          roleId: '', // Will be populated by requirePermission if needed
          role: member.role,
          displayName: member.display_name,
          isActive: member.is_active,
        };
      }
    }

    next();
  } catch (error) {
    console.error('[workspace-context] Error loading workspace context:', error);
    res.status(500).json({ error: 'Failed to load workspace context' });
  }
}
