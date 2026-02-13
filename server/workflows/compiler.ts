/**
 * Workflow Tree Compiler
 *
 * Compiles Pandora's abstract workflow tree format into ActivePieces flow JSON.
 * Pure function - no side effects, no API calls.
 *
 * Spec: PANDORA_HEADLESS_ACTIVEPIECES_SPEC.md
 */

import crypto from 'crypto';
import {
  WorkflowTree,
  TreeStep,
  TreeTrigger,
  APFlowDefinition,
  APTrigger,
  APAction,
  CompilerOutput,
  WorkflowCompilerContext,
  FieldExpression,
} from './types.js';
import { TreeValidator } from './tree-validator.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('WorkflowCompiler');

export function compileWorkflow(
  tree: WorkflowTree,
  context: WorkflowCompilerContext
): CompilerOutput {
  logger.debug('[Compiler] Starting compilation', {
    workspaceId: context.workspaceId,
    trigger: tree.trigger.type,
    steps: tree.steps.length,
  });

  // Validate tree first
  const validator = new TreeValidator(tree, context);
  const validation = validator.validate();

  if (!validation.valid) {
    logger.warn('[Compiler] Validation failed', {
      errors: validation.errors,
    });
    return { flow: null, validation };
  }

  // Compile tree to AP flow
  const compiler = new TreeCompiler(tree, context);
  const flow = compiler.compile();

  logger.info('[Compiler] Compilation successful', {
    displayName: flow.displayName,
    steps: validation.estimated_steps,
  });

  return { flow, validation };
}

export function hashTree(tree: WorkflowTree): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(tree))
    .digest('hex')
    .substring(0, 16);
}

class TreeCompiler {
  private actionCounter = 0;

  constructor(
    private tree: WorkflowTree,
    private context: WorkflowCompilerContext
  ) {}

  compile(): APFlowDefinition {
    // Compile trigger
    const trigger = this.compileTrigger(this.tree.trigger);

    // Compile steps into a linked list
    if (this.tree.steps.length > 0) {
      trigger.nextAction = this.compileStepChain(this.tree.steps);
    }

    return {
      displayName: '[Pandora Generated Workflow]',
      trigger,
    };
  }

  private compileTrigger(trigger: TreeTrigger): APTrigger {
    switch (trigger.type) {
      case 'action_event':
        // Action events come via Pandora's event system, not AP triggers
        // Use EMPTY trigger - execution will be manual/webhook-based
        return {
          name: 'pandora_action_trigger',
          type: 'EMPTY',
          displayName: 'Pandora Action Event',
          settings: {
            input: {
              // Store trigger config for reference
              action_types: trigger.config.action_types,
              severity_filter: trigger.config.severity_filter,
              source_skills: trigger.config.source_skills,
            },
          },
        };

      case 'schedule':
        // AP has a schedule trigger piece
        return {
          name: 'schedule_trigger',
          type: 'PIECE_TRIGGER',
          displayName: 'Schedule',
          settings: {
            pieceName: '@activepieces/piece-schedule',
            pieceVersion: 'latest',
            triggerName: 'cron',
            input: {
              cron: trigger.config.cron,
              timezone: trigger.config.timezone || 'UTC',
            },
          },
        };

      case 'webhook':
        return {
          name: 'webhook_trigger',
          type: 'PIECE_TRIGGER',
          displayName: 'Webhook',
          settings: {
            pieceName: '@activepieces/piece-webhook',
            pieceVersion: 'latest',
            triggerName: 'catch_webhook',
            input: {
              path: trigger.config.path,
            },
          },
        };

      case 'manual':
        return {
          name: 'manual_trigger',
          type: 'EMPTY',
          displayName: 'Manual Trigger',
          settings: {},
        };

      default:
        throw new Error(`Unknown trigger type: ${(trigger as any).type}`);
    }
  }

