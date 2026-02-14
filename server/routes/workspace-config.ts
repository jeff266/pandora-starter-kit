/**
 * Workspace Configuration Layer API
 *
 * Central configuration endpoints for workspace-specific settings that replace
 * hardcoded skill assumptions (pipelines, win rates, thresholds, teams, activities).
 */

import { Router, type Request, type Response } from 'express';
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
      const sectionData = req.body;

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
      ];

      if (!validSections.includes(section)) {
        res.status(400).json({
          error: `Invalid section: ${section}`,
          valid_sections: validSections,
        });
        return;
      }

      const updated = {
        ...existing,
        [section]: sectionData,
        updated_at: new Date(),
      };

      // Validate
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

export default router;
