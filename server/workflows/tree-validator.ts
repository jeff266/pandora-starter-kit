/**
 * Workflow Tree Validator
 *
 * Validates workflow trees before compilation. Checks structure, required
 * connections, expression syntax, and logical consistency.
 *
 * Spec: PANDORA_HEADLESS_ACTIVEPIECES_SPEC.md
 */

import {
  WorkflowTree,
  TreeStep,
  TreeTrigger,
  CompilerValidation,
  WorkflowCompilerContext,
  FieldExpression,
  ConditionExpression,
} from './types.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('TreeValidator');

export class TreeValidator {
  private errors: string[] = [];
  private warnings: string[] = [];
  private requiredConnections: Set<string> = new Set();
  private stepCount = 0;

  constructor(
    private tree: WorkflowTree,
    private context: WorkflowCompilerContext
  ) {}

  validate(): CompilerValidation {
    logger.debug('[TreeValidator] Starting validation', {
      workspaceId: this.context.workspaceId,
    });

    // Reset state
    this.errors = [];
    this.warnings = [];
    this.requiredConnections = new Set();
    this.stepCount = 0;

    // Validate tree structure
    if (!this.tree || typeof this.tree !== 'object') {
      this.errors.push('Tree must be an object');
      return this.buildResult();
    }

    // Validate version
    if (this.tree.version !== '1.0') {
      this.errors.push(`Unsupported tree version: ${this.tree.version}`);
      return this.buildResult();
    }

    // Validate trigger
    this.validateTrigger(this.tree.trigger);

    // Validate steps
    if (!Array.isArray(this.tree.steps)) {
      this.errors.push('Steps must be an array');
    } else {
      this.validateSteps(this.tree.steps);
    }

    // Validate error handler (optional)
    if (this.tree.error_handler) {
      this.validateErrorHandler(this.tree.error_handler);
    }

    // Check for required connections
    this.checkRequiredConnections();

    return this.buildResult();
  }

  private validateTrigger(trigger: TreeTrigger): void {
    if (!trigger || typeof trigger !== 'object') {
      this.errors.push('Trigger is required');
      return;
    }

    switch (trigger.type) {
      case 'action_event':
        if (!Array.isArray(trigger.config.action_types) || trigger.config.action_types.length === 0) {
          this.errors.push('action_event trigger requires at least one action_type');
        }
        if (trigger.config.severity_filter && !Array.isArray(trigger.config.severity_filter)) {
          this.errors.push('severity_filter must be an array');
        }
        if (trigger.config.source_skills && !Array.isArray(trigger.config.source_skills)) {
          this.errors.push('source_skills must be an array');
        }
        break;

      case 'schedule':
        if (!trigger.config.cron) {
          this.errors.push('schedule trigger requires cron expression');
        } else {
          this.validateCronExpression(trigger.config.cron);
        }
        if (!trigger.config.timezone) {
          this.warnings.push('schedule trigger should specify timezone (defaults to UTC)');
        }
        break;

      case 'webhook':
        if (!trigger.config.path) {
          this.errors.push('webhook trigger requires path');
        }
        if (trigger.config.method !== 'POST') {
          this.errors.push('webhook trigger only supports POST method');
        }
        break;

      case 'manual':
        // No validation needed for manual trigger
        break;

      default:
        this.errors.push(`Unknown trigger type: ${(trigger as any).type}`);
    }
  }

  private validateSteps(steps: TreeStep[], depth = 0): void {
    if (depth > 10) {
      this.errors.push('Step nesting too deep (max 10 levels)');
      return;
    }

    for (const step of steps) {
      this.stepCount++;

      if (!step.id) {
        this.errors.push('Step missing required field: id');
        continue;
      }

      if (!step.name) {
        this.errors.push(`Step ${step.id} missing required field: name`);
      }

      switch (step.type) {
        case 'crm_update':
          this.validateCRMUpdateStep(step);
          break;

        case 'slack_notify':
          this.validateSlackNotifyStep(step);
          break;

        case 'conditional':
          this.validateConditionalStep(step, depth);
          break;

        case 'delay':
          this.validateDelayStep(step);
          break;

        case 'http_request':
          this.validateHTTPStep(step);
          break;

        case 'pandora_callback':
          this.validatePandoraCallbackStep(step);
          break;

        case 'piece':
          this.validatePieceStep(step);
          break;

        default:
          this.errors.push(`Unknown step type: ${(step as any).type} in step ${(step as any).id}`);
      }

      // Validate retry config if present
      if (step.retry_config) {
        if (typeof step.retry_config.max_attempts !== 'number' || step.retry_config.max_attempts < 1) {
          this.errors.push(`Step ${step.id}: retry_config.max_attempts must be >= 1`);
        }
        if (typeof step.retry_config.delay_seconds !== 'number' || step.retry_config.delay_seconds < 0) {
          this.errors.push(`Step ${step.id}: retry_config.delay_seconds must be >= 0`);
        }
      }
    }
  }

