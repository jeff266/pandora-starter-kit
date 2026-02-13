import { Router, Request, Response } from 'express';
import pool from '../db.js';
import { WorkflowService } from '../workflows/workflow-service.js';
import { getAvailablePieces, getConnectedPieces, getRequiredConnectionsForTree } from '../workflows/connector-registry-service.js';
import { WorkflowValidationError } from '../workflows/types.js';
import { TreeValidator } from '../workflows/tree-validator.js';

const router = Router();

let workflowService: WorkflowService | null = null;
function getWorkflowService(): WorkflowService {
  if (!workflowService) {
    workflowService = new WorkflowService(pool);
  }
  return workflowService;
}
export function setWorkflowService(svc: WorkflowService) {
  workflowService = svc;
}

router.get('/:workspaceId/workflows/meta/templates', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT * FROM workflow_templates ORDER BY popularity DESC, name ASC`
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:workspaceId/workflows/meta/templates/:templateId', async (req: Request, res: Response) => {
  try {
    const { templateId } = req.params;
    const result = await pool.query(
      `SELECT * FROM workflow_templates WHERE id = $1`,
      [templateId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: `Template ${templateId} not found` });
    }
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:workspaceId/workflows/meta/connectors', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const pieces = await getAvailablePieces(pool, workspaceId);
    res.json(pieces);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:workspaceId/workflows/meta/connectors/connected', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const pieces = await getConnectedPieces(pool, workspaceId);
    res.json(pieces);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:workspaceId/workflows', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const svc = getWorkflowService();
    const filters: any = {};
    if (req.query.status) filters.status = req.query.status as string;
    if (req.query.trigger_type) filters.trigger_type = req.query.trigger_type as string;
    if (req.query.enabled !== undefined) filters.enabled = req.query.enabled === 'true';
    if (req.query.limit) filters.limit = parseInt(req.query.limit as string, 10);
    if (req.query.offset) filters.offset = parseInt(req.query.offset as string, 10);
    const workflows = await svc.list(workspaceId, filters);
    res.json(workflows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:workspaceId/workflows/from-template', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { templateId, name, description } = req.body;
    const svc = getWorkflowService();
    const overrides: any = {};
    if (name) overrides.name = name;
    if (description) overrides.description = description;
    const workflow = await svc.createFromTemplate(workspaceId, templateId, overrides);
    res.status(201).json(workflow);
  } catch (error: any) {
    if (error instanceof WorkflowValidationError) {
      return res.status(400).json({ error: error.message, validation_errors: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

router.post('/:workspaceId/workflows', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const svc = getWorkflowService();
    const workflow = await svc.create(workspaceId, req.body);
    res.status(201).json(workflow);
  } catch (error: any) {
    if (error instanceof WorkflowValidationError) {
      return res.status(400).json({ error: error.message, validation_errors: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

router.get('/:workspaceId/workflows/:workflowId', async (req: Request, res: Response) => {
  try {
    const { workspaceId, workflowId } = req.params;
    const svc = getWorkflowService();
    const workflow = await svc.get(workspaceId, workflowId);
    res.json(workflow);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:workspaceId/workflows/:workflowId', async (req: Request, res: Response) => {
  try {
    const { workspaceId, workflowId } = req.params;
    const svc = getWorkflowService();
    const workflow = await svc.update(workspaceId, workflowId, req.body);
    res.json(workflow);
  } catch (error: any) {
    if (error instanceof WorkflowValidationError) {
      return res.status(400).json({ error: error.message, validation_errors: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:workspaceId/workflows/:workflowId', async (req: Request, res: Response) => {
  try {
    const { workspaceId, workflowId } = req.params;
    const svc = getWorkflowService();
    await svc.delete(workspaceId, workflowId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:workspaceId/workflows/:workflowId/activate', async (req: Request, res: Response) => {
  try {
    const { workflowId } = req.params;
    const svc = getWorkflowService();
    const result = await svc.activate(workflowId);
    res.json(result);
  } catch (error: any) {
    if (error instanceof WorkflowValidationError) {
      return res.status(400).json({ error: error.message, validation_errors: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

router.post('/:workspaceId/workflows/:workflowId/pause', async (req: Request, res: Response) => {
  try {
    const { workflowId } = req.params;
    const svc = getWorkflowService();
    const result = await svc.pause(workflowId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:workspaceId/workflows/:workflowId/execute', async (req: Request, res: Response) => {
  try {
    const { workflowId } = req.params;
    const { payload } = req.body;
    const svc = getWorkflowService();
    const run = await svc.execute(workflowId, payload || {});
    res.json(run);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:workspaceId/workflows/:workflowId/runs', async (req: Request, res: Response) => {
  try {
    const { workspaceId, workflowId } = req.params;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const result = await pool.query(
      `SELECT * FROM workflow_runs WHERE workflow_id = $1 AND workspace_id = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
      [workflowId, workspaceId, limit, offset]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:workspaceId/workflows/:workflowId/runs/:runId', async (req: Request, res: Response) => {
  try {
    const { workspaceId, workflowId, runId } = req.params;
    const result = await pool.query(
      `SELECT * FROM workflow_runs WHERE id = $1 AND workflow_id = $2 AND workspace_id = $3`,
      [runId, workflowId, workspaceId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: `Run ${runId} not found` });
    }
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:workspaceId/workflows/:workflowId/runs/:runId/sync', async (req: Request, res: Response) => {
  try {
    const { runId } = req.params;
    const svc = getWorkflowService();
    const run = await svc.syncRunStatus(runId);
    res.json(run);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:workspaceId/workflows/:workflowId/validate', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { tree } = req.body;
    const svc = getWorkflowService();
    const context = await svc.getCompilerContext(workspaceId);
    const validator = new TreeValidator(tree, context);
    const result = validator.validate();
    res.json(result);
  } catch (error: any) {
    if (error instanceof WorkflowValidationError) {
      return res.status(400).json({ error: error.message, validation_errors: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

export default router;
