/**
 * Action Executor
 * Executes workflow actions based on rule configuration
 */

import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { RuleContext } from './rule-evaluator.js';
import { updateDeal as updateHubSpotDeal } from '../connectors/hubspot/hubspot-writer.js';
import { updateDeal as updateSalesforceDeal } from '../connectors/salesforce/salesforce-writer.js';

const logger = createLogger('ActionExecutor');

export interface WorkflowRule {
  id: string;
  workspace_id: string;
  name: string;
  action_type: string;
  action_payload: Record<string, any>;
  execution_mode: 'auto' | 'queue' | 'manual';
}

export interface ActionResult {
  success: boolean;
  message?: string;
  error?: string;
  action_id?: string;
}

export class ActionExecutor {
  /**
   * Execute a workflow action
   */
  async execute(rule: WorkflowRule, context: RuleContext): Promise<ActionResult> {
    try {
      // Route to specific executor based on action type
      switch (rule.action_type) {
        case 'crm_field_write':
          return await this.executeCrmFieldWrite(rule, context);

        case 'crm_task_create':
          return await this.executeCrmTaskCreate(rule, context);

        case 'slack_notify':
          return await this.executeSlackNotify(rule, context);

        case 'finding_escalate':
          return await this.executeFindingEscalate(rule, context);

        case 'contact_associate':
          return await this.executeContactAssociate(rule, context);

        case 'stage_change':
          return await this.executeStageChange(rule, context);

        default:
          return {
            success: false,
            error: `Unknown action type: ${rule.action_type}`,
          };
      }
    } catch (error: any) {
      logger.error('Action execution failed', {
        rule_id: rule.id,
        action_type: rule.action_type,
        error: error.message,
      });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Execute CRM field write
   */
  private async executeCrmFieldWrite(rule: WorkflowRule, context: RuleContext): Promise<ActionResult> {
    const { object, field, value_expr } = rule.action_payload;

    if (!object || !field || value_expr === undefined) {
      return { success: false, error: 'Missing required fields: object, field, value_expr' };
    }

    if (object !== 'deal') {
      return { success: false, error: 'Only "deal" object supported currently' };
    }

    // Check if field requires approval
    const { requiresApproval } = await import('../crm-writeback/pandora-fields.js');
    if (requiresApproval(field) && rule.execution_mode === 'auto') {
      // Force to queue mode for safety-critical fields
      return this.queueCrmFieldWrite(rule, context, field, value_expr);
    }

    if (!context.deal?.id || !context.deal?.crm_id) {
      return { success: false, error: 'Deal ID or CRM ID missing from context' };
    }

    // Resolve value expression
    const { RuleEvaluator } = await import('./rule-evaluator.js');
    const evaluator = new RuleEvaluator();
    const value = evaluator.resolveValueExpr(value_expr, context);

    // Get deal CRM type
    const crmType = context.deal.crm_type || 'hubspot';

    // Build source citation
    const sourceCitation = this.buildSourceCitation(rule, context);

    try {
      // Write to CRM
      if (crmType === 'hubspot') {
        await updateHubSpotDeal(rule.workspace_id, context.deal.crm_id, {
          [field]: value,
        });
      } else if (crmType === 'salesforce') {
        await updateSalesforceDeal(rule.workspace_id, context.deal.crm_id, {
          [field]: value,
        });
      }

      // Log to crm_write_log
      await query(
        `INSERT INTO crm_write_log
          (workspace_id, crm_type, crm_object_type, crm_record_id, crm_property_name,
           value_written, trigger_source, status, duration_ms, workflow_rule_id, source_citation)
         VALUES ($1, $2, 'deal', $3, $4, $5, 'workflow_rule', 'success', 0, $6, $7)`,
        [
          rule.workspace_id,
          crmType,
          context.deal.crm_id,
          field,
          JSON.stringify(value),
          rule.id,
          sourceCitation,
        ]
      );

      // Update local deal field
      await query(
        `UPDATE deals SET ${field} = $1, updated_at = NOW()
         WHERE id = $2 AND workspace_id = $3`,
        [value, context.deal.id, rule.workspace_id]
      );

      return {
        success: true,
        message: `Updated ${field} to ${value} on deal ${context.deal.name || context.deal.id}`,
      };
    } catch (error: any) {
      // Log failure
      await query(
        `INSERT INTO crm_write_log
          (workspace_id, crm_type, crm_object_type, crm_record_id, crm_property_name,
           value_written, trigger_source, status, error_message, duration_ms, workflow_rule_id)
         VALUES ($1, $2, 'deal', $3, $4, $5, 'workflow_rule', 'failed', $6, 0, $7)`,
        [
          rule.workspace_id,
          crmType,
          context.deal.crm_id,
          field,
          JSON.stringify(value),
          error.message,
          rule.id,
        ]
      );

      throw error;
    }
  }

  /**
   * Queue a CRM field write for approval (always_queue fields)
   */
  private async queueCrmFieldWrite(
    rule: WorkflowRule,
    context: RuleContext,
    field: string,
    value_expr: string
  ): Promise<ActionResult> {
    if (!context.deal?.id) {
      return { success: false, error: 'Deal ID missing from context' };
    }

    // Resolve value expression for display purposes
    const { RuleEvaluator } = await import('./rule-evaluator.js');
    const evaluator = new RuleEvaluator();
    const value = evaluator.resolveValueExpr(value_expr, context);

    // Get field metadata for better action title
    const { getFieldByKey } = await import('../crm-writeback/pandora-fields.js');
    const fieldMeta = getFieldByKey(field);
    const fieldLabel = fieldMeta?.label || field;

    // Create pending action
    const result = await query(
      `INSERT INTO actions
        (workspace_id, target_deal_id, workflow_rule_id, action_type, severity,
         title, summary, execution_payload, execution_status, approval_status)
       VALUES ($1, $2, $3, 'crm_field_write', 'warning', $4, $5, $6, 'open', 'pending')
       RETURNING id`,
      [
        rule.workspace_id,
        context.deal.id,
        rule.id,
        `Update ${fieldLabel}`,
        `Workflow rule "${rule.name}" recommends updating ${fieldLabel} to ${JSON.stringify(value)}`,
        JSON.stringify({
          field,
          from_value: (context.deal as any)[field] || null,
          to_value: value,
          source: 'workflow_rule',
          rule_id: rule.id,
        }),
      ]
    );

    return {
      success: true,
      message: `Queued ${fieldLabel} update for approval`,
      action_id: result.rows[0].id,
    };
  }

  /**
   * Execute CRM task creation
   */
  private async executeCrmTaskCreate(rule: WorkflowRule, context: RuleContext): Promise<ActionResult> {
    const { title_template, due_expr, assign_to } = rule.action_payload;

    if (!title_template) {
      return { success: false, error: 'Missing title_template' };
    }

    if (!context.deal?.id || !context.deal?.crm_id) {
      return { success: false, error: 'Deal ID or CRM ID missing from context' };
    }

    // Resolve template and expressions
    const { RuleEvaluator } = await import('./rule-evaluator.js');
    const evaluator = new RuleEvaluator();
    const title = evaluator.resolveValueExpr(title_template, context);
    const dueDate = due_expr ? evaluator.resolveValueExpr(due_expr, context) : null;

    // Determine assignee
    let assigneeId = null;
    if (assign_to === 'owner') {
      assigneeId = context.deal.owner_id || context.deal.hubspot_owner_id;
    } else if (assign_to) {
      assigneeId = assign_to;
    }

    const crmType = context.deal.crm_type || 'hubspot';

    try {
      // Create task in CRM
      if (crmType === 'hubspot') {
        await this.createHubSpotTask(rule.workspace_id, {
          subject: title,
          hs_task_body: this.buildSourceCitation(rule, context),
          hs_task_status: 'NOT_STARTED',
          hs_task_priority: 'MEDIUM',
          hs_timestamp: dueDate ? new Date(dueDate).getTime() : undefined,
          hubspot_owner_id: assigneeId,
          hs_task_type: 'TODO',
        }, context.deal.crm_id);
      } else if (crmType === 'salesforce') {
        await this.createSalesforceTask(rule.workspace_id, {
          Subject: title,
          Description: this.buildSourceCitation(rule, context),
          Status: 'Not Started',
          Priority: 'Normal',
          ActivityDate: dueDate,
          OwnerId: assigneeId,
          WhatId: context.deal.crm_id,
        });
      }

      return {
        success: true,
        message: `Created task: ${title}`,
      };
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Execute Slack notification
   */
  private async executeSlackNotify(rule: WorkflowRule, context: RuleContext): Promise<ActionResult> {
    const { channel_type, message_template } = rule.action_payload;

    if (!message_template) {
      return { success: false, error: 'Missing message_template' };
    }

    // Resolve template
    const { RuleEvaluator } = await import('./rule-evaluator.js');
    const evaluator = new RuleEvaluator();
    const message = evaluator.resolveValueExpr(message_template, context);

    // TODO: Implement Slack sending based on channel_type
    // For now, just log
    logger.info('Slack notification (not yet implemented)', {
      channel_type,
      message,
      rule_id: rule.id,
    });

    return {
      success: true,
      message: 'Slack notification queued (not yet implemented)',
    };
  }

  /**
   * Execute finding escalation
   */
  private async executeFindingEscalate(rule: WorkflowRule, context: RuleContext): Promise<ActionResult> {
    if (!context.finding?.id) {
      return { success: false, error: 'Finding ID missing from context' };
    }

    // Escalate finding severity
    await query(
      `UPDATE findings
       SET severity = 'act',
           escalated_at = NOW(),
           escalation_reason = $1
       WHERE id = $2`,
      [`Escalated by workflow rule: ${rule.name}`, context.finding.id]
    );

    return {
      success: true,
      message: `Escalated finding ${context.finding.id} to ACT severity`,
    };
  }

  /**
   * Execute contact association
   */
  private async executeContactAssociate(rule: WorkflowRule, context: RuleContext): Promise<ActionResult> {
    // TODO: Implement contact association logic
    logger.info('Contact association (not yet implemented)', { rule_id: rule.id });
    return {
      success: true,
      message: 'Contact association queued (not yet implemented)',
    };
  }

  /**
   * Execute stage change
   * IMPORTANT: Always forces execution_mode = 'queue' for safety
   */
  private async executeStageChange(rule: WorkflowRule, context: RuleContext): Promise<ActionResult> {
    const { target_stage } = rule.action_payload;

    if (!target_stage) {
      return { success: false, error: 'Missing target_stage' };
    }

    if (!context.deal?.id) {
      return { success: false, error: 'Deal ID missing from context' };
    }

    // Stage changes ALWAYS go to approval queue
    // Create pending action instead of executing directly
    const result = await query(
      `INSERT INTO actions
        (workspace_id, target_deal_id, workflow_rule_id, action_type, severity,
         title, summary, execution_payload, execution_status, approval_status)
       VALUES ($1, $2, $3, 'update_stage', 'warning', $4, $5, $6, 'open', 'pending')
       RETURNING id`,
      [
        rule.workspace_id,
        context.deal.id,
        rule.id,
        `Change stage to ${target_stage}`,
        `Workflow rule "${rule.name}" recommends moving this deal to ${target_stage}`,
        JSON.stringify({
          from_value: context.deal.stage,
          to_value: target_stage,
          source: 'workflow_rule',
          rule_id: rule.id,
        }),
      ]
    );

    return {
      success: true,
      message: `Queued stage change action for approval`,
      action_id: result.rows[0].id,
    };
  }

  /**
   * Build source citation for CRM writes
   */
  private buildSourceCitation(rule: WorkflowRule, context: RuleContext): string {
    const parts = [
      `Written by Pandora`,
      `Workflow: ${rule.name}`,
    ];

    if (context.finding) {
      parts.push(`Finding: ${context.finding.category}`);
      if (context.finding.summary) {
        parts.push(`Evidence: ${context.finding.summary.substring(0, 100)}`);
      }
    }

    if (context.trigger?.source_id) {
      parts.push(`Trigger ID: ${context.trigger.source_id}`);
    }

    return parts.join(' | ');
  }

  /**
   * Create HubSpot task
   */
  private async createHubSpotTask(workspaceId: string, taskData: any, dealId: string): Promise<void> {
    // TODO: Implement HubSpot task creation
    // POST to /crm/v3/objects/tasks with task data
    // Then associate task to deal: POST /crm/v3/objects/tasks/{taskId}/associations/deals/{dealId}/TODO
    logger.warn('HubSpot task creation not yet implemented');
  }

  /**
   * Create Salesforce task
   */
  private async createSalesforceTask(workspaceId: string, taskData: any): Promise<void> {
    // TODO: Implement Salesforce task creation
    // POST to /services/data/vXX.0/sobjects/Task
    logger.warn('Salesforce task creation not yet implemented');
  }
}