  private validateCRMUpdateStep(step: any): void {
    if (!['hubspot', 'salesforce'].includes(step.config.connector)) {
      this.errors.push(`Step ${step.id}: connector must be 'hubspot' or 'salesforce'`);
    } else {
      // Add required connection
      const pieceName = step.config.connector === 'hubspot'
        ? '@activepieces/piece-hubspot'
        : '@activepieces/piece-salesforce';
      this.requiredConnections.add(pieceName);
    }

    if (!step.config.operation) {
      this.errors.push(`Step ${step.id}: operation is required`);
    }

    if (!step.config.field_mappings || typeof step.config.field_mappings !== 'object') {
      this.errors.push(`Step ${step.id}: field_mappings is required`);
    } else {
      // Validate field expressions
      for (const [field, value] of Object.entries(step.config.field_mappings)) {
        if (typeof value === 'string' && value.includes('{{')) {
          this.validateExpression(value as string, step.id, `field_mappings.${field}`);
        }
      }
    }
  }

  private validateSlackNotifyStep(step: any): void {
    this.requiredConnections.add('@activepieces/piece-slack');

    if (!step.config.channel) {
      this.errors.push(`Step ${step.id}: channel is required`);
    } else if (typeof step.config.channel === 'string' && step.config.channel.includes('{{')) {
      this.validateExpression(step.config.channel, step.id, 'channel');
    }

    if (!step.config.message_template) {
      this.errors.push(`Step ${step.id}: message_template is required`);
    } else {
      this.validateExpression(step.config.message_template, step.id, 'message_template');
    }
  }

  private validateConditionalStep(step: any, depth: number): void {
    if (!step.config.condition) {
      this.errors.push(`Step ${step.id}: condition is required`);
      return;
    }

    this.validateCondition(step.config.condition, step.id);

    if (!Array.isArray(step.config.if_true) || step.config.if_true.length === 0) {
      this.errors.push(`Step ${step.id}: if_true must be a non-empty array`);
    } else {
      this.validateSteps(step.config.if_true, depth + 1);
    }

    if (step.config.if_false && Array.isArray(step.config.if_false)) {
      this.validateSteps(step.config.if_false, depth + 1);
    }
  }

  private validateDelayStep(step: any): void {
    if (!step.config.duration_seconds && !step.config.until) {
      this.errors.push(`Step ${step.id}: either duration_seconds or until is required`);
    }

    if (step.config.duration_seconds && typeof step.config.duration_seconds !== 'number') {
      this.errors.push(`Step ${step.id}: duration_seconds must be a number`);
    }

    if (step.config.approval_required) {
      this.requiredConnections.add('@activepieces/piece-slack');
      if (!step.config.approval_channel) {
        this.warnings.push(`Step ${step.id}: approval_channel recommended when approval_required is true`);
      }
    }
  }

  private validateHTTPStep(step: any): void {
    const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
    if (!validMethods.includes(step.config.method)) {
      this.errors.push(`Step ${step.id}: method must be one of ${validMethods.join(', ')}`);
    }

    if (!step.config.url) {
      this.errors.push(`Step ${step.id}: url is required`);
    } else {
      this.validateExpression(step.config.url, step.id, 'url');
    }
  }

  private validatePandoraCallbackStep(step: any): void {
    if (!step.config.endpoint) {
      this.errors.push(`Step ${step.id}: endpoint is required`);
    } else {
      this.validateExpression(step.config.endpoint, step.id, 'endpoint');
    }

    if (!step.config.payload) {
      this.warnings.push(`Step ${step.id}: payload is empty`);
    }
  }

  private validatePieceStep(step: any): void {
    if (!step.config.piece_name) {
      this.errors.push(`Step ${step.id}: piece_name is required`);
    } else {
      this.requiredConnections.add(step.config.piece_name);
    }

    if (!step.config.action_name) {
      this.errors.push(`Step ${step.id}: action_name is required`);
    }

    if (!step.config.input || typeof step.config.input !== 'object') {
      this.warnings.push(`Step ${step.id}: input should be an object`);
    }
  }

