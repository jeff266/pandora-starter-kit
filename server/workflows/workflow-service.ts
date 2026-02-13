/**
 * Workflow Service
 *
 * Main service for workflow CRUD operations, activation, execution, and monitoring.
 * Accepts optional APClientInterface via dependency injection.
 */

import { Pool } from 'pg';
import {
  WorkflowTree,
  WorkflowDefinition,
  WorkflowRun,
  CreateWorkflowParams,
  CompilerOutput,
  WorkflowCompilerContext,
  APFlowDefinition,
  WorkflowValidationError,
  ConnectorRegistryEntry,
} from './types.js';
import { compileWorkflow, hashTree } from './compiler.js';
import { TreeValidator } from './tree-validator.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('WorkflowService');

export interface APClientInterface {
  createProject(params: { displayName: string; externalId: string; metadata?: Record<string, any> }): Promise<{ id: string }>;
  getProjectByExternalId(externalId: string): Promise<{ id: string } | null>;
  createFlow(params: { projectId: string; displayName: string }): Promise<{ id: string; version?: { id: string } }>;
  updateFlow(flowId: string, params: { trigger?: any; status?: 'ENABLED' | 'DISABLED' }): Promise<any>;
  getFlow(flowId: string): Promise<any>;
  listFlows(projectId: string): Promise<any[]>;
  deleteFlow(flowId: string): Promise<void>;
  getFlowRun(runId: string): Promise<{
    status: string;
    finishTime?: string;
    duration?: number;
    steps?: any;
    error?: { message: string; step?: string };
    stepsCount?: number;
  }>;
  triggerFlow(flowId: string, payload: Record<string, any>): Promise<{ id: string }>;
  listConnections(projectId: string): Promise<any[]>;
  createConnection(params: { projectId: string; externalId: string; displayName: string; pieceName: string; type: string; value: Record<string, any>; scope?: string }): Promise<any>;
  updateConnection(connectionId: string, params: { value: Record<string, any> }): Promise<any>;
  deleteConnection(connectionId: string): Promise<void>;
}

export class WorkflowService {
  constructor(
    private db: Pool,
    private apClient?: APClientInterface
  ) {}

  /**
   * Create a new workflow from a tree
   */
  async create(workspaceId: string, params: CreateWorkflowParams): Promise<WorkflowDefinition> {
    logger.info('[WorkflowService] Creating workflow', {
      workspaceId,
      name: params.name,
      trigger: params.tree.trigger.type,
    });

    // Validate tree first
    const context = await this.getCompilerContext(workspaceId);
    const validator = new TreeValidator(params.tree, context);
    const validation = validator.validate();

    if (!validation.valid) {
      throw new WorkflowValidationError(validation.errors);
    }

    // Generate slug from name
    let slug = params.slug;
    if (!slug) {
      slug = params.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }

    // Check for slug collision
    const existing = await this.db.query(
      `SELECT id FROM workflow_definitions WHERE workspace_id = $1 AND slug = $2`,
      [workspaceId, slug]
    );

    if (existing.rows.length > 0) {
      // Append timestamp to make unique
      slug = `${slug}-${Date.now()}`;
    }

    // Insert workflow definition
    const result = await this.db.query<WorkflowDefinition>(
      `
      INSERT INTO workflow_definitions (
        workspace_id, name, description, slug, tree,
        status, enabled, trigger_type, trigger_config, template_id, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
      `,
      [
        workspaceId,
        params.name,
        params.description || null,
        slug,
        JSON.stringify(params.tree),
        'draft',
        false,
        params.tree.trigger.type,
        JSON.stringify(params.tree.trigger.config),
        params.templateId || null,
        params.createdBy || null,
      ]
    );

    logger.info('[WorkflowService] Workflow created', {
      workflowId: result.rows[0].id,
      slug,
    });

    return result.rows[0];
  }

