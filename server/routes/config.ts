/**
 * Workspace Configuration API
 *
 * Endpoints for managing workspace-specific configuration that overrides
 * hardcoded defaults (stage mapping, department patterns, role fields, grade thresholds).
 */

import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../middleware/permissions.js';
import {
  getWorkspaceConfig,
  updateWorkspaceConfig,
  setStageMapping,
  setDepartmentPatterns,
  setRoleFieldMappings,
  setGradeThresholds,
  ConfigValidationError,
  type WorkspaceConfig,
  type StageMapping,
  type DepartmentPatterns,
  type RoleFieldMappings,
  type GradeThresholds,
} from '../config/workspace-config.js';
import { query } from '../db.js';
import { getEnrichmentKeys, setEnrichmentKeys } from '../lib/credential-store.js';
import { getEnrichmentConfig } from '../enrichment/config.js';

const router = Router();

interface WorkspaceParams {
  workspaceId: string;
}

// ============================================================================
// GET /workspaces/:workspaceId/config
// Get full workspace configuration
// ============================================================================

router.get('/:workspaceId/config', requirePermission('config.view'), async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;

    // Verify workspace exists
    const wsResult = await query<{ id: string }>(
      'SELECT id FROM workspaces WHERE id = $1',
      [workspaceId]
    );

    if (wsResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const config = await getWorkspaceConfig(workspaceId);

    res.json({
      success: true,
      config,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Config API] Get config error:', message);
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// PUT /workspaces/:workspaceId/config
// Update workspace configuration (partial or full)
// ============================================================================

router.put('/:workspaceId/config', requirePermission('config.edit'), async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const updates = req.body as Partial<WorkspaceConfig>;
    const updatedBy = req.body.updatedBy as string | undefined;

    // Verify workspace exists
    const wsResult = await query<{ id: string }>(
      'SELECT id FROM workspaces WHERE id = $1',
      [workspaceId]
    );

    if (wsResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const newConfig = await updateWorkspaceConfig(workspaceId, updates, updatedBy);

    res.json({
      success: true,
      message: 'Configuration updated',
      config: newConfig,
    });
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      res.status(400).json({
        error: error.message,
        field: error.field,
        value: error.value,
      });
      return;
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Config API] Update config error:', message);
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// PUT /workspaces/:workspaceId/config/stage-mapping
// Set stage mapping configuration
// ============================================================================

router.put('/:workspaceId/config/stage-mapping', requirePermission('config.edit'), async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const mapping = req.body.mapping as StageMapping;
    const updatedBy = req.body.updatedBy as string | undefined;

    if (!mapping) {
      res.status(400).json({ error: 'Missing "mapping" in request body' });
      return;
    }

    await setStageMapping(workspaceId, mapping, updatedBy);

    res.json({
      success: true,
      message: 'Stage mapping updated',
      mapping,
    });
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      res.status(400).json({
        error: error.message,
        field: error.field,
        value: error.value,
      });
      return;
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Config API] Update stage mapping error:', message);
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// PUT /workspaces/:workspaceId/config/department-patterns
// Set department patterns configuration
// ============================================================================

router.put('/:workspaceId/config/department-patterns', requirePermission('config.edit'), async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const patterns = req.body.patterns as DepartmentPatterns;
    const updatedBy = req.body.updatedBy as string | undefined;

    if (!patterns) {
      res.status(400).json({ error: 'Missing "patterns" in request body' });
      return;
    }

    await setDepartmentPatterns(workspaceId, patterns, updatedBy);

    res.json({
      success: true,
      message: 'Department patterns updated',
      patterns,
    });
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      res.status(400).json({
        error: error.message,
        field: error.field,
        value: error.value,
      });
      return;
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Config API] Update department patterns error:', message);
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// PUT /workspaces/:workspaceId/config/role-field-mappings
// Set role field mappings configuration
// ============================================================================

router.put('/:workspaceId/config/role-field-mappings', requirePermission('config.edit'), async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const mappings = req.body.mappings as RoleFieldMappings;
    const updatedBy = req.body.updatedBy as string | undefined;

    if (!mappings) {
      res.status(400).json({ error: 'Missing "mappings" in request body' });
      return;
    }

    await setRoleFieldMappings(workspaceId, mappings, updatedBy);

    res.json({
      success: true,
      message: 'Role field mappings updated',
      mappings,
    });
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      res.status(400).json({
        error: error.message,
        field: error.field,
        value: error.value,
      });
      return;
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Config API] Update role field mappings error:', message);
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// PUT /workspaces/:workspaceId/config/grade-thresholds
// Set grade thresholds configuration
// ============================================================================

router.put('/:workspaceId/config/grade-thresholds', requirePermission('config.edit'), async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const thresholds = req.body.thresholds as GradeThresholds;
    const updatedBy = req.body.updatedBy as string | undefined;

    if (!thresholds) {
      res.status(400).json({ error: 'Missing "thresholds" in request body' });
      return;
    }

    await setGradeThresholds(workspaceId, thresholds, updatedBy);

    res.json({
      success: true,
      message: 'Grade thresholds updated',
      thresholds,
    });
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      res.status(400).json({
        error: error.message,
        field: error.field,
        value: error.value,
      });
      return;
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Config API] Update grade thresholds error:', message);
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// GET /workspaces/:workspaceId/config/defaults
// Get default values for all configuration options
// ============================================================================

router.get('/:workspaceId/config/defaults', requirePermission('config.view'), async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    res.json({
      success: true,
      defaults: {
        grade_thresholds: {
          A: 85,
          B: 70,
          C: 50,
          D: 30,
          F: 0,
        },
        normalized_stages: [
          'awareness',
          'qualification',
          'evaluation',
          'decision',
          'negotiation',
          'closed_won',
          'closed_lost',
        ],
        buying_roles: [
          'champion',
          'economic_buyer',
          'decision_maker',
          'executive_sponsor',
          'technical_evaluator',
          'influencer',
          'coach',
          'blocker',
          'end_user',
        ],
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Config API] Get defaults error:', message);
    res.status(500).json({ error: message });
  }
});

router.get('/:workspaceId/config/enrichment', requirePermission('config.view'), async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;

    // Get API keys from credential store
    const keys = await getEnrichmentKeys(workspaceId);

    // Get metadata (settings)
    const result = await query<{ metadata: any }>(
      `SELECT metadata FROM connections WHERE workspace_id = $1 AND connector_name = 'enrichment_config' LIMIT 1`,
      [workspaceId]
    );

    const metadata = result.rows.length > 0 ? (result.rows[0].metadata || {}) : {};

    const response = {
      apollo_api_key: !!keys.apollo_api_key,
      serper_api_key: !!keys.serper_api_key,
      linkedin_rapidapi_key: !!keys.linkedin_rapidapi_key,
      auto_enrich_on_close: metadata.auto_enrich_on_close ?? true,
      enrich_lookback_months: metadata.enrich_lookback_months ?? 6,
      cache_days: metadata.cache_days ?? 90,
    };

    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Config API] Get enrichment config error:', message);
    res.status(500).json({ error: message });
  }
});

router.put('/:workspaceId/config/enrichment', requirePermission('config.edit'), async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const body = req.body;

    const apiKeyFields = ['apollo_api_key', 'serper_api_key', 'linkedin_rapidapi_key'];
    const metadataFields = ['auto_enrich_on_close', 'enrich_lookback_months', 'cache_days'];

    // Extract API keys to update
    const newKeys: Record<string, string> = {};
    for (const field of apiKeyFields) {
      if (body[field] !== undefined && typeof body[field] === 'string' && body[field].length > 0) {
        newKeys[field] = body[field];
      }
    }

    // Extract metadata to update
    const newMetadata: Record<string, any> = {};
    for (const field of metadataFields) {
      if (body[field] !== undefined) {
        newMetadata[field] = body[field];
      }
    }

    // Update API keys using credential store
    if (Object.keys(newKeys).length > 0) {
      await setEnrichmentKeys(workspaceId, newKeys);
    }

    // Update metadata if provided
    if (Object.keys(newMetadata).length > 0) {
      const existing = await query<{ metadata: any }>(
        `SELECT metadata FROM connections WHERE workspace_id = $1 AND connector_name = 'enrichment_config' LIMIT 1`,
        [workspaceId]
      );

      const mergedMetadata = existing.rows.length > 0
        ? { ...(existing.rows[0].metadata || {}), ...newMetadata }
        : newMetadata;

      await query(
        `UPDATE connections SET metadata = $2, updated_at = NOW()
         WHERE workspace_id = $1 AND connector_name = 'enrichment_config'`,
        [workspaceId, JSON.stringify(mergedMetadata)]
      );
    }

    res.json({
      success: true,
      message: 'Enrichment configuration updated',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Config API] Update enrichment config error:', message);
    res.status(500).json({ error: message });
  }
});

export default router;
