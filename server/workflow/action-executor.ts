/**
 * Action Executor
 * Executes workflow actions based on rule configuration
 */

import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { RuleContext } from './rule-evaluator.js';
import { updateDeal as updateHubSpotDeal } from '../connectors/hubspot/hubspot-writer.js';
import { updateDeal as updateSalesforceDeal } from '../connectors/salesforce/salesforce-writer.js';
import { HubSpotClient } from '../connectors/hubspot/client.js';
import { getCredentials } from '../connectors/adapters/credentials.js';
import { getActionThresholdResolver } from '../actions/threshold-resolver.js';

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

    if (!context.deal?.id || !context.deal?.crm_id) {
      return { success: false, error: 'Deal ID or CRM ID missing from context' };
    }

    // Resolve value expression
    const { RuleEvaluator } = await import('./rule-evaluator.js');
    const evaluator = new RuleEvaluator();
    const value = evaluator.resolveValueExpr(value_expr, context);

    // Get deal CRM type
    const crmType = context.deal.crm_type || 'hubspot';

    // === THRESHOLD ENFORCEMENT ===
    // Resolve write policy using ActionThresholdResolver
    const thresholdResolver = getActionThresholdResolver();
    const policy = await thresholdResolver.resolveWritePolicy(
      rule.workspace_id,
      field,
      context.deal.stage
    );

    // Block if canWrite is false
    if (!policy.canWrite) {
      logger.info('Write blocked by threshold policy', {
        workspace_id: rule.workspace_id,
        field,
        reason: policy.reason,
      });
      return {
        success: false,
        error: policy.reason || `Cannot write to ${field}`,
      };
    }

    // Handle MEDIUM threshold: queue for approval (HITL)
    if (policy.threshold === 'medium' && rule.execution_mode === 'auto') {
      return this.queueCrmFieldWrite(rule, context, field, value_expr);
    }

    // Handle LOW threshold: should have been blocked above, but defensive check
    if (policy.threshold === 'low') {
      return {
        success: false,
        error: `Field ${field} has "low" threshold - Pandora can only recommend, not write`,
      };
    }

    // === HIGH THRESHOLD: WRITE IMMEDIATELY ===
    // Get previous value for reversal capability
    const previousValueResult = await query(
      `SELECT ${field} FROM deals WHERE id = $1 AND workspace_id = $2`,
      [context.deal.id, rule.workspace_id]
    );
    const previousValue = previousValueResult.rows[0]?.[field] || null;

    // === INVERSE DIVERGENCE CHECK ===
    // If current value already matches recommended value, skip the write
    if (previousValue === value) {
      logger.info('Inverse divergence: CRM value already matches recommendation', {
        workspace_id: rule.workspace_id,
        field,
        value,
        deal_id: context.deal.id,
      });
      return {
        success: true,
        message: `${field} already matches recommended value (${value}) - no write needed`,
      };
    }

    // Build source citation
    const sourceCitation = this.buildSourceCitation(rule, context);

    const startTime = Date.now();

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

      const durationMs = Date.now() - startTime;

      // Log to crm_write_log with new threshold columns
      const logResult = await query(
        `INSERT INTO crm_write_log
          (workspace_id, crm_type, crm_object_type, crm_record_id, crm_property_name,
           value_written, trigger_source, status, duration_ms, workflow_rule_id, source_citation,
           previous_value, action_threshold_at_write, initiated_by)
         VALUES ($1, $2, 'deal', $3, $4, $5, 'workflow_rule', 'success', $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          rule.workspace_id,
          crmType,
          context.deal.crm_id,
          field,
          JSON.stringify(value),
          durationMs,
          rule.id,
          sourceCitation,
          JSON.stringify(previousValue),
          policy.threshold, // 'high'
          'workflow_rule',  // initiated_by
        ]
      );

      const writeLogId = logResult.rows[0].id;

      // Update local deal field
      await query(
        `UPDATE deals SET ${field} = $1, updated_at = NOW()
         WHERE id = $2 AND workspace_id = $3`,
        [value, context.deal.id, rule.workspace_id]
      );

      // Fire post-write actions for HIGH threshold
      if (policy.threshold === 'high') {
        // Send notification (fire and forget)
        this.sendHighThresholdNotification(
          rule.workspace_id,
          context.deal,
          field,
          previousValue,
          value,
          rule.name
        ).catch(err => {
          logger.error('Failed to send high-threshold notification', { error: err.message });
        });

        // Fire audit webhook (fire and forget)
        this.fireAuditWebhook(
          rule.workspace_id,
          writeLogId,
          {
            deal_id: context.deal.id,
            deal_name: context.deal.name,
            field,
            previous_value: previousValue,
            new_value: value,
            threshold: 'high',
            initiated_by: 'workflow_rule',
            rule_name: rule.name,
          }
        ).catch(err => {
          logger.error('Failed to fire audit webhook', { error: err.message });
        });
      }

      return {
        success: true,
        message: `Updated ${field} to ${value} on deal ${context.deal.name || context.deal.id}`,
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;

      // Log failure
      await query(
        `INSERT INTO crm_write_log
          (workspace_id, crm_type, crm_object_type, crm_record_id, crm_property_name,
           value_written, trigger_source, status, error_message, duration_ms, workflow_rule_id,
           previous_value, action_threshold_at_write, initiated_by)
         VALUES ($1, $2, 'deal', $3, $4, $5, 'workflow_rule', 'failed', $6, $7, $8, $9, $10, $11)`,
        [
          rule.workspace_id,
          crmType,
          context.deal.crm_id,
          field,
          JSON.stringify(value),
          error.message,
          durationMs,
          rule.id,
          JSON.stringify(previousValue),
          policy.threshold,
          'workflow_rule',
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

    // === INVERSE DIVERGENCE CHECK ===
    // If current value already matches recommended value, skip queuing
    const currentValue = (context.deal as any)[field] || null;
    if (currentValue === value) {
      logger.info('Inverse divergence: CRM value already matches recommendation (queue)', {
        workspace_id: rule.workspace_id,
        field,
        value,
        deal_id: context.deal.id,
      });
      return {
        success: true,
        message: `${fieldLabel} already matches recommended value (${value}) - no action needed`,
      };
    }

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
   * Generate task title from finding category
   */
  private getTaskTitleFromCategory(category: string, finding?: any): string {
    const taskTitleFromCategory: Record<string, string> = {
      'stale_deal': 'Re-engage deal — no activity in {days} days',
      'single_thread': 'Add second contact to reduce single-thread risk',
      'close_date_risk': 'Review close date — timeline may have shifted',
      'missing_amount': 'Update deal amount in CRM',
      'no_economic_buyer': 'Confirm economic buyer before advancing stage',
      'stage_velocity': 'Review deal velocity — stuck in stage',
      'meddic_coverage': 'Address MEDDIC coverage gaps',
    };

    if (taskTitleFromCategory[category]) {
      return taskTitleFromCategory[category];
    }

    // Fallback to finding message
    if (finding?.message) {
      return `Review and address: ${finding.message}`;
    }

    return 'Review and address finding';
  }

  /**
   * Execute CRM task creation
   */
  private async executeCrmTaskCreate(rule: WorkflowRule, context: RuleContext): Promise<ActionResult> {
    const { title_template, due_expr, assign_to } = rule.action_payload;

    if (!context.deal?.id || !context.deal?.crm_id) {
      return { success: false, error: 'Deal ID or CRM ID missing from context' };
    }

    // Resolve template and expressions
    const { RuleEvaluator } = await import('./rule-evaluator.js');
    const evaluator = new RuleEvaluator();

    // If title_template is missing or empty, generate from finding category
    let title: string;
    if (!title_template && context.finding?.category) {
      title = this.getTaskTitleFromCategory(context.finding.category, context.finding);
    } else if (title_template) {
      title = evaluator.resolveValueExpr(title_template, context);
    } else {
      return { success: false, error: 'Missing title_template and no finding category available' };
    }

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
    const connection = await getCredentials(workspaceId, 'hubspot');
    if (!connection) {
      throw new Error(`No HubSpot connector configured for workspace ${workspaceId}`);
    }
    if (connection.status === 'auth_expired') {
      throw new Error('HubSpot authorization has expired. Please reconnect.');
    }

    const credentials = connection.credentials;
    const client = new HubSpotClient(
      credentials.access_token || credentials.accessToken,
      workspaceId
    );

    const subject = taskData.subject || taskData.title || 'Pandora Action';
    const body = taskData.hs_task_body || taskData.body || '';
    const dueDateMs = taskData.hs_timestamp ?? undefined;

    const result = await client.createDealTask(dealId, subject, body, dueDateMs);

    if (!result.success) {
      throw new Error(`HubSpot task creation failed: ${result.error}`);
    }

    logger.info('HubSpot task created', {
      workspace_id: workspaceId,
      deal_id: dealId,
      task_id: result.taskId,
      subject,
    });
  }

  /**
   * Create Salesforce task
   */
  private async createSalesforceTask(workspaceId: string, taskData: any): Promise<void> {
    // TODO: Implement Salesforce task creation
    // POST to /services/data/vXX.0/sobjects/Task
    logger.warn('Salesforce task creation not yet implemented');
  }

  /**
   * Send notification for high-threshold write
   * Notifies to configured channel, deal owner, and manager
   */
  private async sendHighThresholdNotification(
    workspaceId: string,
    deal: any,
    field: string,
    previousValue: any,
    newValue: any,
    ruleName: string
  ): Promise<void> {
    // Get workspace action settings
    const thresholdResolver = getActionThresholdResolver();
    const settings = await thresholdResolver.getSettings(workspaceId);

    if (!settings || !settings.notify_on_auto_write) {
      return; // Notifications disabled
    }

    // Get field metadata for label
    const { getFieldByKey } = await import('../crm-writeback/pandora-fields.js');
    const fieldMeta = getFieldByKey(field);
    const fieldLabel = fieldMeta?.label || field;

    // Build notification message
    const message = [
      `:robot_face: *High-Threshold CRM Write*`,
      `*Deal:* ${deal.name || deal.id}`,
      `*Field:* ${fieldLabel}`,
      `*Previous:* ${JSON.stringify(previousValue)}`,
      `*New:* ${JSON.stringify(newValue)}`,
      `*Rule:* ${ruleName}`,
      ``,
      `You have ${settings.undo_window_hours} hours to undo this change.`,
    ].join('\n');

    // Import Slack client
    const { SlackAppClient } = await import('../notifications/slack-app-client.js');
    const slackClient = new SlackAppClient();

    // Send to configured channel
    if (settings.notify_channel) {
      try {
        await slackClient.sendMessage(workspaceId, settings.notify_channel, message);
        logger.info('Sent high-threshold notification to channel', {
          workspace_id: workspaceId,
          channel: settings.notify_channel,
        });
      } catch (error: any) {
        logger.error('Failed to send channel notification', { error: error.message });
      }
    }

    // TODO: Send DM to deal owner if notify_rep is true
    // TODO: Send DM to manager if notify_manager is true
  }

  /**
   * Fire audit webhook with HMAC signature
   */
  private async fireAuditWebhook(
    workspaceId: string,
    writeLogId: string,
    payload: Record<string, any>
  ): Promise<void> {
    // Get workspace action settings
    const thresholdResolver = getActionThresholdResolver();
    const settings = await thresholdResolver.getSettings(workspaceId);

    if (!settings || !settings.audit_webhook_enabled || !settings.audit_webhook_url) {
      return; // Webhook not configured
    }

    // Build webhook payload
    const webhookPayload = {
      event: 'crm_write',
      write_log_id: writeLogId,
      workspace_id: workspaceId,
      timestamp: new Date().toISOString(),
      data: payload,
    };

    // Sign payload with HMAC-SHA256
    const { signWebhookPayload } = await import('../utils/webhook-formatter.js');
    const signature = settings.audit_webhook_secret
      ? signWebhookPayload(webhookPayload, settings.audit_webhook_secret)
      : null;

    // Send webhook
    try {
      const response = await fetch(settings.audit_webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(signature ? { 'X-Pandora-Signature': signature } : {}),
        },
        body: JSON.stringify(webhookPayload),
      });

      if (!response.ok) {
        logger.error('Audit webhook failed', {
          status: response.status,
          url: settings.audit_webhook_url,
        });
      } else {
        logger.info('Audit webhook sent successfully', {
          workspace_id: workspaceId,
          write_log_id: writeLogId,
        });
      }
    } catch (error: any) {
      logger.error('Failed to fire audit webhook', { error: error.message });
    }
  }
}
