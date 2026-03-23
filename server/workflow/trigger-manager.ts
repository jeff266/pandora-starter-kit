/**
 * Workflow Trigger Manager
 * Orchestrates workflow rule evaluation and execution
 */

import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { RuleEvaluator, type RuleContext, type ConditionJSON } from './rule-evaluator.js';
import { ActionExecutor, type WorkflowRule, type ActionResult } from './action-executor.js';

const logger = createLogger('WorkflowTriggerManager');

interface Finding {
  id: string;
  workspace_id: string;
  category: string;
  severity: string;
  title: string;
  summary: string;
  metadata: Record<string, any>;
  deal_id?: string;
}

export class WorkflowTriggerManager {
  private evaluator: RuleEvaluator;
  private executor: ActionExecutor;

  constructor() {
    this.evaluator = new RuleEvaluator();
    this.executor = new ActionExecutor();
  }

  /**
   * Called when a skill run completes
   */
  async onSkillRunComplete(skillRunId: string, workspaceId: string, findings: Finding[]): Promise<void> {
    try {
      logger.info('Skill run complete, evaluating workflow rules', {
        skill_run_id: skillRunId,
        workspace_id: workspaceId,
        findings_count: findings.length,
      });

      // Get active rules for this trigger type
      const result = await query<{
        id: string;
        workspace_id: string;
        name: string;
        trigger_skill_id: string | null;
        trigger_finding_category: string | null;
        trigger_severity: string | null;
        condition_json: ConditionJSON;
        action_type: string;
        action_payload: Record<string, any>;
        execution_mode: 'auto' | 'queue' | 'manual';
        scope: string;
        scope_filter: Record<string, any>;
      }>(
        `SELECT id, workspace_id, name, trigger_skill_id, trigger_finding_category, trigger_severity,
                condition_json, action_type, action_payload, execution_mode, scope, scope_filter
         FROM workflow_rules
         WHERE workspace_id = $1
           AND trigger_type = 'skill_run'
           AND is_active = true`,
        [workspaceId]
      );

      for (const rule of result.rows) {
        // Fire-and-forget: don't block skill completion on rule execution
        this.evaluateRuleForFindings(rule, findings, {
          type: 'skill_run',
          source_id: skillRunId,
        }).catch(error => {
          logger.error('Rule evaluation failed', {
            rule_id: rule.id,
            error: error.message,
          });
        });
      }
    } catch (error: any) {
      logger.error('Failed to process skill run workflow triggers', {
        skill_run_id: skillRunId,
        error: error.message,
      });
    }
  }

  /**
   * Called when a finding is created
   */
  async onFindingCreated(finding: Finding): Promise<void> {
    try {
      logger.info('Finding created, evaluating workflow rules', {
        finding_id: finding.id,
        workspace_id: finding.workspace_id,
        category: finding.category,
      });

      // Get active rules for this trigger type
      const result = await query<{
        id: string;
        workspace_id: string;
        name: string;
        trigger_finding_category: string | null;
        trigger_severity: string | null;
        condition_json: ConditionJSON;
        action_type: string;
        action_payload: Record<string, any>;
        execution_mode: 'auto' | 'queue' | 'manual';
        scope: string;
        scope_filter: Record<string, any>;
      }>(
        `SELECT id, workspace_id, name, trigger_finding_category, trigger_severity,
                condition_json, action_type, action_payload, execution_mode, scope, scope_filter
         FROM workflow_rules
         WHERE workspace_id = $1
           AND trigger_type = 'finding_created'
           AND is_active = true`,
        [finding.workspace_id]
      );

      for (const rule of result.rows) {
        // Check if finding matches trigger filters
        if (rule.trigger_finding_category && rule.trigger_finding_category !== finding.category) {
          continue;
        }

        if (rule.trigger_severity && rule.trigger_severity !== finding.severity) {
          continue;
        }

        // Fire-and-forget
        this.evaluateRuleForFinding(rule, finding, {
          type: 'finding_created',
          source_id: finding.id,
        }).catch(error => {
          logger.error('Rule evaluation failed', {
            rule_id: rule.id,
            finding_id: finding.id,
            error: error.message,
          });
        });
      }
    } catch (error: any) {
      logger.error('Failed to process finding created workflow triggers', {
        finding_id: finding.id,
        error: error.message,
      });
    }
  }

  /**
   * Evaluate a rule against multiple findings
   */
  private async evaluateRuleForFindings(
    rule: any,
    findings: Finding[],
    trigger: { type: string; source_id: string }
  ): Promise<void> {
    const startTime = Date.now();
    let matched = 0;
    let executed = 0;
    let failed = 0;

    for (const finding of findings) {
      // Check if finding matches trigger filters
      if (rule.trigger_finding_category && rule.trigger_finding_category !== finding.category) {
        continue;
      }

      if (rule.trigger_severity && rule.trigger_severity !== finding.severity) {
        continue;
      }

      try {
        const result = await this.evaluateRuleForFinding(rule, finding, trigger);
        if (result.matched) {
          matched++;
          if (result.executed) executed++;
        }
      } catch (error) {
        failed++;
      }
    }

    // Log execution
    const duration = Date.now() - startTime;
    await this.logExecution(rule.id, rule.workspace_id, trigger, matched, executed, failed, duration);
  }

