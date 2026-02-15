import { Router } from 'express';
import crypto from 'crypto';
import { query } from '../db.js';
import { requireAdmin, requireWorkspaceAccess, invalidateApiKeyCache } from '../middleware/auth.js';

const router = Router();

function generateApiKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

router.get('/', requireAdmin, async (_req, res) => {
  try {
    const result = await query(
      'SELECT id, name, slug, plan, created_at, updated_at FROM workspaces ORDER BY created_at DESC'
    );
    res.json({ workspaces: result.rows });
  } catch (err) {
    console.error('[workspaces] Error listing workspaces:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, slug, plan } = req.body || {};
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const apiKey = generateApiKey();
    const workspaceSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const result = await query(
      `INSERT INTO workspaces (name, slug, api_key, plan, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING id, name, slug, plan, api_key, created_at`,
      [name, workspaceSlug, apiKey, plan || 'free']
    );

    const workspace = result.rows[0];
    res.status(201).json({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      plan: workspace.plan,
      api_key: workspace.api_key,
      created_at: workspace.created_at,
    });
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(409).json({ error: 'Workspace with this name or slug already exists' });
      return;
    }
    console.error('[workspaces] Error creating workspace:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:workspaceId', requireWorkspaceAccess, async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const result = await query(
      'SELECT id, name, slug, plan, settings, created_at, updated_at FROM workspaces WHERE id = $1',
      [workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[workspaces] Error fetching workspace:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:workspaceId/rotate-key', requireWorkspaceAccess, async (req, res) => {
  try {
    const { workspaceId } = req.params;

    const oldKeyResult = await query(
      'SELECT api_key FROM workspaces WHERE id = $1',
      [workspaceId]
    );
    if (oldKeyResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const oldApiKey = oldKeyResult.rows[0].api_key;
    const newApiKey = generateApiKey();

    await query(
      'UPDATE workspaces SET api_key = $1, updated_at = NOW() WHERE id = $2',
      [newApiKey, workspaceId]
    );

    if (oldApiKey) {
      invalidateApiKeyCache(oldApiKey);
    }

    console.log(`[workspaces] API key rotated for workspace ${workspaceId}`);
    res.json({ api_key: newApiKey });
  } catch (err) {
    console.error('[workspaces] Error rotating API key:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