  /**
   * Get workflow by ID
   */
  async get(workspaceId: string, workflowId: string): Promise<WorkflowDefinition> {
    const result = await this.db.query<WorkflowDefinition>(
      `SELECT * FROM workflow_definitions WHERE id = $1 AND workspace_id = $2`,
      [workflowId, workspaceId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Workflow ${workflowId} not found in workspace ${workspaceId}`);
    }

    return result.rows[0];
  }

  /**
   * List workflows for workspace
   */
  async list(
    workspaceId: string,
    filters?: {
      status?: 'draft' | 'active' | 'paused' | 'error';
      trigger_type?: string;
      enabled?: boolean;
      limit?: number;
      offset?: number;
    }
  ): Promise<WorkflowDefinition[]> {
    const conditions: string[] = ['workspace_id = $1'];
    const params: any[] = [workspaceId];
    let paramIndex = 2;

    if (filters?.status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(filters.status);
    }

    if (filters?.trigger_type) {
      conditions.push(`trigger_type = $${paramIndex++}`);
      params.push(filters.trigger_type);
    }

    if (filters?.enabled !== undefined) {
      conditions.push(`enabled = $${paramIndex++}`);
      params.push(filters.enabled);
    }

    const whereClause = conditions.join(' AND ');
    const limit = filters?.limit || 100;
    const offset = filters?.offset || 0;

    const result = await this.db.query<WorkflowDefinition>(
      `
      SELECT * FROM workflow_definitions
      WHERE ${whereClause}
      ORDER BY updated_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `,
      [...params, limit, offset]
    );

    return result.rows;
  }

  /**
   * Update workflow
   */
  async update(
    workspaceId: string,
    workflowId: string,
    params: {
      name?: string;
      description?: string;
      tree?: WorkflowTree;
      trigger_config?: Record<string, any>;
    }
  ): Promise<WorkflowDefinition> {
    logger.info('[WorkflowService] Updating workflow', { workflowId });

    // Get current workflow
    const workflow = await this.get(workspaceId, workflowId);

    let tree = workflow.tree;
    let compilationHash = workflow.compilation_hash;
    let status = workflow.status;

    // If tree is updated, validate and mark for recompilation
    if (params.tree) {
      const context = await this.getCompilerContext(workspaceId);
      const validator = new TreeValidator(params.tree, context);
      const validation = validator.validate();

      if (!validation.valid) {
        throw new WorkflowValidationError(validation.errors);
      }

      tree = params.tree;
      compilationHash = null;

      // If workflow was active, require re-activation
      if (workflow.status === 'active') {
        status = 'draft';
      }
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (params.name) {
      updates.push(`name = $${paramIndex++}`);
      values.push(params.name);
    }

    if (params.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(params.description);
    }

    if (params.tree) {
      updates.push(`tree = $${paramIndex++}`);
      values.push(JSON.stringify(tree));
      updates.push(`compilation_hash = $${paramIndex++}`);
      values.push(compilationHash);
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
      updates.push(`trigger_type = $${paramIndex++}`);
      values.push(params.tree.trigger.type);
      updates.push(`trigger_config = $${paramIndex++}`);
      values.push(JSON.stringify(params.tree.trigger.config));
    }

    if (params.trigger_config) {
      updates.push(`trigger_config = $${paramIndex++}`);
      values.push(JSON.stringify(params.trigger_config));
    }

    updates.push(`updated_at = now()`);
    values.push(workflowId, workspaceId);

    const result = await this.db.query<WorkflowDefinition>(
      `
      UPDATE workflow_definitions
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex++} AND workspace_id = $${paramIndex++}
      RETURNING *
      `,
      values
    );

    logger.info('[WorkflowService] Workflow updated', { workflowId });
    return result.rows[0];
  }

  /**
   * Delete workflow
   */
  async delete(workspaceId: string, workflowId: string): Promise<void> {
    logger.info('[WorkflowService] Deleting workflow', { workflowId });

    const workflow = await this.get(workspaceId, workflowId);

    // Only allow deleting draft or paused workflows
    if (workflow.status === 'active') {
      throw new Error('Cannot delete active workflow. Pause it first.');
    }

    // Hard delete (CASCADE handles workflow_runs)
    await this.db.query(
      `DELETE FROM workflow_definitions WHERE id = $1 AND workspace_id = $2`,
      [workflowId, workspaceId]
    );

    logger.info('[WorkflowService] Workflow deleted', { workflowId });
  }

  /**
   * Activate a workflow (compile and optionally deploy to AP)
   */
  async activate(workflowId: string): Promise<{
    workflow: WorkflowDefinition;
    compiledFlow: APFlowDefinition;
  }> {
    logger.info('[WorkflowService] Activating workflow', { workflowId });

    // Get workflow (we don't have workspaceId at this level, so query without it)
    const workflowResult = await this.db.query<WorkflowDefinition>(
      `SELECT * FROM workflow_definitions WHERE id = $1`,
      [workflowId]
    );

    if (workflowResult.rows.length === 0) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const workflow = workflowResult.rows[0];

    // Build compiler context
    const context = await this.getCompilerContext(workflow.workspace_id);

    // Compile tree
    const compiled = compileWorkflow(workflow.tree, context);

    if (!compiled.validation.valid) {
      throw new WorkflowValidationError(compiled.validation.errors);
    }

    const treeHash = hashTree(workflow.tree);
    let apFlowId = workflow.ap_flow_id;
    let apFlowVersion = workflow.ap_flow_version;

    // If apClient exists, push to AP
    if (this.apClient) {
      // Ensure AP project exists
      let apProject = await this.apClient.getProjectByExternalId(workflow.workspace_id);

      if (!apProject) {
        // Get workspace name
        const wsResult = await this.db.query(
          `SELECT name FROM workspaces WHERE id = $1`,
          [workflow.workspace_id]
        );
        const workspaceName = wsResult.rows[0]?.name || 'Unnamed Workspace';

        apProject = await this.apClient.createProject({
          displayName: workspaceName,
          externalId: workflow.workspace_id,
          metadata: { pandora_workspace_id: workflow.workspace_id },
        });
      }

      if (!apFlowId) {
        // Create new AP flow
        const flow = await this.apClient.createFlow({
          projectId: apProject.id,
          displayName: workflow.name,
        });
        apFlowId = flow.id;
        apFlowVersion = flow.version?.id || 'latest';
      }

      // Update flow with compiled definition and enable it
      await this.apClient.updateFlow(apFlowId, {
        trigger: compiled.flow!.trigger,
        status: 'ENABLED',
      });
    }

    // Update workflow record
    await this.db.query(
      `
      UPDATE workflow_definitions
      SET ap_flow_id = $1,
          ap_flow_version = $2,
          compiled_at = now(),
          compilation_hash = $3,
          status = $4,
          enabled = true
      WHERE id = $5
      `,
      [apFlowId, apFlowVersion, treeHash, 'active', workflowId]
    );

    // Return updated workflow and compiled flow
    const updated = await this.db.query<WorkflowDefinition>(
      `SELECT * FROM workflow_definitions WHERE id = $1`,
      [workflowId]
    );

    logger.info('[WorkflowService] Workflow activated', { workflowId, apFlowId });

    return {
      workflow: updated.rows[0],
      compiledFlow: compiled.flow!,
    };
  }

  /**
   * Pause a workflow
   */
  async pause(workflowId: string): Promise<WorkflowDefinition> {
    logger.info('[WorkflowService] Pausing workflow', { workflowId });

    const workflowResult = await this.db.query<WorkflowDefinition>(
      `SELECT * FROM workflow_definitions WHERE id = $1`,
      [workflowId]
    );

    if (workflowResult.rows.length === 0) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const workflow = workflowResult.rows[0];

    // If apClient exists and flow is deployed, disable it
    if (this.apClient && workflow.ap_flow_id) {
      await this.apClient.updateFlow(workflow.ap_flow_id, { status: 'DISABLED' });
    }

    // Update workflow record
    await this.db.query(
      `UPDATE workflow_definitions SET status = $1, enabled = false WHERE id = $2`,
      ['paused', workflowId]
    );

    const updated = await this.db.query<WorkflowDefinition>(
      `SELECT * FROM workflow_definitions WHERE id = $1`,
      [workflowId]
    );

    logger.info('[WorkflowService] Workflow paused', { workflowId });
    return updated.rows[0];
  }

  /**
   * Execute a workflow with a payload
   */
  async execute(workflowId: string, payload: Record<string, any>): Promise<WorkflowRun> {
    logger.info('[WorkflowService] Executing workflow', { workflowId });

    const workflowResult = await this.db.query<WorkflowDefinition>(
      `SELECT * FROM workflow_definitions WHERE id = $1`,
      [workflowId]
    );

    if (workflowResult.rows.length === 0) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const workflow = workflowResult.rows[0];

    if (workflow.status !== 'active') {
      throw new Error(`Workflow ${workflowId} is not active (status: ${workflow.status})`);
    }

    if (!workflow.ap_flow_id) {
      throw new Error(`Workflow ${workflowId} not compiled to AP`);
    }

    let apRunId: string | null = null;
    let status: 'running' | 'pending' = 'pending';

    // If apClient exists, trigger the AP flow
    if (this.apClient) {
      const apRun = await this.apClient.triggerFlow(workflow.ap_flow_id, payload);
      apRunId = apRun.id;
      status = 'running';
    }

    // Create workflow run record
    const result = await this.db.query<WorkflowRun>(
      `
      INSERT INTO workflow_runs (
        workspace_id, workflow_id, ap_run_id, trigger_payload, status, started_at
      ) VALUES ($1, $2, $3, $4, $5, now())
      RETURNING *
      `,
      [workflow.workspace_id, workflowId, apRunId, JSON.stringify(payload), status]
    );

    logger.info('[WorkflowService] Workflow execution started', {
      workflowId,
      runId: result.rows[0].id,
      apRunId,
    });

    return result.rows[0];
  }

  /**
   * Sync run status from AP
   */
  async syncRunStatus(runId: string): Promise<WorkflowRun> {
    const result = await this.db.query<WorkflowRun>(
      `SELECT * FROM workflow_runs WHERE id = $1`,
      [runId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Run ${runId} not found`);
    }

