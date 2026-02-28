import { Router, type Request, type Response } from 'express';
import { configLoader } from '../config/workspace-config-loader.js';
import { query } from '../db.js';

const router = Router();

interface WorkspaceParams {
  workspaceId: string;
}

export const CORRECTABLE_CONFIG_PATHS = new Set([
  'teams.excluded_owners',
  'thresholds.stale_deal_days',
  'thresholds.critical_stale_days',
  'thresholds.coverage_ratio',
  'thresholds.close_date_buffer_days',
  'pipelines.win_values',
  'pipelines.loss_values',
]);

// Assumes all intermediate path segments are object keys, not array indices.
// Safe for all current whitelist paths. If adding a path like "pipelines.0.x",
// this utility must be extended to handle array nodes.
function setNestedValue(obj: any, path: string, value: any): any {
  const parts = path.split('.');
  const clone = { ...obj };
  let current = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    current[parts[i]] = { ...(current[parts[i]] ?? {}) };
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
  return clone;
}

router.post('/:workspaceId/config/correct', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { config_path, new_value, finding_id } = req.body;

    if (!config_path || typeof config_path !== 'string') {
      res.status(400).json({ error: 'config_path is required' });
      return;
    }

    if (!CORRECTABLE_CONFIG_PATHS.has(config_path)) {
      res.status(400).json({
        error: `"${config_path}" is not a correctable config path`,
        correctable_paths: Array.from(CORRECTABLE_CONFIG_PATHS),
      });
      return;
    }

    if (new_value === undefined || new_value === null) {
      res.status(400).json({ error: 'new_value is required' });
      return;
    }

    const currentConfig = await configLoader.getConfig(workspaceId);
    const updatedConfig = setNestedValue(currentConfig, config_path, new_value);

    await query(
      `UPDATE context_layer
       SET definitions = jsonb_set(COALESCE(definitions, '{}'), '{workspace_config}', $2::jsonb),
           updated_at = NOW()
       WHERE workspace_id = $1`,
      [workspaceId, JSON.stringify(updatedConfig)]
    );

    configLoader.clearCache(workspaceId);

    if (finding_id) {
      await query(
        `UPDATE findings
         SET metadata = jsonb_set(COALESCE(metadata, '{}'), '{config_corrections}',
           COALESCE(metadata->'config_corrections', '[]'::jsonb) || $3::jsonb)
         WHERE id = $1 AND workspace_id = $2`,
        [finding_id, workspaceId, JSON.stringify([{ config_path, new_value, corrected_at: new Date().toISOString() }])]
      ).catch(() => {});
    }

    res.json({
      updated: true,
      config_path,
      new_value,
      message: 'Updated. Future analysis will use this setting.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ConfigCorrections] Error:', message);
    res.status(500).json({ error: message });
  }
});

export default router;
