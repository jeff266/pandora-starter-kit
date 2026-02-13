/**
 * Workflow Engine Type Definitions
 *
 * Defines Pandora's abstract workflow tree format and ActivePieces mapping types.
 * Spec: PANDORA_HEADLESS_ACTIVEPIECES_SPEC.md
 */

// ============================================================================
// Workflow Tree (Pandora's abstract format)
// ============================================================================

export interface WorkflowTree {
  version: '1.0';
  trigger: TreeTrigger;
  steps: TreeStep[];
  error_handler?: TreeErrorHandler;
}

// ============================================================================
// Triggers
// ============================================================================

export type TreeTrigger =
  | ActionEventTrigger
  | ScheduleTrigger
  | WebhookTrigger
  | ManualTrigger;

export interface ActionEventTrigger {
  type: 'action_event';
  config: {
    action_types: string[];          // ['re_engage_deal', 'close_stale_deal']
    severity_filter?: string[];      // ['critical', 'warning']
    source_skills?: string[];        // ['pipeline-hygiene']
  };
}

export interface ScheduleTrigger {
  type: 'schedule';
  config: {
    cron: string;                    // '0 8 * * 1' (Monday 8am)
    timezone: string;                // 'America/New_York'
  };
}

export interface WebhookTrigger {
  type: 'webhook';
  config: {
    path: string;                    // '/workflows/{id}/trigger'
    method: 'POST';
    auth_required: boolean;
  };
}

export interface ManualTrigger {
  type: 'manual';
  config: Record<string, never>;
}

// ============================================================================
// Steps
// ============================================================================

export type TreeStep =
  | CRMUpdateStep
  | SlackNotifyStep
  | ConditionalStep
  | DelayStep
  | HTTPStep
  | PandoraCallbackStep
  | PieceStep;

export interface BaseStep {
  id: string;                        // 'step_1', 'notify_rep'
  name: string;                      // 'Update Close Date in HubSpot'
  on_error?: 'stop' | 'continue' | 'retry';
  retry_config?: {
    max_attempts: number;
    delay_seconds: number;
  };
}

export interface CRMUpdateStep extends BaseStep {
  type: 'crm_update';
  config: {
    connector: 'hubspot' | 'salesforce';
    operation: 'update_deal' | 'update_contact' | 'create_note' | 'update_stage';
    field_mappings: Record<string, string | FieldExpression>;
    // FieldExpression: '{{trigger.action.execution_payload.new_close_date}}'
  };
}

export interface SlackNotifyStep extends BaseStep {
  type: 'slack_notify';
  config: {
    channel: string | FieldExpression; // '#pipeline-critical' or '{{trigger.action.assignee_slack_channel}}'
    message_template: string;          // Supports {{variable}} interpolation
    blocks?: object[];                 // Slack Block Kit (optional)
  };
}

export interface ConditionalStep extends BaseStep {
  type: 'conditional';
  config: {
    condition: ConditionExpression;
    if_true: TreeStep[];
    if_false?: TreeStep[];
  };
}

export interface DelayStep extends BaseStep {
  type: 'delay';
  config: {
    duration_seconds?: number;
    until?: string;                  // ISO datetime expression
    approval_required?: boolean;     // Human-in-the-loop
    approval_channel?: string;       // Slack channel for approval
  };
}

export interface HTTPStep extends BaseStep {
  type: 'http_request';
  config: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: string;
    headers?: Record<string, string>;
    body?: object | string;
  };
}

export interface PandoraCallbackStep extends BaseStep {
  type: 'pandora_callback';
  config: {
    endpoint: string;                // '/api/workspaces/{{workspace_id}}/actions/{{action_id}}/complete'
    payload: Record<string, any>;
  };
}

export interface PieceStep extends BaseStep {
  type: 'piece';
  config: {
    piece_name: string;              // '@activepieces/piece-google-sheets'
    action_name: string;             // 'insert_row'
    input: Record<string, string | FieldExpression>;
    connection_name?: string;        // Uses predefined connection if omitted
  };
}

// ============================================================================
// Expressions
// ============================================================================

export type FieldExpression = `{{${string}}}`;  // Template literal for variable interpolation

export interface ConditionExpression {
  field: string;                     // '{{trigger.action.impact_amount}}'
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'exists';
  value: string | number | boolean;
}

// ============================================================================
// Error Handling
// ============================================================================

export interface TreeErrorHandler {
  notify_channel?: string;           // Slack channel for error notifications
  retry_policy?: {
    max_attempts: number;
    backoff: 'linear' | 'exponential';
    initial_delay_seconds: number;
  };
  fallback_steps?: TreeStep[];       // Steps to run if the workflow fails
}

// ============================================================================
// ActivePieces Flow Definitions (compiler output)
// ============================================================================

export interface APFlowDefinition {
  displayName: string;
  trigger: APTrigger;
}