    const run = result.rows[0];

    // If no apClient or no ap_run_id, return as-is
    if (!this.apClient || !run.ap_run_id) {
      return run;
    }

    // Fetch from AP
    const apRun = await this.apClient.getFlowRun(run.ap_run_id);

    // Map AP status to our status
    const statusMap: Record<string, 'running' | 'succeeded' | 'failed' | 'timeout'> = {
      RUNNING: 'running',
      SUCCEEDED: 'succeeded',
      FAILED: 'failed',
      TIMEOUT: 'timeout',
      PAUSED: 'running',
      STOPPED: 'failed',
      INTERNAL_ERROR: 'failed',
    };

    const status = statusMap[apRun.status] || 'failed';
    const completed = status !== 'running';

    // Update run record
    await this.db.query(
      `
      UPDATE workflow_runs
      SET status = $1,
          completed_at = $2,
          duration_ms = $3,
          result = $4,
          steps_completed = $5,
          error_message = $6,
          error_step = $7
      WHERE id = $8
      `,
      [
        status,
        completed && apRun.finishTime ? new Date(apRun.finishTime) : null,
        apRun.duration || null,
        apRun.steps ? JSON.stringify(apRun.steps) : null,
        apRun.stepsCount || 0,
        apRun.error?.message || null,
        apRun.error?.step || null,
        runId,
      ]
    );

