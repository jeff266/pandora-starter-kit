/**
 * Workspace Configuration Layer API
 *
 * Central configuration endpoints for workspace-specific settings that replace
 * hardcoded skill assumptions (pipelines, win rates, thresholds, teams, activities).
 */

import { Router, type Request, type Response } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { query } from '../db.js';
import { configLoader } from '../config/workspace-config-loader.js';
import {
  validateWorkspaceConfig,
  type WorkspaceConfig,
  type WinRateConfig,
  type PipelineConfig,
  type ThresholdConfig,
} from '../types/workspace-config.js';
import { inferWorkspaceConfig } from '../config/inference-engine.js';
import { getInstantAuditResults } from '../config/instant-audit.js';
import { getConfigSuggestions } from '../config/drift-detection.js';
import { getAuditHistory } from '../skills/compute/workspace-config-audit.js';

const router = Router();

interface WorkspaceParams {
  workspaceId: string;
}

interface SectionParams extends WorkspaceParams {
  section: string;
}

/**
 * GET /api/workspaces/:workspaceId/workspace-config
 * Get full workspace configuration (or defaults if none exists)
 */
router.get(
  '/:workspaceId/workspace-config',
  async (req: Request<WorkspaceParams>, res: Response) => {
    try {
      const { workspaceId } = req.params;

      // Verify workspace exists
      const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [
        workspaceId,
      ]);
      if (wsCheck.rows.length === 0) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      const config = await configLoader.getConfig(workspaceId);

      res.json({
        success: true,
        config,
        is_default: !config.confirmed,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Workspace Config] Get config error:', message);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * PUT /api/workspaces/:workspaceId/workspace-config
 * Full workspace config update (sets confirmed = true)
 */
router.put(
  '/:workspaceId/workspace-config',
  async (req: Request<WorkspaceParams>, res: Response) => {
    try {
      const { workspaceId } = req.params;
      const configData = req.body as Partial<WorkspaceConfig>;

      // Verify workspace exists
      const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [
        workspaceId,
      ]);
      if (wsCheck.rows.length === 0) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      // Validate config
      const errors = validateWorkspaceConfig(configData);
      if (errors.length > 0) {
        res.status(400).json({
          error: 'Invalid configuration',
          validation_errors: errors,
        });
        return;
      }

      // Build final config
      const config: WorkspaceConfig = {
        ...configData,
        workspace_id: workspaceId,
        updated_at: new Date(),
        confirmed: true,
      } as WorkspaceConfig;

      await query(
        `UPDATE context_layer
         SET definitions = jsonb_set(COALESCE(definitions, '{}'), '{workspace_config}', $2::jsonb),
             updated_at = NOW()
         WHERE workspace_id = $1`,
        [workspaceId, JSON.stringify(config)]
      );

      // Clear cache
      configLoader.clearCache(workspaceId);

      res.json({ success: true, config });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Workspace Config] Update config error:', message);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * PATCH /api/workspaces/:workspaceId/workspace-config/:section
 * Update a specific section (win_rate, pipelines, thresholds, etc.)
 */
router.patch(
  '/:workspaceId/workspace-config/:section',
  async (req: Request<SectionParams>, res: Response) => {
    try {
      const { workspaceId, section } = req.params;
      let sectionData = req.body;

      // Verify workspace exists
      const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [
        workspaceId,
      ]);
      if (wsCheck.rows.length === 0) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      // Get existing config
      const existing = await configLoader.getConfig(workspaceId);

      // Update the specific section
      const validSections = [
        'pipelines',
        'win_rate',
        'teams',
        'activities',
        'cadence',
        'thresholds',
        'scoring',
        'voice',
        'tool_filters',
        'experimental_skills',
      ];

      if (!validSections.includes(section)) {
        res.status(400).json({
          error: `Invalid section: ${section}`,
          valid_sections: validSections,
        });
        return;
      }

      if (section === 'voice') {
        const validDetail = ['concise', 'standard', 'detailed'];
        const validFraming = ['direct', 'balanced', 'diplomatic'];
        const validThreshold = ['all', 'watch_and_act', 'act_only'];

        if (sectionData.detail_level && !validDetail.includes(sectionData.detail_level)) {
          res.status(400).json({ error: 'detail_level must be concise, standard, or detailed' });
          return;
        }
        if (sectionData.framing && !validFraming.includes(sectionData.framing)) {
          res.status(400).json({ error: 'framing must be direct, balanced, or diplomatic' });
          return;
        }
        if (sectionData.alert_threshold && !validThreshold.includes(sectionData.alert_threshold)) {
          res.status(400).json({ error: 'alert_threshold must be all, watch_and_act, or act_only' });
          return;
        }

        const mergedVoice = { ...(existing.voice || {}), ...sectionData };
        sectionData = mergedVoice;
      }

      const updated = {
        ...existing,
        [section]: sectionData,
        updated_at: new Date(),
      };

      const errors = validateWorkspaceConfig(updated);
      if (errors.length > 0) {
        res.status(400).json({
          error: 'Invalid configuration',
          validation_errors: errors,
        });
        return;
      }

      await query(
        `UPDATE context_layer
         SET definitions = jsonb_set(COALESCE(definitions, '{}'), '{workspace_config}', $2::jsonb),
             updated_at = NOW()
         WHERE workspace_id = $1`,
        [workspaceId, JSON.stringify(updated)]
      );

      // Clear cache
      configLoader.clearCache(workspaceId);

      res.json({ success: true, config: updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Workspace Config] Patch section error:', message);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /api/workspaces/:workspaceId/workspace-config/defaults
 * Get default configuration (useful for initial setup)
 */
router.get(
  '/:workspaceId/workspace-config/defaults',
  async (req: Request<WorkspaceParams>, res: Response) => {
    try {
      const { workspaceId } = req.params;

      // Verify workspace exists
      const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [
        workspaceId,
      ]);
      if (wsCheck.rows.length === 0) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      // Force get defaults by clearing cache and getting config from a non-existent workspace
      const loader = new (configLoader.constructor as any)();
      const defaults = (loader as any).getDefaults(workspaceId);

      res.json({ success: true, defaults });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Workspace Config] Get defaults error:', message);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * DELETE /api/workspaces/:workspaceId/workspace-config
 * Delete workspace config (revert to defaults)
 */
router.delete(
  '/:workspaceId/workspace-config',
  async (req: Request<WorkspaceParams>, res: Response) => {
    try {
      const { workspaceId } = req.params;

      // Verify workspace exists
      const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [
        workspaceId,
      ]);
      if (wsCheck.rows.length === 0) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      await query(
        `UPDATE context_layer
         SET definitions = definitions - 'workspace_config',
             updated_at = NOW()
         WHERE workspace_id = $1`,
        [workspaceId]
      );

      // Clear cache
      configLoader.clearCache(workspaceId);

      res.json({
        success: true,
        message: 'Workspace config deleted, reverted to defaults',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Workspace Config] Delete config error:', message);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * POST /api/workspaces/:workspaceId/workspace-config/infer
 * Trigger config inference engine (Prompt 2)
 */
router.post(
  '/:workspaceId/workspace-config/infer',
  async (req: Request<WorkspaceParams>, res: Response) => {
    try {
      const { workspaceId } = req.params;

      // Verify workspace exists
      const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [
        workspaceId,
      ]);
      if (wsCheck.rows.length === 0) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      console.log(`[Config Inference] Starting inference for workspace ${workspaceId}`);
      const result = await inferWorkspaceConfig(workspaceId, req.body || {});

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Config Inference] Error:', message);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /api/workspaces/:workspaceId/workspace-config/summary
 * Get human-readable summary of detected config (Prompt 2)
 */
router.get(
  '/:workspaceId/workspace-config/summary',
  async (req: Request<WorkspaceParams>, res: Response) => {
    try {
      const { workspaceId } = req.params;

      // Verify workspace exists
      const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [
        workspaceId,
      ]);
      if (wsCheck.rows.length === 0) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      const config = await configLoader.getConfig(workspaceId);

      // Get inference signals
      const signalsResult = await query<{ value: any }>(
        `SELECT value FROM context_layer
         WHERE workspace_id = $1 AND category = 'settings' AND key = 'config_inference_signals'`,
        [workspaceId]
      );

      const signals = signalsResult.rows[0]?.value || {};

      // Get user review items from last inference
      const reviewResult = await query<{ value: any }>(
        `SELECT value FROM context_layer
         WHERE workspace_id = $1 AND category = 'settings' AND key = 'config_user_review_items'`,
        [workspaceId]
      );

      const userReviewItems = reviewResult.rows[0]?.value || [];

      // Get instant audit results
      const instantAudit = await getInstantAuditResults(workspaceId);

      // Build detection summary
      const status = config.confirmed ? 'confirmed' : (signals.fiscal_year ? 'inferred' : 'default');

      // Extract key detections from signals
      const stage0Signal = signals.stage_0?.[0];
      const parkingSignals = signals.parking_lot || [];
      const repSignal = signals.rep_patterns?.[0];
      const fiscalSignal = signals.fiscal_year?.[0];

      res.json({
        success: true,
        status,
        detection_summary: {
          pipelines: {
            count: config.pipelines.length,
            names: config.pipelines.map((p: any) => p.name),
          },
          stage_0: stage0Signal ? {
            detected: true,
            stage: stage0Signal.value.stage,
            raw_win_rate: stage0Signal.value.raw_win_rate,
            qualified_win_rate: stage0Signal.value.qualified_win_rate,
          } : { detected: false },
          parking_lot: parkingSignals.length > 0 ? {
            detected: true,
            stages: parkingSignals.map((s: any) => s.value.stage),
            deal_count: parkingSignals.reduce((sum: number, s: any) => sum + s.value.deal_count, 0),
          } : { detected: false },
          fiscal_year: {
            start_month: config.cadence.fiscal_year_start_month,
            source: fiscalSignal?.source || 'default',
          },
          quota_period: config.cadence.quota_period,
          reps: repSignal ? {
            count: repSignal.value.reps.length,
            excluded: repSignal.value.excluded.length,
          } : { count: 0, excluded: 0 },
        },
        user_review_items: userReviewItems,
        instant_audit: instantAudit || { completed: false },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Config Summary] Error:', message);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * POST /api/workspaces/:workspaceId/workspace-config/review/:index/confirm
 * Confirm a user review item (Prompt 2)
 */
router.post(
  '/:workspaceId/workspace-config/review/:index/confirm',
  async (req: Request<WorkspaceParams & { index: string }>, res: Response) => {
    try {
      const { workspaceId, index } = req.params;

      // Get review items
      const reviewResult = await query<{ value: any }>(
        `SELECT value FROM context_layer
         WHERE workspace_id = $1 AND category = 'settings' AND key = 'config_user_review_items'`,
        [workspaceId]
      );

      const reviewItems = reviewResult.rows[0]?.value || [];
      const itemIndex = parseInt(index, 10);

      if (itemIndex < 0 || itemIndex >= reviewItems.length) {
        res.status(404).json({ error: 'Review item not found' });
        return;
      }

      const item = reviewItems[itemIndex];

      // Apply the suggested value to config
      const config = await configLoader.getConfig(workspaceId);

      // Update config based on section and suggested_value
      // This is a simplified implementation - full version would handle all sections
      if (item.section === 'win_rate' && item.suggested_value) {
        config.win_rate.minimum_stage = item.suggested_value;
      }

      config._meta[`${item.section}.confirmed`] = {
        source: 'confirmed',
        confidence: 1.0,
        evidence: 'User confirmed',
        last_validated: new Date().toISOString(),
      };

      // Save updated config
      await query(
        `INSERT INTO context_layer (workspace_id, category, key, value, updated_at)
         VALUES ($1, 'settings', 'workspace_config', $2::jsonb, NOW())
         ON CONFLICT (workspace_id, category, key)
         DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
        [workspaceId, JSON.stringify(config)]
      );

      // Remove from review items
      reviewItems.splice(itemIndex, 1);
      await query(
        `UPDATE context_layer
         SET value = $2::jsonb, updated_at = NOW()
         WHERE workspace_id = $1 AND category = 'settings' AND key = 'config_user_review_items'`,
        [workspaceId, JSON.stringify(reviewItems)]
      );

      configLoader.clearCache(workspaceId);

      res.json({ success: true, message: 'Review item confirmed' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Config Review] Error:', message);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * POST /api/workspaces/:workspaceId/workspace-config/review/:index/dismiss
 * Dismiss a user review item (Prompt 2)
 */
router.post(
  '/:workspaceId/workspace-config/review/:index/dismiss',
  async (req: Request<WorkspaceParams & { index: string }>, res: Response) => {
    try {
      const { workspaceId, index } = req.params;

      // Get review items
      const reviewResult = await query<{ value: any }>(
        `SELECT value FROM context_layer
         WHERE workspace_id = $1 AND category = 'settings' AND key = 'config_user_review_items'`,
        [workspaceId]
      );

      const reviewItems = reviewResult.rows[0]?.value || [];
      const itemIndex = parseInt(index, 10);

      if (itemIndex < 0 || itemIndex >= reviewItems.length) {
        res.status(404).json({ error: 'Review item not found' });
        return;
      }

      // Remove from review items
      reviewItems.splice(itemIndex, 1);
      await query(
        `UPDATE context_layer
         SET value = $2::jsonb, updated_at = NOW()
         WHERE workspace_id = $1 AND category = 'settings' AND key = 'config_user_review_items'`,
        [workspaceId, JSON.stringify(reviewItems)]
      );

      res.json({ success: true, message: 'Review item dismissed' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Config Review] Error:', message);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /api/workspaces/:workspaceId/workspace-config/suggestions
 * Get config drift suggestions (Prompt 2)
 */
router.get(
  '/:workspaceId/workspace-config/suggestions',
  async (req: Request<WorkspaceParams>, res: Response) => {
    try {
      const { workspaceId } = req.params;

      const suggestions = await getConfigSuggestions(workspaceId);

      res.json({
        success: true,
        suggestions,
        count: suggestions.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Config Suggestions] Error:', message);
      res.status(500).json({ error: message });
    }
  }
);

// ============================================================================
// Config Audit History
// ============================================================================

router.get(
  '/:workspaceId/config-audit/history',
  async (req: Request<WorkspaceParams>, res: Response) => {
    try {
      const { workspaceId } = req.params;
      const limit = parseInt(req.query.limit as string) || 12;

      const history = await getAuditHistory(workspaceId, Math.min(limit, 50));

      res.json({
        success: true,
        workspace_id: workspaceId,
        runs: history,
        count: history.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Config Audit History] Error:', message);
      res.status(500).json({ error: message });
    }
  }
);

// GET /:workspaceId/workspace-config/field-options
router.get('/:workspaceId/workspace-config/field-options', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (wsCheck.rows.length === 0) { res.status(404).json({ error: 'Workspace not found' }); return; }

    // Standard fields
    const standardFields = [
      { field: 'stage', label: 'Stage', type: 'text' },
      { field: 'stage_normalized', label: 'Stage (Normalized)', type: 'text' },
      { field: 'pipeline', label: 'Pipeline', type: 'text' },
      { field: 'owner', label: 'Deal Owner', type: 'text' },
      { field: 'forecast_category', label: 'Forecast Category', type: 'text' },
      { field: 'source', label: 'Lead Source', type: 'text' },
      { field: 'amount', label: 'Amount', type: 'number' },
    ];

    // Custom fields from deals.custom_fields
    const customFieldRows = await query<{ field: string; label: string }>(
      `SELECT DISTINCT 'custom_fields.' || key as field, initcap(replace(key, '_', ' ')) as label
       FROM deals, jsonb_object_keys(custom_fields) as key
       WHERE workspace_id = $1 AND custom_fields IS NOT NULL AND custom_fields != '{}'::jsonb
       LIMIT 50`,
      [workspaceId]
    ).catch(() => ({ rows: [] as any[] }));

    const allFields = [
      ...standardFields,
      ...customFieldRows.rows.map((r: { field: string; label: string }) => ({ field: r.field, label: `Custom: ${r.label}`, type: 'text' })),
    ];

    // For fields with < 50 unique values, fetch them
    const fieldsWithValues = await Promise.all(
      allFields.map(async (f) => {
        if (f.type === 'number') return { ...f, values: [] };
        try {
          let colRef: string;
          if (f.field.startsWith('custom_fields.')) {
            const key = f.field.replace('custom_fields.', '');
            colRef = `custom_fields->>'${key}'`;
          } else {
            colRef = f.field;
          }
          const vals = await query<{ val: string; cnt: string }>(
            `SELECT DISTINCT ${colRef} as val, COUNT(*) as cnt FROM deals
             WHERE workspace_id = $1 AND ${colRef} IS NOT NULL AND ${colRef} != ''
             GROUP BY val ORDER BY cnt::int DESC LIMIT 50`,
            [workspaceId]
          ).catch(() => ({ rows: [] as any[] }));
          const withCounts = vals.rows
            .map((r: { val: string; cnt: string }) => ({ val: r.val || '(empty)', count: parseInt(r.cnt) }))
            .filter(v => v.val !== '');
          // Also check for null values
          const nullRow = await query<{ cnt: string }>(
            `SELECT COUNT(*)::text as cnt FROM deals
             WHERE workspace_id = $1 AND (${colRef} IS NULL OR ${colRef} = '')`,
            [workspaceId]
          ).catch(() => ({ rows: [{ cnt: '0' }] }));
          const nullCount = parseInt(nullRow.rows[0]?.cnt || '0');
          if (nullCount > 0) withCounts.push({ val: '(empty)', count: nullCount });
          return { ...f, values: withCounts.length < 50 ? withCounts : [] };
        } catch { return { ...f, values: [] }; }
      })
    );

    res.json({ success: true, fields: fieldsWithValues });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /:workspaceId/workspace-config/stages
router.get('/:workspaceId/workspace-config/stages', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (wsCheck.rows.length === 0) { res.status(404).json({ error: 'Workspace not found' }); return; }

    // Query distinct stages directly from deals (no stage_mappings table)
    const stageRows = await query<any>(
      `SELECT
         COALESCE(d.pipeline, 'Default') as pipeline,
         d.stage as raw_stage,
         d.stage_normalized,
         CASE WHEN d.stage_normalized IN ('closed_won', 'closed_lost') THEN false ELSE true END as is_open,
         COUNT(d.id)::int as deal_count,
         COALESCE(SUM(d.amount), 0)::numeric as total_amount,
         COUNT(d.id) FILTER (WHERE d.stage_normalized = 'closed_won')::int as won_count,
         COUNT(d.id) FILTER (WHERE d.stage_normalized = 'closed_lost')::int as lost_count
       FROM deals d
       WHERE d.workspace_id = $1 AND d.stage IS NOT NULL
       GROUP BY d.pipeline, d.stage, d.stage_normalized
       ORDER BY d.pipeline NULLS LAST, is_open DESC, d.stage`,
      [workspaceId]
    );

    const config = await configLoader.getConfig(workspaceId);
    const filters = config.tool_filters;
    const globalExcluded = filters?.global?.exclude_stages || [];
    const pipelineExcluded = filters?.metric_overrides?.pipeline_value?.exclude_stages || [];
    const winRateExcluded = filters?.metric_overrides?.win_rate?.exclude_stages || [];
    const forecastExcluded = filters?.metric_overrides?.forecast?.exclude_stages || [];

    const stages = stageRows.rows.map((s: any) => ({
      ...s,
      pipeline: s.pipeline || 'Default',
      total_amount: parseFloat(s.total_amount),
      is_excluded_from_pipeline: globalExcluded.includes(s.raw_stage) || pipelineExcluded.includes(s.raw_stage),
      is_excluded_from_win_rate: winRateExcluded.includes(s.raw_stage),
      is_excluded_from_forecast: globalExcluded.includes(s.raw_stage) || forecastExcluded.includes(s.raw_stage),
    }));

    res.json({ success: true, stages });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /:workspaceId/workspace-config/owners
router.get('/:workspaceId/workspace-config/owners', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (wsCheck.rows.length === 0) { res.status(404).json({ error: 'Workspace not found' }); return; }

    // deals.owner is name-only (no owner_email column)
    const ownerRows = await query<any>(
      `SELECT
         owner as owner_name,
         COUNT(*)::int as total_deals,
         COUNT(*) FILTER (WHERE stage_normalized NOT IN ('closed_won', 'closed_lost'))::int as open_deals,
         COALESCE(SUM(amount) FILTER (WHERE stage_normalized NOT IN ('closed_won', 'closed_lost')), 0)::numeric as open_pipeline
       FROM deals
       WHERE workspace_id = $1 AND owner IS NOT NULL
       GROUP BY owner
       ORDER BY open_deals DESC`,
      [workspaceId]
    );

    const config = await configLoader.getConfig(workspaceId);
    const excludedOwners: string[] = (config.teams?.excluded_owners as string[]) || [];
    const roles: Record<string, string> = {};

    const owners = ownerRows.rows.map((o: any) => ({
      owner_name: o.owner_name,
      total_deals: o.total_deals,
      open_deals: o.open_deals,
      open_pipeline: parseFloat(o.open_pipeline),
      is_excluded: excludedOwners.includes(o.owner_name),
      role: roles[o.owner_name] || 'AE',
    }));

    res.json({ success: true, owners });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /:workspaceId/workspace-config/preview-filter
router.post('/:workspaceId/workspace-config/preview-filter', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (wsCheck.rows.length === 0) { res.status(404).json({ error: 'Workspace not found' }); return; }

    const { rule, metric_context } = req.body as {
      rule: { field: string; operator: string; value: any };
      metric_context: string;
    };

    if (!rule || !rule.field || !rule.operator) {
      res.status(400).json({ error: 'rule.field and rule.operator are required' });
      return;
    }

    // Build filter clause for the proposed rule
    let fieldRef: string;
    if (rule.field.startsWith('custom_fields.')) {
      const key = rule.field.replace('custom_fields.', '');
      fieldRef = `custom_fields->>'${key}'`;
    } else {
      fieldRef = rule.field;
    }

    let filterClause = '';
    let filterParams: any[] = [];
    if (rule.operator === 'eq' && rule.value != null) { filterClause = `${fieldRef} = $3`; filterParams = [rule.value]; }
    else if (rule.operator === 'neq' && rule.value != null) { filterClause = `${fieldRef} != $3`; filterParams = [rule.value]; }
    else if (rule.operator === 'contains' && rule.value != null) { filterClause = `${fieldRef} ILIKE $3`; filterParams = [`%${rule.value}%`]; }
    else if (rule.operator === 'is_null') { filterClause = `${fieldRef} IS NULL`; }
    else if (rule.operator === 'is_not_null') { filterClause = `${fieldRef} IS NOT NULL`; }
    else { res.status(400).json({ error: `Unsupported operator: ${rule.operator}` }); return; }

    // For win_rate context: calculate before/after
    if (metric_context === 'win_rate') {
      const baseWhere = `workspace_id = $1 AND stage_normalized IN ('closed_won', 'closed_lost') AND amount > 0`;
      const before = await query<{ wins: string; total: string }>(
        `SELECT COUNT(*) FILTER (WHERE stage_normalized = 'closed_won')::text as wins, COUNT(*)::text as total FROM deals WHERE ${baseWhere}`,
        [workspaceId]
      );
      const bWins = parseInt(before.rows[0]?.wins || '0');
      const bTotal = parseInt(before.rows[0]?.total || '0');
      const beforeRate = bTotal > 0 ? bWins / bTotal : 0;

      const afterWhere = filterClause ? `${baseWhere} AND NOT (${filterClause})` : baseWhere;
      const after = await query<{ wins: string; total: string; affected: string }>(
        `SELECT COUNT(*) FILTER (WHERE stage_normalized = 'closed_won')::text as wins,
                COUNT(*)::text as total,
                (SELECT COUNT(*) FROM deals WHERE workspace_id = $1 AND stage_normalized IN ('closed_won', 'closed_lost') AND ${filterClause || 'false'})::text as affected
         FROM deals WHERE ${afterWhere}`,
        filterParams.length > 0 ? [workspaceId, ...filterParams, ...filterParams] : [workspaceId]
      ).catch(() => before);
      const aWins = parseInt((after as any).rows[0]?.wins || '0');
      const aTotal = parseInt((after as any).rows[0]?.total || '0');
      const afterRate = aTotal > 0 ? aWins / aTotal : 0;
      const affectedCount = parseInt((after as any).rows[0]?.affected || '0');

      const affectedAmount = await query<{ amt: string }>(
        filterClause
          ? `SELECT COALESCE(SUM(amount), 0)::text as amt FROM deals WHERE workspace_id = $1 AND stage_normalized IN ('closed_won', 'closed_lost') AND (${filterClause})`
          : `SELECT '0' as amt`,
        filterParams.length > 0 ? [workspaceId, ...filterParams] : [workspaceId]
      ).catch(() => ({ rows: [{ amt: '0' }] }));

      res.json({
        success: true,
        affected_deals: affectedCount,
        affected_amount: parseFloat(affectedAmount.rows[0]?.amt || '0'),
        metric_before: { win_rate: Math.round(beforeRate * 1000) / 1000, sample_size: bTotal },
        metric_after: { win_rate: Math.round(afterRate * 1000) / 1000, sample_size: aTotal },
        impact_description: `Removes ${affectedCount} deal(s) from win rate calculation. Win rate changes from ${(beforeRate * 100).toFixed(1)}% to ${(afterRate * 100).toFixed(1)}%.`,
      });
    } else {
      // For pipeline_value: before/after pipeline total
      const before = await query<{ amt: string; cnt: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text as amt, COUNT(*)::text as cnt FROM deals WHERE workspace_id = $1 AND stage_normalized NOT IN ('closed_won', 'closed_lost')`,
        [workspaceId]
      );
      const bAmt = parseFloat(before.rows[0]?.amt || '0');
      const bCnt = parseInt(before.rows[0]?.cnt || '0');

      const affected = await query<{ cnt: string; amt: string }>(
        filterClause
          ? `SELECT COUNT(*)::text as cnt, COALESCE(SUM(amount), 0)::text as amt FROM deals WHERE workspace_id = $1 AND stage_normalized NOT IN ('closed_won', 'closed_lost') AND (${filterClause})`
          : `SELECT '0' as cnt, '0' as amt`,
        filterParams.length > 0 ? [workspaceId, ...filterParams] : [workspaceId]
      ).catch(() => ({ rows: [{ cnt: '0', amt: '0' }] }));

      const affectedCnt = parseInt(affected.rows[0]?.cnt || '0');
      const affectedAmt = parseFloat(affected.rows[0]?.amt || '0');

      res.json({
        success: true,
        affected_deals: affectedCnt,
        affected_amount: affectedAmt,
        metric_before: { pipeline: bAmt, deal_count: bCnt },
        metric_after: { pipeline: bAmt - affectedAmt, deal_count: bCnt - affectedCnt },
        impact_description: `Removes ${affectedCnt} deal(s) ($${Math.round(affectedAmt / 1000)}K) from pipeline metrics.`,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
