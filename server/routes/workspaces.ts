import { Router } from 'express';
import crypto from 'crypto';
import { query } from '../db.js';
import { requireAdmin, requireWorkspaceAccess, invalidateApiKeyCache } from '../middleware/auth.js';
import { invalidateSchemaCache, type ObjectType } from '../tools/schema-query.js';

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
    const workspaceId = req.params.workspaceId as string;
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
    const { seedDictionary } = await import('../dictionary/dictionary-seeder.js');
    seedDictionary(workspace.id).catch(err => console.warn('[Dictionary] Seed failed:', err));

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
    const workspaceId = req.params.workspaceId as string;
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
    const workspaceId = req.params.workspaceId as string;

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
    const workspaceId = req.params.workspaceId as string;
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
    const workspaceId = req.params.workspaceId as string;
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
    const workspaceId = req.params.workspaceId as string;

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

// POST /api/workspaces/:id/schema/refresh
// Clear schema cache for workspace (optionally scoped to object_type)
router.post('/:id/schema/refresh', requireWorkspaceAccess, async (req, res) => {
  try {
    const workspaceId = req.params.id as string;
    const { object_type } = req.body;

    const objectType = object_type as ObjectType | undefined;

    if (objectType && !['deals', 'companies', 'contacts'].includes(objectType)) {
      res.status(400).json({ error: 'object_type must be: deals, companies, or contacts' });
      return;
    }

    await invalidateSchemaCache(workspaceId, objectType);

    const message = objectType
      ? `Schema cache cleared for ${objectType}. Will refresh on next query.`
      : 'Schema cache cleared for all object types. Will refresh on next query.';

    res.json({ success: true, message });
  } catch (err) {
    console.error('[workspaces] Error refreshing schema:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/workspaces/:id/demo/entity-names
// Returns entity names for Demo Mode pre-seeding
router.get('/:id/demo/entity-names', requireWorkspaceAccess, async (req, res) => {
  try {
    const workspaceId = req.params.id as string;

    // Query company names
    const companiesResult = await query(
      `SELECT DISTINCT name FROM accounts
       WHERE workspace_id = $1 AND name IS NOT NULL
       ORDER BY name LIMIT 200`,
      [workspaceId]
    );

    // Query deal names
    const dealsResult = await query(
      `SELECT DISTINCT name FROM deals
       WHERE workspace_id = $1 AND name IS NOT NULL
       ORDER BY name LIMIT 200`,
      [workspaceId]
    );

    // Query contact names (first_name and last_name)
    const contactsResult = await query(
      `SELECT DISTINCT first_name, last_name FROM contacts
       WHERE workspace_id = $1
       AND (first_name IS NOT NULL OR last_name IS NOT NULL)
       ORDER BY first_name, last_name LIMIT 200`,
      [workspaceId]
    );

    const companies = companiesResult.rows.map((row: any) => row.name);
    const deals = dealsResult.rows.map((row: any) => row.name);
    const persons = contactsResult.rows
      .map((row: any) => {
        const parts = [row.first_name, row.last_name].filter(Boolean);
        return parts.join(' ');
      })
      .filter(name => name.length > 0);

    res.json({ companies, deals, persons });
  } catch (err) {
    console.error('[workspaces] Error fetching demo entity names:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/workspaces/:workspaceId
 * Admin-only workspace deletion with two-phase process:
 * 1. Mark as 'deleting' (immediately excludes from scheduled operations)
 * 2. CASCADE delete all associated data
 */
router.delete('/:workspaceId', requireAdmin, async (req, res) => {
  const workspaceId = req.params.workspaceId as string;

  try {
    console.log(`[workspaces] Starting deletion for workspace ${workspaceId}`);

    // Verify workspace exists
    const wsResult = await query<{ id: string; name: string; status: string }>(
      'SELECT id, name, status FROM workspaces WHERE id = $1',
      [workspaceId]
    );

    if (wsResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const workspace = wsResult.rows[0];
    console.log(`[workspaces] Workspace found: ${workspace.name} (status: ${workspace.status})`);

    // Phase 1: Mark as 'deleting' to exclude from scheduler
    await query(
      'UPDATE workspaces SET status = $1, updated_at = NOW() WHERE id = $2',
      ['deleting', workspaceId]
    );
    console.log(`[workspaces] Marked workspace ${workspaceId} as 'deleting'`);

    // Pause briefly to allow any in-flight cron jobs to see the status change
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Count records before deletion (for logging/confirmation)
    const countQueries = [
      { table: 'connections', query: 'SELECT COUNT(*) as count FROM connections WHERE workspace_id = $1' },
      { table: 'accounts', query: 'SELECT COUNT(*) as count FROM accounts WHERE workspace_id = $1' },
      { table: 'deals', query: 'SELECT COUNT(*) as count FROM deals WHERE workspace_id = $1' },
      { table: 'contacts', query: 'SELECT COUNT(*) as count FROM contacts WHERE workspace_id = $1' },
      { table: 'activities', query: 'SELECT COUNT(*) as count FROM activities WHERE workspace_id = $1' },
      { table: 'signals', query: 'SELECT COUNT(*) as count FROM signals WHERE workspace_id = $1' },
      { table: 'skill_runs', query: 'SELECT COUNT(*) as count FROM skill_runs WHERE workspace_id = $1' },
      { table: 'chat_sessions', query: 'SELECT COUNT(*) as count FROM chat_sessions WHERE workspace_id = $1' },
    ];

    const counts: Record<string, number> = {};
    for (const { table, query: countQuery } of countQueries) {
      try {
        const result = await query<{ count: string }>(countQuery, [workspaceId]);
        counts[table] = parseInt(result.rows[0]?.count || '0', 10);
      } catch (err) {
        // Table might not exist yet (e.g., in development)
        counts[table] = 0;
      }
    }

    console.log(`[workspaces] Record counts before deletion:`, counts);

    // Phase 2: CASCADE delete
    await query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
    console.log(`[workspaces] ✓ Workspace ${workspaceId} deleted successfully`);

    res.json({
      success: true,
      workspace_id: workspaceId,
      workspace_name: workspace.name,
      deleted_records: counts,
      message: 'Workspace and all associated data deleted successfully',
    });
  } catch (err) {
    console.error(`[workspaces] ✗ Error deleting workspace ${workspaceId}:`, err instanceof Error ? err.stack : err);

    // Error recovery: restore 'active' status if deletion failed
    try {
      await query(
        'UPDATE workspaces SET status = $1, updated_at = NOW() WHERE id = $2',
        ['active', workspaceId]
      );
      console.log(`[workspaces] Restored workspace ${workspaceId} to 'active' status after deletion failure`);
    } catch (restoreErr) {
      console.error(`[workspaces] Failed to restore status for workspace ${workspaceId}:`, restoreErr);
    }

    res.status(500).json({
      error: 'Failed to delete workspace',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// GET /api/workspaces/:id/survival-curve
// Parameterized win rate curve API for Ask Pandora and on-demand queries
router.get('/:id/survival-curve', requireWorkspaceAccess, async (req, res) => {
  try {
    const { buildSurvivalCurves } = await import('../analysis/survival-data.js');
    const workspaceId = req.params.id as string;
    const groupBy = (req.query.groupBy as string) || 'none';
    const lookbackMonths = parseInt(req.query.lookbackMonths as string) || 24;
    const minSegmentSize = parseInt(req.query.minSegmentSize as string) || 30;

    const qs = (key: string): string | undefined => {
      const raw = req.query[key];
      if (!raw) return undefined;
      const v = Array.isArray(raw) ? raw[0] : raw;
      return typeof v === 'string' ? v : undefined;
    };
    const filters: Record<string, any> = {};
    if (qs('source')) filters.source = qs('source');
    if (qs('owner')) filters.ownerEmail = qs('owner');
    if (qs('minAmount')) filters.minAmount = parseFloat(qs('minAmount')!);
    if (qs('maxAmount')) filters.maxAmount = parseFloat(qs('maxAmount')!);
    if (qs('stage')) filters.stage = qs('stage');
    if (qs('pipeline')) filters.pipeline = qs('pipeline');

    const result = await buildSurvivalCurves({
      workspaceId,
      lookbackMonths,
      groupBy: groupBy as any,
      filters: Object.keys(filters).length > 0 ? filters as any : undefined,
      minSegmentSize,
    });

    // Serialize Map to plain object for JSON
    const segments: Record<string, any> = {};
    for (const [key, curve] of result.segments) {
      segments[key] = curve;
    }

    res.json({
      overall: result.overall,
      segments,
      metadata: result.metadata,
    });
  } catch (err) {
    console.error('[workspaces] Error computing survival curve:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to compute survival curve' });
  }
});

// GET /:workspaceId/usage — workspace usage stats for billing tab
router.get('/:workspaceId/usage', requireWorkspaceAccess, async (req, res) => {
  const { workspaceId } = req.params;
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [skillRunsResult, memberResult, docsResult, tokenResult] = await Promise.all([
      query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM skill_runs
         WHERE workspace_id = $1 AND created_at >= $2`,
        [workspaceId, monthStart]
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM user_workspaces WHERE workspace_id = $1`,
        [workspaceId]
      ),
      query<{ docs: string; generated: string }>(
        `SELECT
           (SELECT COUNT(*) FROM documents WHERE workspace_id = $1)::text AS docs,
           (SELECT COUNT(*) FROM generated_documents WHERE workspace_id = $1)::text AS generated`,
        [workspaceId]
      ),
      query<{ input_tokens: string; output_tokens: string; cost: string }>(
        `SELECT
           COALESCE(SUM(input_tokens), 0)::text AS input_tokens,
           COALESCE(SUM(output_tokens), 0)::text AS output_tokens,
           COALESCE(SUM(estimated_cost_usd), 0)::text AS cost
         FROM token_usage
         WHERE workspace_id = $1 AND created_at >= $2`,
        [workspaceId, monthStart]
      ),
    ]);

    const docs = parseInt(docsResult.rows[0]?.docs ?? '0');
    const generated = parseInt(docsResult.rows[0]?.generated ?? '0');
    const totalDocs = docs + generated;

    res.json({
      skill_runs_this_month: parseInt(skillRunsResult.rows[0]?.count ?? '0'),
      member_count: parseInt(memberResult.rows[0]?.count ?? '0'),
      storage_docs: totalDocs,
      storage_docs_breakdown: { synced: docs, generated },
      token_usage_this_month: {
        input_tokens: parseInt(tokenResult.rows[0]?.input_tokens ?? '0'),
        output_tokens: parseInt(tokenResult.rows[0]?.output_tokens ?? '0'),
        cost_usd: parseFloat(tokenResult.rows[0]?.cost ?? '0'),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[workspaces] usage stats error:', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
