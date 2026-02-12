/**
 * Workspace Configuration API
 *
 * Endpoints for managing workspace-specific configuration that overrides
 * hardcoded defaults (stage mapping, department patterns, role fields, grade thresholds).
 */

import { Router, type Request, type Response } from 'express';
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

const router = Router();

interface WorkspaceParams {
  workspaceId: string;
}

// ============================================================================
// GET /workspaces/:workspaceId/config
// Get full workspace configuration
// ============================================================================

router.get('/:workspaceId/config', async (req: Request<WorkspaceParams>, res: Response) => {
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

router.put('/:workspaceId/config', async (req: Request<WorkspaceParams>, res: Response) => {
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

router.put('/:workspaceId/config/stage-mapping', async (req: Request<WorkspaceParams>, res: Response) => {
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

router.put('/:workspaceId/config/department-patterns', async (req: Request<WorkspaceParams>, res: Response) => {
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

router.put('/:workspaceId/config/role-field-mappings', async (req: Request<WorkspaceParams>, res: Response) => {
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

router.put('/:workspaceId/config/grade-thresholds', async (req: Request<WorkspaceParams>, res: Response) => {
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

router.get('/:workspaceId/config/defaults', async (req: Request<WorkspaceParams>, res: Response) => {
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

export default router;
