import { Request, Response, NextFunction } from 'express';
import { query } from '../db.js';

declare global {
  namespace Express {
    interface Request {
      workspace?: { id: string; name: string };
      user?: { user_id: string; email: string; name: string; platform_role: string };
      authMethod?: 'api_key' | 'session';
      userWorkspaceRole?: string;
    }
  }
}

interface CacheEntry {
  workspace: { id: string; name: string };
  expiresAt: number;
}

const apiKeyCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

async function lookupWorkspaceByKey(apiKey: string): Promise<{ id: string; name: string } | null> {
  const cached = apiKeyCache.get(apiKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.workspace;
  }

  const result = await query<{ id: string; name: string }>(
    'SELECT id, name FROM workspaces WHERE api_key = $1',
    [apiKey]
  );

  if (result.rows.length === 0) {
    apiKeyCache.delete(apiKey);
    return null;
  }

  const workspace = { id: result.rows[0].id, name: result.rows[0].name };
  apiKeyCache.set(apiKey, { workspace, expiresAt: Date.now() + CACHE_TTL_MS });
  return workspace;
}

export async function requireUserSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const session = await query<{
      user_id: string; email: string; name: string; platform_role: string;
    }>(`
      SELECT us.user_id, u.email, u.name, u.role as platform_role
      FROM user_sessions us
      JOIN users u ON u.id = us.user_id
      WHERE us.token = $1 AND us.expires_at > now()
    `, [token]);

    if (session.rows.length === 0) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    req.user = session.rows[0];
    req.authMethod = 'session';
    next();
  } catch (err) {
    console.error('[auth] Error validating session:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Authentication service error' });
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing or invalid authorization token' });
    return;
  }

  try {
    const workspace = await lookupWorkspaceByKey(token);
    if (!workspace) {
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }

    req.workspace = workspace;
    req.authMethod = 'api_key';
    req.userWorkspaceRole = 'admin';
    next();
  } catch (err) {
    console.error('[auth] Error validating API key:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Authentication service error' });
  }
}

export async function requireWorkspaceAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const workspaceId = req.params.workspaceId;

  try {
    const workspace = await lookupWorkspaceByKey(token);
    if (workspace) {
      if (workspaceId && workspace.id !== workspaceId) {
        res.status(403).json({ error: 'API key does not have access to this workspace' });
        return;
      }
      req.workspace = workspace;
      req.authMethod = 'api_key';
      req.userWorkspaceRole = 'admin';
      return next();
    }

    const session = await query<{
      user_id: string; email: string; name: string; platform_role: string;
    }>(`
      SELECT us.user_id, u.email, u.name, u.role as platform_role
      FROM user_sessions us
      JOIN users u ON u.id = us.user_id
      WHERE us.token = $1 AND us.expires_at > now()
    `, [token]);

    if (session.rows.length === 0) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    const user = session.rows[0];

    if (!workspaceId) {
      req.user = user;
      req.authMethod = 'session';
      return next();
    }

    const access = await query<{ role: string }>(
      'SELECT role FROM user_workspaces WHERE user_id = $1 AND workspace_id = $2',
      [user.user_id, workspaceId]
    );

    if (access.rows.length === 0) {
      res.status(403).json({ error: 'No access to this workspace' });
      return;
    }

    const wsResult = await query<{ id: string; name: string }>(
      'SELECT id, name FROM workspaces WHERE id = $1',
      [workspaceId]
    );

    req.workspace = wsResult.rows[0] || { id: workspaceId, name: '' };
    req.user = user;
    req.authMethod = 'session';
    req.userWorkspaceRole = access.rows[0].role;
    next();
  } catch (err) {
    console.error('[auth] Error in requireWorkspaceAccess:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Authentication service error' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const adminKey = process.env.PANDORA_ADMIN_KEY;
  if (!adminKey) {
    res.status(500).json({ error: 'Admin authentication not configured' });
    return;
  }

  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing or invalid authorization token' });
    return;
  }

  if (token !== adminKey) {
    res.status(401).json({ error: 'Invalid admin key' });
    return;
  }

  next();
}

const ROLE_LEVEL: Record<string, number> = { viewer: 0, member: 1, admin: 2 };

export function requireRole(minimumRole: 'viewer' | 'member' | 'admin') {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.authMethod === 'api_key') return next();

    const userRole = req.userWorkspaceRole;
    if (!userRole || (ROLE_LEVEL[userRole] ?? -1) < ROLE_LEVEL[minimumRole]) {
      res.status(403).json({ error: `Requires ${minimumRole} role` });
      return;
    }
    next();
  };
}

export function invalidateApiKeyCache(apiKey: string): void {
  apiKeyCache.delete(apiKey);
}

export function clearApiKeyCache(): void {
  apiKeyCache.clear();
}