  private compileStepChain(steps: TreeStep[]): APAction | undefined {
    if (steps.length === 0) return undefined;

    let firstAction: APAction | undefined;
    let currentAction: APAction | undefined;

    for (const step of steps) {
      const action = this.compileStep(step);

      if (!firstAction) {
        firstAction = action;
        currentAction = action;
      } else {
        // Link to previous action
        currentAction!.nextAction = action;
        currentAction = action;
      }
    }

    return firstAction;
  }

  private compileStep(step: TreeStep): APAction {
    this.actionCounter++;
    const actionName = `step_${this.actionCounter}_${step.id}`;

    switch (step.type) {
      case 'crm_update':
        return this.compileCRMUpdateStep(actionName, step);

      case 'slack_notify':
        return this.compileSlackNotifyStep(actionName, step);

      case 'conditional':
        return this.compileConditionalStep(actionName, step);

      case 'delay':
        return this.compileDelayStep(actionName, step);

      case 'http_request':
        return this.compileHTTPStep(actionName, step);

      case 'pandora_callback':
        return this.compilePandoraCallbackStep(actionName, step);

      case 'piece':
        return this.compilePieceStep(actionName, step);

      default:
        throw new Error(`Unknown step type: ${(step as any).type}`);
    }
  }

  private compileCRMUpdateStep(actionName: string, step: any): APAction {
    const pieceName =
      step.config.connector === 'hubspot'
        ? '@activepieces/piece-hubspot'
        : '@activepieces/piece-salesforce';

    // Map operation to AP action name
    const actionMap: Record<string, string> = {
      update_deal: step.config.connector === 'hubspot' ? 'update_deal' : 'update_record',
      update_contact: step.config.connector === 'hubspot' ? 'update_contact' : 'update_record',
      create_note: 'create_note',
      update_stage: step.config.connector === 'hubspot' ? 'update_deal_stage' : 'update_record',
    };

    const apActionName = actionMap[step.config.operation] || step.config.operation;

    // Get connection ID
    const connectionId = this.context.availableConnections.get(step.config.connector);

    return {
      name: actionName,
      type: 'PIECE',
      displayName: step.name,
      settings: {
        pieceName,
        pieceVersion: 'latest',
        actionName: apActionName,
        input: {
          connection: connectionId,
          ...this.interpolateFieldMappings(step.config.field_mappings),
        },
      },
    };
  }

  private compileSlackNotifyStep(actionName: string, step: any): APAction {
    const connectionId = this.context.availableConnections.get('slack');

    // Determine if using blocks or simple message
    const hasBlocks = step.config.blocks && step.config.blocks.length > 0;

    return {
      name: actionName,
      type: 'PIECE',
      displayName: step.name,
      settings: {
        pieceName: '@activepieces/piece-slack',
        pieceVersion: 'latest',
        actionName: hasBlocks ? 'send_block_message' : 'send_message',
        input: {
          connection: connectionId,
          channel: this.translateExpression(step.config.channel),
          text: this.translateExpression(step.config.message_template),
          ...(hasBlocks ? { blocks: step.config.blocks } : {}),
        },
      },
    };
  }

  private compileConditionalStep(actionName: string, step: any): APAction {
    const condition = step.config.condition;

    // Build AP branch condition
    const branchCondition = this.buildBranchCondition(condition);

    const branchAction: APAction = {
      name: actionName,
      type: 'BRANCH',
      displayName: step.name,
      settings: {
        input: {
          conditions: [branchCondition],
        },
      },
    };

    // Compile if_true branch
    if (step.config.if_true && step.config.if_true.length > 0) {
      branchAction.onSuccessAction = this.compileStepChain(step.config.if_true);
    }

    // Compile if_false branch
    if (step.config.if_false && step.config.if_false.length > 0) {
      branchAction.onFailureAction = this.compileStepChain(step.config.if_false);
    }

    return branchAction;
  }

