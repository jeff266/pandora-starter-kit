/**
 * Admin Scopes Routes
 *
 * Internal admin view for managing analysis_scopes per workspace.
 * Mounted on workspaceApiRouter — protected by requireWorkspaceAccess.
 *
 * Routes:
 *   GET  /:workspaceId/admin/scopes                      — list scopes + deal counts
 *   GET  /:workspaceId/admin/scopes/:scopeId/preview     — first 20 deals for scope
 *   POST /:workspaceId/admin/scopes/re-infer             — re-run inference (no confirm reset)
 *   POST /:workspaceId/admin/scopes/:scopeId/confirm     — set confirmed=true + re-stamp
 */

import { Router, type Request, type Response } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { query } from '../db.js';
import { inferAnalysisScopes, applyInferredScopes } from '../config/scope-inference.js';
import { stampAllDealsForWorkspace, setDealScopeOverride } from '../config/scope-stamper.js';
import { getScopeWhereClause, type ActiveScope } from '../config/scope-loader.js';

const router = Router();

// ============================================================================
// GET /:workspaceId/admin/scopes
// ============================================================================

router.get('/:workspaceId/admin/scopes', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.workspaceId as string;

  try {
    // 1. Fetch scopes from analysis_scopes — graceful degradation if table missing (pre-migration 058)
    let scopeRows: Array<{
      scope_id: string;
      name: string;
      filter_field: string;
      filter_values: string[];
      confirmed: boolean;
      confidence: number | null;
      field_overrides: Record<string, any>;
      created_at: string;
      updated_at: string;
    }>;

    try {
      const result = await query<{
        scope_id: string;
        name: string;
        filter_field: string;
        filter_values: string[];
        confirmed: boolean;
        confidence: number | null;
        field_overrides: any;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT scope_id, name, filter_field, filter_values, confirmed,
                confidence, field_overrides, created_at, updated_at
         FROM analysis_scopes
         WHERE workspace_id = $1
         ORDER BY
           CASE WHEN scope_id = 'default' THEN 1 ELSE 0 END ASC,
           created_at ASC`,
        [workspaceId]
      );
      scopeRows = result.rows;
    } catch (_tableErr) {
      // analysis_scopes table doesn't exist yet (pre-migration 058)
      res.json({
        scopes: [],
        total_deals: 0,
        unscoped_deals: 0,
        has_confirmed_scopes: false,
      });
      return;
    }

    // 2. Total deal count
    const totalResult = await query<{ cnt: string }>(
      `SELECT COUNT(*)::text as cnt FROM deals WHERE workspace_id = $1`,
      [workspaceId]
    );
    const total_deals = parseInt(totalResult.rows[0]?.cnt || '0');

    // 3. Per-scope deal counts (graceful degradation if scope_id column missing — pre-migration 057)
    let scopeDealCounts: Record<string, number> = {};
    try {
      const countResult = await query<{ scope_id: string; cnt: string }>(
        `SELECT scope_id, COUNT(*)::text as cnt
         FROM deals
         WHERE workspace_id = $1
         GROUP BY scope_id`,
        [workspaceId]
      );
      for (const row of countResult.rows) {
        scopeDealCounts[row.scope_id] = parseInt(row.cnt);
      }
    } catch (_colErr) {
      // scope_id column doesn't exist yet (pre-migration 057) — all deals are implicitly 'default'
      scopeDealCounts['default'] = total_deals;
    }

    // 4. Derived stats
    const has_confirmed_scopes = scopeRows.some(r => r.confirmed && r.scope_id !== 'default');
    const unscoped_deals = scopeDealCounts['default'] || 0;

    // 5. Map to response shape
    const scopes = scopeRows.map(row => ({
      scope_id: row.scope_id,
      name: row.name,
      filter_field: row.filter_field,
      filter_values: Array.isArray(row.filter_values) ? row.filter_values : [],
      deal_count: scopeDealCounts[row.scope_id] || 0,
      confirmed: row.confirmed,
      confidence: row.confidence,
      source: (row.field_overrides as Record<string, any>)?._source || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    res.json({ scopes, total_deals, unscoped_deals, has_confirmed_scopes });
  } catch (err) {
    console.error('[Admin Scopes] GET scopes error:', err);
    res.status(500).json({ error: 'Failed to load scopes' });
  }
});

// ============================================================================
// POST /:workspaceId/admin/scopes/re-infer
// Must be declared BEFORE /:scopeId routes to avoid param ambiguity.
// ============================================================================

router.post('/:workspaceId/admin/scopes/re-infer', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.workspaceId as string;

  try {
    const inferred = await inferAnalysisScopes(workspaceId);
    await applyInferredScopes(workspaceId, inferred);

    res.json({
      scopes: inferred,
      count: inferred.length,
    });
  } catch (err) {
    console.error('[Admin Scopes] Re-infer error:', err);
    res.status(500).json({ error: 'Inference failed', details: (err as Error).message });
  }
});

// ============================================================================
// GET /:workspaceId/admin/scopes/:scopeId/preview
// ============================================================================

router.get('/:workspaceId/admin/scopes/:scopeId/preview', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.workspaceId as string;
  const scopeId = req.params.scopeId as string;

  try {
    // Look up the scope filter from DB (safe: scopeId used only as parameter)
    const scopeResult = await query<{
      scope_id: string;
      name: string;
      filter_field: string;
      filter_operator: string;
      filter_values: string[];
      field_overrides: any;
    }>(
      `SELECT scope_id, name, filter_field, filter_operator, filter_values, field_overrides
       FROM analysis_scopes
       WHERE workspace_id = $1 AND scope_id = $2`,
      [workspaceId, scopeId]
    );

    if (scopeResult.rows.length === 0) {
      res.status(404).json({ error: 'Scope not found' });
      return;
    }

    const scopeRow = scopeResult.rows[0];
    const scope: ActiveScope = {
      scope_id: scopeRow.scope_id,
      name: scopeRow.name,
      filter_field: scopeRow.filter_field,
      filter_operator: scopeRow.filter_operator,
      filter_values: Array.isArray(scopeRow.filter_values) ? scopeRow.filter_values : [],
      field_overrides: scopeRow.field_overrides || {},
    };

    const scopeWhere = getScopeWhereClause(scope);
    let whereClause: string;
    if (scopeId === 'default') {
      whereClause = `workspace_id = $1 AND scope_id = 'default'`;
    } else if (scopeWhere) {
      whereClause = `workspace_id = $1 AND ${scopeWhere}`;
    } else {
      whereClause = `workspace_id = $1`;
    }

    // Support filtering to overrides only
    const overridesOnly = req.query.overrides_only === 'true';
    if (overridesOnly) {
      whereClause += ` AND scope_override IS NOT NULL`;
    }

    const deals = await query<{
      id: string;
      name: string;
      amount: number | null;
      stage: string | null;
      close_date: string | null;
      owner_email: string | null;
      pipeline: string | null;
      scope_id: string;
      scope_override: string | null;
    }>(
      `SELECT id, name, amount, stage_normalized AS stage, close_date,
              owner AS owner_email, pipeline, scope_id, scope_override
       FROM deals
       WHERE ${whereClause}
       ORDER BY amount DESC NULLS LAST
       LIMIT 20`,
      [workspaceId]
    );

    // Count total overrides in this scope for the summary line
    const overrideCountResult = await query<{ cnt: string }>(
      `SELECT COUNT(*)::text as cnt FROM deals
       WHERE ${scopeId === 'default' ? 'workspace_id = $1 AND scope_id = \'default\'' : `workspace_id = $1 AND ${scopeWhere}`}
         AND scope_override IS NOT NULL`,
      [workspaceId]
    );
    const override_count = parseInt(overrideCountResult.rows[0]?.cnt || '0');

    res.json({ deals: deals.rows, scope_name: scope.name, override_count });
  } catch (err) {
    console.error('[Admin Scopes] Preview error:', err);
    res.status(500).json({ error: 'Preview failed', details: (err as Error).message });
  }
});

// ============================================================================
// POST /:workspaceId/admin/scopes/:scopeId/confirm
// ============================================================================

router.post('/:workspaceId/admin/scopes/:scopeId/confirm', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.workspaceId as string;
  const scopeId = req.params.scopeId as string;

  try {
    const result = await query<{
      scope_id: string;
      name: string;
      filter_field: string;
      filter_values: string[];
      confirmed: boolean;
      confidence: number | null;
      updated_at: string;
    }>(
      `UPDATE analysis_scopes
       SET confirmed = true, updated_at = now()
       WHERE workspace_id = $1 AND scope_id = $2
       RETURNING scope_id, name, filter_field, filter_values, confirmed, confidence, updated_at`,
      [workspaceId, scopeId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Scope not found' });
      return;
    }

    // Fire-and-forget: re-stamp all deals for this workspace
    stampAllDealsForWorkspace(workspaceId).catch(err =>
      console.error(`[Admin Scopes] Stamp error after confirm (workspace=${workspaceId}):`, err)
    );

    res.json({ scope: result.rows[0] });
  } catch (err) {
    console.error('[Admin Scopes] Confirm error:', err);
    res.status(500).json({ error: 'Confirm failed', details: (err as Error).message });
  }
});

// ============================================================================
// POST /:workspaceId/admin/scopes/deals/:dealId/override
// ============================================================================

router.post('/:workspaceId/admin/scopes/deals/:dealId/override', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.workspaceId as string;
  const dealId = req.params.dealId as string;
  const { scope_id } = req.body as { scope_id?: string };

  if (!scope_id || typeof scope_id !== 'string') {
    res.status(400).json({ error: 'scope_id is required and must be a string' });
    return;
  }

  try {
    // Verify deal belongs to this workspace
    const dealCheck = await query<{ id: string; workspace_id: string }>(
      `SELECT id, workspace_id FROM deals WHERE id = $1`,
      [dealId]
    );

    if (dealCheck.rows.length === 0) {
      res.status(404).json({ error: 'Deal not found' });
      return;
    }

    if (dealCheck.rows[0].workspace_id !== workspaceId) {
      res.status(403).json({ error: 'Deal does not belong to this workspace' });
      return;
    }

    // Set the override
    await setDealScopeOverride(workspaceId, dealId, scope_id);

    // Fetch updated deal row
    const result = await query<{
      id: string;
      scope_id: string;
      scope_override: string | null;
      updated_at: string;
    }>(
      `SELECT id, scope_id, scope_override, updated_at
       FROM deals
       WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, dealId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Admin Scopes] Override error:', err);
    res.status(500).json({ error: 'Override failed', details: (err as Error).message });
  }
});

// ============================================================================
// DELETE /:workspaceId/admin/scopes/deals/:dealId/override
// ============================================================================

router.delete('/:workspaceId/admin/scopes/deals/:dealId/override', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.workspaceId as string;
  const dealId = req.params.dealId as string;

  try {
    // Verify deal belongs to this workspace
    const dealCheck = await query<{ id: string; workspace_id: string }>(
      `SELECT id, workspace_id FROM deals WHERE id = $1`,
      [dealId]
    );

    if (dealCheck.rows.length === 0) {
      res.status(404).json({ error: 'Deal not found' });
      return;
    }

    if (dealCheck.rows[0].workspace_id !== workspaceId) {
      res.status(403).json({ error: 'Deal does not belong to this workspace' });
      return;
    }

    // Clear the override (re-stamps using inference)
    await setDealScopeOverride(workspaceId, dealId, null);

    // Fetch updated deal row
    const result = await query<{
      id: string;
      scope_id: string;
      scope_override: string | null;
      updated_at: string;
    }>(
      `SELECT id, scope_id, scope_override, updated_at
       FROM deals
       WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, dealId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Admin Scopes] Clear override error:', err);
    res.status(500).json({ error: 'Clear override failed', details: (err as Error).message });
  }
});

export default router;
