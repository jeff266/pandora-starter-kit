import { Request, Response, NextFunction } from 'express';
import { query } from '../db.js';

declare global {
  namespace Express {
    interface Request {
      workspace?: { id: string; name: string };
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

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    console.log('[auth] Missing or malformed Authorization header');
    res.status(401).json({ error: 'Missing or invalid authorization token' });
    return;
  }

  try {
    const workspace = await lookupWorkspaceByKey(token);
    if (!workspace) {
      console.log('[auth] Invalid API key used (key not shown)');
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }

    req.workspace = workspace;
    next();
  } catch (err) {
    console.error('[auth] Error validating API key:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Authentication service error' });
  }
}

export async function requireWorkspaceAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, () => {
    const workspaceId = req.params.workspaceId;
    if (workspaceId && req.workspace && req.workspace.id !== workspaceId) {
      console.log(`[auth] Workspace mismatch: token belongs to ${req.workspace.id}, requested ${workspaceId}`);
      res.status(403).json({ error: 'API key does not have access to this workspace' });
      return;
    }
    next();
  });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const adminKey = process.env.PANDORA_ADMIN_KEY;
  if (!adminKey) {
    console.error('[auth] PANDORA_ADMIN_KEY not configured');
    res.status(500).json({ error: 'Admin authentication not configured' });
    return;
  }

  const token = extractBearerToken(req);
  if (!token) {
    console.log('[auth] Missing Authorization header for admin endpoint');
    res.status(401).json({ error: 'Missing or invalid authorization token' });
    return;
  }

  if (token !== adminKey) {
    console.log('[auth] Invalid admin key used');
    res.status(401).json({ error: 'Invalid admin key' });
    return;
  }

  next();
}

export function invalidateApiKeyCache(apiKey: string): void {
  apiKeyCache.delete(apiKey);
}

export function clearApiKeyCache(): void {
  apiKeyCache.clear();
}
