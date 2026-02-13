/**
 * Workflow Trigger Bridge
 *
 * Connects Actions Engine to Workflow Engine. When an action is created,
 * finds and executes matching workflows.
 */

import { Pool } from 'pg';
import { WorkflowService } from './workflow-service.js';
import { WorkflowRun } from './types.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('WorkflowTrigger');

export interface ActionEvent {
  id: string;
  workspace_id: string;
  action_type: string;
  severity: 'critical' | 'warning' | 'info';
  source_skill?: string;
  title: string;
  summary: string;
  impact_amount?: number;
  impact_label?: string;
  urgency_label?: string;
  target_deal_name?: string;
  target_entity_type: string;
  target_entity_id: string;
  target_external_id: string;
  target_source: string;
  assignee?: string;
  assignee_slack_dm?: string;
  assignee_slack_channel?: string;
  recommended_steps?: any[];
  execution_payload?: Record<string, any>;
  created_at: Date;
}

/**
 * Called when a new action is created by the Actions Engine
 */
export async function onActionCreated(
  action: ActionEvent,
  workflowService: WorkflowService
): Promise<WorkflowRun[]> {
  logger.info('[WorkflowTrigger] Action created', {
    actionId: action.id,
    actionType: action.action_type,
    workspaceId: action.workspace_id,
  });

  // Find matching workflows
  const db = (workflowService as any).db as Pool;
  const workflows = await db.query(
    `
    SELECT * FROM workflow_definitions
    WHERE workspace_id = $1
      AND status = 'active'
      AND enabled = true
      AND trigger_type = 'action_event'
    `,
    [action.workspace_id]
  );

  logger.debug('[WorkflowTrigger] Found workflows', {
    count: workflows.rows.length,
  });

  // Filter by trigger config
  const matchingWorkflows = workflows.rows.filter((wf: any) => {
    const config = wf.trigger_config;

    // Check action type match
    if (!config.action_types || !config.action_types.includes(action.action_type)) {
      return false;
    }

    // Check severity filter
    if (config.severity_filter && !config.severity_filter.includes(action.severity)) {
      return false;
    }

    // Check source skills filter
    if (config.source_skills && action.source_skill) {
      if (!config.source_skills.includes(action.source_skill)) {
        return false;
      }
    }

    return true;
  });

  logger.info('[WorkflowTrigger] Matched workflows', {
    count: matchingWorkflows.length,
    workflowIds: matchingWorkflows.map((w: any) => w.id),
  });

  // Execute each matching workflow
  const runs: WorkflowRun[] = [];
  const executions = matchingWorkflows.map(async (workflow: any) => {
    try {
      // Build trigger payload
      const payload = {
        action: {
          id: action.id,
          type: action.action_type,
          severity: action.severity,
          title: action.title,
          summary: action.summary,
          impact_amount: action.impact_amount || null,
          impact_label: action.impact_label || null,
          urgency_label: action.urgency_label || null,
          target_deal_name: action.target_deal_name || null,
          target_entity_type: action.target_entity_type,
          target_entity_id: action.target_entity_id,
          target_external_id: action.target_external_id,
          target_source: action.target_source,
          assignee: action.assignee || null,
          assignee_slack_dm: action.assignee_slack_dm || null,
          assignee_slack_channel: action.assignee_slack_channel || null,
          recommended_steps: action.recommended_steps || [],
          execution_payload: action.execution_payload || {},
        },
        workspace_id: action.workspace_id,
        triggered_at: new Date().toISOString(),
      };

      const run = await workflowService.execute(workflow.id, payload);
      runs.push(run);

      logger.info('[WorkflowTrigger] Workflow executed', {
        workflowId: workflow.id,
        actionId: action.id,
        runId: run.id,
      });

      return run;
    } catch (error) {
      logger.error('[WorkflowTrigger] Workflow execution failed (non-fatal)', {
        workflowId: workflow.id,
        actionId: action.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  });

  await Promise.allSettled(executions);

  return runs;
}