export interface APTrigger {
  name: string;
  type: 'PIECE_TRIGGER' | 'EMPTY';
  displayName: string;
  settings: {
    pieceName?: string;
    pieceVersion?: string;
    triggerName?: string;
    input?: Record<string, any>;
  };
  nextAction?: APAction;
}

export interface APAction {
  name: string;
  type: 'PIECE' | 'BRANCH' | 'CODE';
  displayName: string;
  settings: {
    pieceName?: string;
    pieceVersion?: string;
    actionName?: string;
    input: Record<string, any>;
  };
  nextAction?: APAction;
  // For branches:
  onSuccessAction?: APAction;
  onFailureAction?: APAction;
}

// ============================================================================
// Compiler Types
// ============================================================================

export interface CompilerOutput {
  flow: APFlowDefinition | null;
  validation: CompilerValidation;
}

export interface CompilerValidation {
  valid: boolean;
  warnings: string[];              // Non-blocking issues
  errors: string[];                // Blocking issues
  required_connections: string[];  // AP piece names that need connections
  estimated_steps: number;
}

export interface WorkflowCompilerContext {
  workspaceId: string;
  apProjectId: string;
  availableConnections: Map<string, string>;  // connector_type → AP connection ID
  connectorRegistry: ConnectorRegistryEntry[];
}

// ============================================================================
// Database Models
// ============================================================================

export interface WorkflowDefinition {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  slug: string;
  tree: WorkflowTree;
  ap_flow_id: string | null;
  ap_flow_version: string | null;
  compiled_at: Date | null;
  compilation_hash: string | null;
  status: 'draft' | 'active' | 'paused' | 'error';
  enabled: boolean;
  trigger_type: 'action_event' | 'schedule' | 'webhook' | 'manual';
  trigger_config: Record<string, any>;
  template_id: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface WorkflowRun {
  id: string;
  workspace_id: string;
  workflow_id: string;
  ap_run_id: string;
  trigger_action_id: string | null;
  trigger_payload: Record<string, any> | null;
  status: 'running' | 'succeeded' | 'failed' | 'timeout';
  started_at: Date;
  completed_at: Date | null;
  duration_ms: number | null;
  result: Record<string, any> | null;
  steps_completed: number;
  steps_total: number | null;
  error_message: string | null;
  error_step: string | null;
  retry_count: number;
  created_at: Date;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  tree: WorkflowTree;
  required_connectors: string[];
  required_action_types: string[];
  icon: string | null;
  tags: string[];
  popularity: number;
  created_at: Date;
}

export interface ConnectorRegistryEntry {
  id: string;
  piece_name: string;
  display_name: string;
  pandora_connector_type: string | null;
  gate_status: 'available' | 'beta' | 'gated' | 'disabled';
  gate_reason: string | null;
  requires_plan: 'starter' | 'growth' | 'enterprise' | null;
  piece_version: string | null;
  supported_triggers: string[];
  supported_actions: string[];
  supports_oauth: boolean;
  supports_api_key: boolean;
  auth_type: string | null;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// Service Layer Types
// ============================================================================

export interface CreateWorkflowParams {
  name: string;
  description?: string;
  slug: string;
  tree: WorkflowTree;
  templateId?: string;
  createdBy?: string;
}

export interface PieceMapping {
  pieceName: string;
  authType: string;
  propsExtractor: (config: any) => Record<string, any>;
}

// ============================================================================
// ActivePieces Client Types
// ============================================================================

export interface APProject {
  id: string;
  displayName: string;
  externalId: string;
  metadata?: Record<string, any>;
}

export interface APFlow {
  id: string;
  projectId: string;
  displayName: string;
  status: 'ENABLED' | 'DISABLED';
  version: string;
}

export interface APFlowRun {
  id: string;
  flowId: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMEOUT' | 'PAUSED' | 'STOPPED';
  startTime: string;
  finishTime?: string;
  duration?: number;
  steps?: Record<string, any>;
  error?: {
    message: string;
    stack?: string;
  };
  stepsCount?: number;
}

export interface APConnection {
  id: string;
  projectId: string;
  externalId: string;
  pieceName: string;
  type: string;
  value: Record<string, any>;
  scope: 'PLATFORM' | 'PROJECT';
}

export interface APClientConfig {
  baseUrl: string;  // 'http://activepieces:3000'
  apiKey: string;   // Platform admin API key
}

// ============================================================================
// Error Types
// ============================================================================

export class WorkflowValidationError extends Error {
  constructor(public errors: string[]) {
    super(`Workflow validation failed: ${errors.join(', ')}`);
    this.name = 'WorkflowValidationError';
  }
}

export class APClientError extends Error {
  constructor(public status: number, public body: string) {
    super(`AP API error ${status}: ${body}`);
    this.name = 'APClientError';
  }
}
