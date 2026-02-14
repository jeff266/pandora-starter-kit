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

      // Store in context_layer
      await query(
        `INSERT INTO context_layer (workspace_id, category, key, value, updated_at)
         VALUES ($1, 'settings', 'workspace_config', $2::jsonb, NOW())
         ON CONFLICT (workspace_id, category, key)
         DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
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

      // Store
      await query(
        `INSERT INTO context_layer (workspace_id, category, key, value, updated_at)
         VALUES ($1, 'settings', 'workspace_config', $2::jsonb, NOW())
         ON CONFLICT (workspace_id, category, key)
         DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
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
        `DELETE FROM context_layer
         WHERE workspace_id = $1
           AND category = 'settings'
           AND key = 'workspace_config'`,
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

export default router;
