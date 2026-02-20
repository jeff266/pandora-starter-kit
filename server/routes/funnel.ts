/**
 * Funnel Definition API Routes
 *
 * Endpoints for managing workspace-level funnel definitions:
 * - List templates
 * - Run discovery
 * - Create from template
 * - Update/patch stages
 * - Delete funnel
 */

import { Router, type Request, type Response } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { query } from '../db.js';
import { listTemplates, getTemplate } from '../funnel/templates.js';
import {
  discoverFunnel,
  getFunnelDefinition,
  saveFunnelDefinition,
  deleteFunnelDefinition,
} from '../funnel/discovery.js';
import {
  validateFunnelDefinition,
  renumberStageOrders,
  type FunnelDefinition,
  type FunnelStage,
} from '../types/funnel.js';
import { randomUUID } from 'crypto';

const router = Router();

interface WorkspaceParams {
  workspaceId: string;
}

interface TemplateParams extends WorkspaceParams {
  modelType: string;
}

/**
 * GET /api/funnel/templates
 * List all available funnel templates
 */
router.get('/templates', async (req: Request, res: Response) => {
  try {
    const templates = listTemplates();
    res.json({ success: true, templates });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Funnel Routes] List templates error:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/funnel/templates/:modelType
 * Get a specific template definition
 */
router.get('/templates/:modelType', async (req: Request<TemplateParams>, res: Response) => {
  try {
    const { modelType } = req.params;
    const template = getTemplate(modelType);

    if (!template) {
      res.status(404).json({ error: `Template not found: ${modelType}` });
      return;
    }

    res.json({ success: true, template });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Funnel Routes] Get template error:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/workspaces/:workspaceId/funnel
 * Get the workspace's current funnel definition
 */
router.get('/:workspaceId/funnel', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;

    // Validate workspace exists
    const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (wsCheck.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const funnel = await getFunnelDefinition(workspaceId);

    if (!funnel) {
      res.json({
        success: true,
        funnel: null,
        message: 'No funnel defined. Run discovery or select a template.',
      });
      return;
    }

    res.json({ success: true, funnel });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Funnel Routes] Get funnel error:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/workspaces/:workspaceId/funnel/discover
 * Run AI-assisted funnel discovery
 */
router.post('/:workspaceId/funnel/discover', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;

    // Validate workspace exists
    const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (wsCheck.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const result = await discoverFunnel(workspaceId);

    res.json({
      success: true,
      funnel: result.funnel,
      recommendation: result.recommendation,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Funnel Routes] Discovery error:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/workspaces/:workspaceId/funnel/from-template
 * Create a funnel from a template with optional customizations
 */
router.post('/:workspaceId/funnel/from-template', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { model_type, stage_overrides } = req.body as {
      model_type: string;
      stage_overrides?: Array<Partial<FunnelStage> & { id: string }>;
    };

    // Validate workspace exists
    const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (wsCheck.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    if (!model_type) {
      res.status(400).json({ error: 'model_type is required' });
      return;
    }

    const template = getTemplate(model_type);
    if (!template) {
      res.status(404).json({ error: `Template not found: ${model_type}` });
      return;
    }

    // Apply overrides
    let stages = JSON.parse(JSON.stringify(template.stages)); // deep copy

    if (stage_overrides && stage_overrides.length > 0) {
      for (const override of stage_overrides) {
        const stage = stages.find((s: FunnelStage) => s.id === override.id);
        if (stage) {
          Object.assign(stage, override);
        }
      }
    }

    const funnel = await saveFunnelDefinition(
      workspaceId,
      {
        model_type: template.model_type,
        model_label: template.model_label,
        stages,
      },
      'template'
    );

    res.json({ success: true, funnel });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Funnel Routes] From template error:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /api/workspaces/:workspaceId/funnel
 * Full update - replace the entire funnel definition
 */
router.put('/:workspaceId/funnel', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const funnelData = req.body as Partial<FunnelDefinition>;

    // Validate workspace exists
    const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (wsCheck.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    // Validate funnel definition
    const errors = validateFunnelDefinition(funnelData);
    if (errors.length > 0) {
      res.status(400).json({ error: 'Invalid funnel definition', validation_errors: errors });
      return;
    }

    const funnel = await saveFunnelDefinition(workspaceId, funnelData, 'confirmed', 'user');

    res.json({ success: true, funnel });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Funnel Routes] Update funnel error:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * PATCH /api/workspaces/:workspaceId/funnel/stages
 * Partial update - add, remove, or modify individual stages
 */
router.patch('/:workspaceId/funnel/stages', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { add, remove, update } = req.body as {
      add?: Array<Partial<FunnelStage> & { after?: string }>;
      remove?: string[];
      update?: Array<Partial<FunnelStage> & { id: string }>;
    };

    // Validate workspace exists
    const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (wsCheck.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const existing = await getFunnelDefinition(workspaceId);
    if (!existing) {
      res.status(404).json({ error: 'No funnel defined. Create one first.' });
      return;
    }

    let stages = JSON.parse(JSON.stringify(existing.stages)); // deep copy

    // Remove stages
    if (remove && remove.length > 0) {
      stages = stages.filter((s: FunnelStage) => !remove.includes(s.id));
    }

    // Update existing stages
    if (update && update.length > 0) {
      for (const upd of update) {
        const stage = stages.find((s: FunnelStage) => s.id === upd.id);
        if (stage) {
          Object.assign(stage, upd);
        }
      }
    }

    // Add new stages
    if (add && add.length > 0) {
      for (const newStage of add) {
        const after = (newStage as any).after;
        delete (newStage as any).after;

        const afterIndex = after ? stages.findIndex((s: FunnelStage) => s.id === after) : -1;
        const insertAt = afterIndex >= 0 ? afterIndex + 1 : stages.length;

        const stage: FunnelStage = {
          id: newStage.id || randomUUID(),
          label: newStage.label || 'Unnamed Stage',
          side: newStage.side || 'pre_sale',
          order: 0, // will be renumbered
          source: newStage.source || { object: 'deals', field: '', values: [] },
          description: newStage.description,
          sla_days: newStage.sla_days,
          is_required: newStage.is_required,
        };

        stages.splice(insertAt, 0, stage);
      }
    }

    // Renumber orders
    stages = renumberStageOrders(stages);

    const funnel = await saveFunnelDefinition(
      workspaceId,
      {
        ...existing,
        stages,
      },
      'confirmed',
      'user'
    );

    res.json({ success: true, funnel });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Funnel Routes] Patch stages error:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /api/workspaces/:workspaceId/funnel
 * Delete the funnel definition
 */
router.delete('/:workspaceId/funnel', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;

    // Validate workspace exists
    const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (wsCheck.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    await deleteFunnelDefinition(workspaceId);

    res.json({ success: true, message: 'Funnel definition deleted' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Funnel Routes] Delete funnel error:', message);
    res.status(500).json({ error: message });
  }
});

export default router;