  private validateCondition(condition: ConditionExpression, stepId: string): void {
    if (!condition.field) {
      this.errors.push(`Step ${stepId}: condition.field is required`);
    } else {
      this.validateExpression(condition.field, stepId, 'condition.field');
    }

    const validOperators = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains', 'exists'];
    if (!validOperators.includes(condition.operator)) {
      this.errors.push(`Step ${stepId}: condition.operator must be one of ${validOperators.join(', ')}`);
    }

    if (condition.value === undefined && condition.operator !== 'exists') {
      this.errors.push(`Step ${stepId}: condition.value is required for operator ${condition.operator}`);
    }
  }

  private validateExpression(expr: string, stepId: string, fieldName: string): void {
    // Check for variable interpolation syntax
    const matches = expr.match(/\{\{([^}]+)\}\}/g);
    if (!matches) return;

    for (const match of matches) {
      const varPath = match.slice(2, -2).trim();

      // Validate variable path format
      if (!varPath) {
        this.errors.push(`Step ${stepId}.${fieldName}: empty variable expression ${match}`);
        continue;
      }

      // Check for common typos or invalid paths
      if (!varPath.startsWith('trigger.') && !varPath.startsWith('step_') && varPath !== 'workspace_id') {
        this.warnings.push(`Step ${stepId}.${fieldName}: variable ${match} doesn't start with 'trigger.' or 'step_' - may be invalid`);
      }

      // Validate no nested braces
      if (varPath.includes('{') || varPath.includes('}')) {
        this.errors.push(`Step ${stepId}.${fieldName}: nested braces not allowed in ${match}`);
      }
    }
  }

  private validateCronExpression(cron: string): void {
    // Basic cron validation (5 or 6 fields)
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5 && parts.length !== 6) {
      this.errors.push(`Invalid cron expression: ${cron} (must have 5 or 6 fields)`);
      return;
    }

    // Validate each field (very basic - just check for allowed characters)
    const cronFieldPattern = /^[\d\-\*\/,]+$/;
    for (let i = 0; i < parts.length; i++) {
      if (!cronFieldPattern.test(parts[i])) {
        this.errors.push(`Invalid cron field ${i + 1}: ${parts[i]}`);
      }
    }
  }

  private validateErrorHandler(handler: any): void {
    if (handler.notify_channel) {
      this.requiredConnections.add('@activepieces/piece-slack');
    }

    if (handler.retry_policy) {
      if (typeof handler.retry_policy.max_attempts !== 'number' || handler.retry_policy.max_attempts < 1) {
        this.errors.push('error_handler.retry_policy.max_attempts must be >= 1');
      }

      if (!['linear', 'exponential'].includes(handler.retry_policy.backoff)) {
        this.errors.push('error_handler.retry_policy.backoff must be "linear" or "exponential"');
      }

      if (typeof handler.retry_policy.initial_delay_seconds !== 'number' || handler.retry_policy.initial_delay_seconds < 0) {
        this.errors.push('error_handler.retry_policy.initial_delay_seconds must be >= 0');
      }
    }

    if (handler.fallback_steps && Array.isArray(handler.fallback_steps)) {
      this.validateSteps(handler.fallback_steps);
    }
  }

  private checkRequiredConnections(): void {
    // Check if required connections are available in the workspace
    const availableConnectorTypes = new Set(this.context.availableConnections.keys());

    for (const pieceName of this.requiredConnections) {
      // Find the registry entry for this piece
      const registryEntry = this.context.connectorRegistry.find(
        (r) => r.piece_name === pieceName
      );

      if (!registryEntry) {
        this.warnings.push(`Piece ${pieceName} not found in connector registry`);
        continue;
      }

      // Check if gated
      if (registryEntry.gate_status === 'disabled') {
        this.errors.push(`Piece ${registryEntry.display_name} is disabled`);
        continue;
      }

      if (registryEntry.gate_status === 'gated') {
        this.warnings.push(`Piece ${registryEntry.display_name} requires ${registryEntry.gate_reason || 'higher plan'}`);
      }

      // Check if connection is available (for pieces that map to Pandora connectors)
      if (registryEntry.pandora_connector_type) {
        if (!availableConnectorTypes.has(registryEntry.pandora_connector_type)) {
          this.errors.push(
            `Required connector ${registryEntry.display_name} (${registryEntry.pandora_connector_type}) is not connected to this workspace`
          );
        }
      }
    }
  }

  private buildResult(): CompilerValidation {
    const result: CompilerValidation = {
      valid: this.errors.length === 0,
      warnings: this.warnings,
      errors: this.errors,
      required_connections: Array.from(this.requiredConnections),
      estimated_steps: this.stepCount,
    };

    logger.debug('[TreeValidator] Validation complete', {
      valid: result.valid,
      errors: result.errors.length,
      warnings: result.warnings.length,
      steps: result.estimated_steps,
    });

    return result;
  }
}