    const updated = await this.db.query<WorkflowRun>(
      `SELECT * FROM workflow_runs WHERE id = $1`,
      [runId]
    );

    return updated.rows[0];
  }

  /**
   * Create workflow from template
   */
  async createFromTemplate(
    workspaceId: string,
    templateId: string,
    overrides?: { name?: string; description?: string }
  ): Promise<WorkflowDefinition> {
    logger.info('[WorkflowService] Creating workflow from template', {
      workspaceId,
      templateId,
    });

    // Fetch template
    const templateResult = await this.db.query(
      `SELECT * FROM workflow_templates WHERE id = $1`,
      [templateId]
    );

    if (templateResult.rows.length === 0) {
      throw new Error(`Template ${templateId} not found`);
    }

    const template = templateResult.rows[0];

    // Check required connectors against workspace's active connectors
    const connectedResult = await this.db.query(
      `SELECT connector_type FROM connector_configs WHERE workspace_id = $1 AND status = 'connected'`,
      [workspaceId]
    );

    const connectedTypes = new Set(connectedResult.rows.map((r: any) => r.connector_type));
    const missingConnectors = template.required_connectors.filter(
      (c: string) => !connectedTypes.has(c)
    );

    if (missingConnectors.length > 0) {
      throw new Error(
        `Missing required connectors: ${missingConnectors.join(', ')}. Please connect these services before using this template.`
      );
    }

    // Create workflow
    const name = overrides?.name || template.name;
    const workflow = await this.create(workspaceId, {
      name,
      description: overrides?.description || template.description,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      tree: template.tree,
      templateId,
    });

    // Increment template popularity
    await this.db.query(
      `UPDATE workflow_templates SET popularity = popularity + 1 WHERE id = $1`,
      [templateId]
    );

    logger.info('[WorkflowService] Workflow created from template', {
      workflowId: workflow.id,
      templateId,
    });

    return workflow;
  }

  /**
   * Get compiler context for workspace
   */
  async getCompilerContext(workspaceId: string): Promise<WorkflowCompilerContext> {
    // Query connector_registry
    const registryResult = await this.db.query<ConnectorRegistryEntry>(
      `SELECT * FROM connector_registry ORDER BY display_name`
    );

    // Query workspace's active connectors
    const connectorsResult = await this.db.query(
      `SELECT connector_type, id FROM connector_configs WHERE workspace_id = $1 AND status = 'connected'`,
      [workspaceId]
    );

    const availableConnections = new Map<string, string>();
    for (const conn of connectorsResult.rows) {
      availableConnections.set(conn.connector_type, conn.id);
    }

    // Get AP project ID (if exists)
    const workspaceResult = await this.db.query(
      `SELECT ap_project_id FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    const apProjectId = workspaceResult.rows[0]?.ap_project_id || 'pending';

    return {
      workspaceId,
      apProjectId,
      availableConnections,
      connectorRegistry: registryResult.rows,
    };
  }
}