  private compileDelayStep(actionName: string, step: any): APAction {
    const input: Record<string, any> = {};

    if (step.config.duration_seconds) {
      input.delay_in_seconds = step.config.duration_seconds;
    } else if (step.config.until) {
      input.delay_until = this.translateExpression(step.config.until);
    }

    // TODO: approval_required would need custom piece or Slack interactive message
    // For now, just add a delay
    if (step.config.approval_required) {
      logger.warn('[Compiler] approval_required not yet implemented, using simple delay');
    }

    return {
      name: actionName,
      type: 'PIECE',
      displayName: step.name,
      settings: {
        pieceName: '@activepieces/piece-delay',
        pieceVersion: 'latest',
        actionName: 'delay',
        input,
      },
    };
  }

  private compileHTTPStep(actionName: string, step: any): APAction {
    return {
      name: actionName,
      type: 'PIECE',
      displayName: step.name,
      settings: {
        pieceName: '@activepieces/piece-http',
        pieceVersion: 'latest',
        actionName: 'send_request',
        input: {
          method: step.config.method,
          url: this.translateExpression(step.config.url),
          headers: step.config.headers || {},
          body: step.config.body,
        },
      },
    };
  }

  private compilePandoraCallbackStep(actionName: string, step: any): APAction {
    // Pandora callbacks are HTTP POSTs to internal endpoints
    const baseUrl = process.env.PANDORA_API_URL || 'http://localhost:3001';
    const endpoint = this.translateExpression(step.config.endpoint);

    return {
      name: actionName,
      type: 'PIECE',
      displayName: step.name,
      settings: {
        pieceName: '@activepieces/piece-http',
        pieceVersion: 'latest',
        actionName: 'send_request',
        input: {
          method: 'POST',
          url: `${baseUrl}${endpoint}`,
          headers: {
            'Content-Type': 'application/json',
            // TODO: Add internal auth header
          },
          body: step.config.payload,
        },
      },
    };
  }

  private compilePieceStep(actionName: string, step: any): APAction {
    // Get connection ID if this piece maps to a Pandora connector
    const registryEntry = this.context.connectorRegistry.find(
      (r) => r.piece_name === step.config.piece_name
    );

    let connectionId: string | undefined;
    if (registryEntry?.pandora_connector_type) {
      connectionId = this.context.availableConnections.get(registryEntry.pandora_connector_type);
    }

    return {
      name: actionName,
      type: 'PIECE',
      displayName: step.name,
      settings: {
        pieceName: step.config.piece_name,
        pieceVersion: 'latest',
        actionName: step.config.action_name,
        input: {
          ...(connectionId ? { connection: connectionId } : {}),
          ...this.interpolateFieldMappings(step.config.input),
        },
      },
    };
  }

  private buildBranchCondition(condition: any): any {
    const field = this.translateExpression(condition.field);
    const value = condition.value;

    // Map Pandora operators to AP operators
    const operatorMap: Record<string, string> = {
      eq: 'EQUALS',
      neq: 'NOT_EQUALS',
      gt: 'GREATER_THAN',
      lt: 'LESS_THAN',
      gte: 'GREATER_THAN_OR_EQUAL',
      lte: 'LESS_THAN_OR_EQUAL',
      contains: 'CONTAINS',
      exists: 'EXISTS',
    };

    return {
      firstValue: field,
      operator: operatorMap[condition.operator] || 'EQUALS',
      secondValue: value,
    };
  }

  private interpolateFieldMappings(mappings: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(mappings)) {
      if (typeof value === 'string') {
        result[key] = this.translateExpression(value);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  private translateExpression(expr: string): string {
    // Translate Pandora variable syntax to AP syntax
    // Pandora:  {{trigger.action.impact_amount}}
    // AP:       {{trigger.action.impact_amount}}
    // (For now, they're the same! AP uses the same {{}} syntax)

    // Handle workspace_id special case
    expr = expr.replace(/\{\{workspace_id\}\}/g, `{{${this.context.workspaceId}}}`);

    // Future: Add more sophisticated translation if needed
    // For example, mapping semantic field names to actual payload structure

    return expr;
  }
}
