import { Router } from 'express';
import crypto from 'crypto';
import { query } from '../db.js';
import { requireAdmin, requireWorkspaceAccess, invalidateApiKeyCache } from '../middleware/auth.js';

const router = Router();

function generateApiKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

router.get('/', requireAdmin, async (req, res) => {
  try {
    const includeKeys = req.query.include_keys === 'true';
    const columns = includeKeys
      ? 'id, name, slug, plan, api_key, created_at, updated_at'
      : 'id, name, slug, plan, created_at, updated_at';
    const result = await query(
      `SELECT ${columns} FROM workspaces ORDER BY created_at DESC`
    );
    res.json({ workspaces: result.rows });
  } catch (err) {
    console.error('[workspaces] Error listing workspaces:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:workspaceId/api-key', requireAdmin, async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const result = await query(
      'SELECT id, name, api_key FROM workspaces WHERE id = $1',
      [workspaceId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    res.json({ workspace_id: result.rows[0].id, name: result.rows[0].name, api_key: result.rows[0].api_key });
  } catch (err) {
    console.error('[workspaces] Error retrieving API key:', err instanceof Error ? err.message : err);
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

// Branding Configuration Endpoints

/**
 * GET /api/workspaces/:workspaceId/branding
 * Returns current branding config
 */
router.get('/:workspaceId/branding', requireWorkspaceAccess, async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const result = await query(
      'SELECT branding FROM workspaces WHERE id = $1',
      [workspaceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    res.json({ branding: result.rows[0].branding || null });
  } catch (err) {
    console.error('[workspaces] Error fetching branding:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/workspaces/:workspaceId/branding
 * Updates branding config
 * Body: BrandingConfig with required fields: company_name, primary_color
 */
router.put('/:workspaceId/branding', requireWorkspaceAccess, async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const branding = req.body;

    // Validate required fields
    if (!branding.company_name || !branding.primary_color) {
      return res.status(400).json({
        error: 'company_name and primary_color are required',
      });
    }

    // Validate hex color format
    if (!/^#[0-9A-Fa-f]{6}$/.test(branding.primary_color)) {
      return res.status(400).json({
        error: 'primary_color must be a valid hex color (e.g., #2563EB)',
      });
    }

    if (branding.secondary_color && !/^#[0-9A-Fa-f]{6}$/.test(branding.secondary_color)) {
      return res.status(400).json({
        error: 'secondary_color must be a valid hex color',
      });
    }

    const result = await query(
      'UPDATE workspaces SET branding = $1, updated_at = NOW() WHERE id = $2 RETURNING branding',
      [JSON.stringify(branding), workspaceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    console.log(`[workspaces] Branding updated for workspace ${workspaceId}`);
    res.json({ branding: result.rows[0].branding });
  } catch (err) {
    console.error('[workspaces] Error updating branding:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/workspaces/:workspaceId/branding
 * Removes branding config
 */
router.delete('/:workspaceId/branding', requireWorkspaceAccess, async (req, res) => {
  try {
    const { workspaceId } = req.params;

    await query(
      'UPDATE workspaces SET branding = NULL, updated_at = NOW() WHERE id = $1',
      [workspaceId]
    );

    console.log(`[workspaces] Branding removed for workspace ${workspaceId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[workspaces] Error removing branding:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