  /**
   * Evaluate a rule against a single finding
   */
  private async evaluateRuleForFinding(
    rule: any,
    finding: Finding,
    trigger: { type: string; source_id: string }
  ): Promise<{ matched: boolean; executed: boolean }> {
    // Get deal data if finding has a deal_id
    let deal: Record<string, any> | undefined;
    if (finding.deal_id) {
      const dealResult = await query<Record<string, any>>(
        `SELECT * FROM deals WHERE id = $1`,
        [finding.deal_id]
      );
      deal = dealResult.rows[0] || undefined;
    }

    // Build context
    const context: RuleContext = {
      finding: {
        id: finding.id,
        category: finding.category,
        severity: finding.severity,
        title: finding.title,
        summary: finding.summary,
        metadata: finding.metadata,
      },
      deal: deal,
      trigger,
    };

    // Evaluate condition
    const conditionMet = this.evaluator.evaluate(rule.condition_json, context);

    if (!conditionMet) {
      return { matched: false, executed: false };
    }

    // Condition met - execute or queue action
    const workflowRule: WorkflowRule = {
      id: rule.id,
      workspace_id: rule.workspace_id,
      name: rule.name,
      action_type: rule.action_type,
      action_payload: rule.action_payload,
      execution_mode: rule.execution_mode,
    };

    // For auto mode: execute immediately
    // For queue mode: create pending action
    // For manual mode: skip
    if (rule.execution_mode === 'auto') {
      const result = await this.executor.execute(workflowRule, context);
      if (result.success) {
        await this.updateRuleTriggerCount(rule.id);
        return { matched: true, executed: true };
      } else {
        throw new Error(result.error || 'Action execution failed');
      }
    } else if (rule.execution_mode === 'queue') {
      await this.queueAction(workflowRule, context);
      await this.updateRuleTriggerCount(rule.id);
      return { matched: true, executed: false };
    }

    return { matched: true, executed: false };
  }

  /**
   * Queue an action for human-in-the-loop approval
   */
  private async queueAction(rule: WorkflowRule, context: RuleContext): Promise<void> {
    const title = this.generateActionTitle(rule, context);
    const summary = this.generateActionSummary(rule, context);

    await query(
      `INSERT INTO actions
        (workspace_id, target_deal_id, workflow_rule_id, action_type, severity,
         title, summary, execution_payload, execution_status, approval_status)
       VALUES ($1, $2, $3, $4, 'warning', $5, $6, $7, 'open', 'pending')`,
      [
        rule.workspace_id,
        context.deal?.id || null,
        rule.id,
        rule.action_type,
        title,
        summary,
        JSON.stringify({
          rule_name: rule.name,
          action_payload: rule.action_payload,
          context: {
            finding_id: context.finding?.id,
            trigger: context.trigger,
          },
        }),
      ]
    );

    logger.info('Action queued for approval', {
      rule_id: rule.id,
      deal_id: context.deal?.id,
      action_type: rule.action_type,
    });
  }

  /**
   * Generate action title
   */
  private generateActionTitle(rule: WorkflowRule, context: RuleContext): string {
    switch (rule.action_type) {
      case 'crm_field_write':
        return `Update ${rule.action_payload.field} on ${context.deal?.name || 'deal'}`;

      case 'crm_task_create':
        return `Create task: ${rule.action_payload.title_template?.substring(0, 50) || 'Task'}`;

      case 'stage_change':
        return `Change stage to ${rule.action_payload.target_stage}`;

      default:
        return `Execute ${rule.action_type}`;
    }
  }

  /**
   * Generate action summary
   */
  private generateActionSummary(rule: WorkflowRule, context: RuleContext): string {
    const parts = [`Workflow rule "${rule.name}" triggered`];

    if (context.finding) {
      parts.push(`Finding: ${context.finding.category} (${context.finding.severity})`);
      if (context.finding.summary) {
        parts.push(context.finding.summary.substring(0, 150));
      }
    }

    return parts.join(' • ');
  }

  /**
   * Update rule trigger count and timestamp
   */
  private async updateRuleTriggerCount(ruleId: string): Promise<void> {
    await query(
      `UPDATE workflow_rules
       SET trigger_count = trigger_count + 1,
           last_triggered_at = NOW()
       WHERE id = $1`,
      [ruleId]
    );
  }

  /**
   * Log workflow execution
   */
  private async logExecution(
    ruleId: string,
    workspaceId: string,
    trigger: { type: string; source_id: string },
    matched: number,
    executed: number,
    failed: number,
    duration: number
  ): Promise<void> {
    const status = failed > 0 ? 'failed' : executed > 0 ? 'success' : 'partial';

    await query(
      `INSERT INTO workflow_execution_log
        (workflow_rule_id, workspace_id, trigger_type, trigger_source_id,
         matched_records, executed_actions, failed_actions, status, execution_duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [ruleId, workspaceId, trigger.type, trigger.source_id, matched, executed, failed, status, duration]
    );
  }
}

// Singleton instance
export const workflowTriggerManager = new WorkflowTriggerManager();
