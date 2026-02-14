/**
 * Skill Framework Type Definitions
 *
 * A Skill is a declarative definition of an AI-powered analysis or action.
 * Skills define WHAT to do, not HOW - the runtime interprets and executes them.
 *
 * Three-Tier AI Model:
 * - COMPUTE (Tier 1): Free deterministic functions (SQL queries, calculations)
 * - DEEPSEEK (Tier 2): Bulk extraction via Fireworks API (low cost, high volume)
 * - CLAUDE (Tier 3): Strategic reasoning via Anthropic API (high cost, high value)
 */

export type AITier = 'compute' | 'deepseek' | 'claude';

export type SkillCategory =
  | 'pipeline'
  | 'deals'
  | 'accounts'
  | 'calls'
  | 'forecasting'
  | 'reporting'
  | 'operations';

export type SkillOutputFormat = 'slack' | 'markdown' | 'json' | 'structured';

export type SkillStatus = 'completed' | 'failed' | 'partial';

// ============================================================================
// Skill Definition
// ============================================================================

export interface SkillDefinition {
  /** Unique identifier: 'pipeline-hygiene', 'deal-risk-review' */
  id: string;

  /** Display name: 'Pipeline Hygiene Check' */
  name: string;

  /** What this skill does (also used as agent instruction) */
  description: string;

  /** Semantic versioning */
  version: string;

  /** Skill category for organization */
  category: SkillCategory;

  /** Primary AI tier (can be 'mixed' if using multiple tiers) */
  tier: AITier | 'mixed';

  /** Tool IDs required for execution */
  requiredTools: string[];

  /** Optional tool IDs (nice-to-have) */
  optionalTools?: string[];

  /** Context sections needed: ['business_model', 'goals_and_targets'] */
  requiredContext: string[];

  /** Execution steps (run in dependency order) */
  steps: SkillStep[];

  /** Scheduling configuration */
  schedule?: {
    /** Cron expression: '0 8 * * 1' (Monday 8 AM) */
    cron?: string;
    /** Trigger type: 'post_sync', 'on_demand', 'webhook' */
    trigger?: string;
  };

  /** Time-scoping configuration (overridable at runtime) */
  timeConfig?: {
    /** Primary analysis window for deal queries */
    analysisWindow?: 'current_quarter' | 'current_month' | 'trailing_90d' | 'trailing_30d' | 'trailing_7d' | 'all_time';
    /** Window for detecting changes/deltas */
    changeWindow?: 'since_last_run' | 'last_7d' | 'last_14d' | 'last_30d';
    /** Period comparison mode */
    trendComparison?: 'previous_period' | 'same_period_last_quarter' | 'none';
  };

  /** How to format the output */
  outputFormat: SkillOutputFormat;

  /** Slack template ID (if outputFormat is 'slack') */
  slackTemplate?: string;

  /** Estimated execution duration */
  estimatedDuration: string;
}

// ============================================================================
// Skill Step
// ============================================================================

export interface SkillStep {
  /** Unique step ID within skill: 'gather-data', 'analyze' */
  id: string;

  /** Human-readable step name */
  name: string;

  /** Which AI tier executes this step */
  tier: AITier;

  /** Step IDs that must complete before this one */
  dependsOn?: string[];

  /** Key to store result in execution context */
  outputKey: string;

  // --- COMPUTE STEP ---
  /** Function name from compute registry */
  computeFn?: string;
  /** Arguments to pass to compute function */
  computeArgs?: Record<string, any>;

  // --- DEEPSEEK STEP ---
  /** Prompt template with {{variable}} placeholders */
  deepseekPrompt?: string;
  /** JSON schema for structured output */
  deepseekSchema?: Record<string, any>;

  // --- CLAUDE STEP ---
  /** Prompt template with {{variable}} placeholders */
  claudePrompt?: string;
  /** Tool IDs Claude can call in this step */
  claudeTools?: string[];
  /** Maximum tool calls before breaking loop (default: 10) */
  maxToolCalls?: number;
  /** Maximum tokens for LLM response (default: 4096) */
  maxTokens?: number;
}

// ============================================================================
// Skill Execution Context
// ============================================================================

export interface SkillExecutionContext {
  /** Workspace executing this skill */
  workspaceId: string;

  /** Skill being executed */
  skillId: string;

  /** Unique run ID (UUID) */
  runId: string;

  /** Business context from context layer */
  businessContext: Record<string, any>;

  /** Accumulated results from completed steps */
  stepResults: Record<string, any>;

  /** Execution metadata */
  metadata: {
    startedAt: Date;
    tokenUsage: {
      compute: number;
      deepseek: number;
      claude: number;
    };
    toolCallCount: number;
    errors: Array<{
      step: string;
      error: string;
    }>;
  };
}

// ============================================================================
// "Show the Work" Evidence Schema
// ============================================================================

/**
 * Structured evidence array that powers "Show the Work" feature:
 * - Slack messages with inline deal lists under each claim
 * - Command Center drill-through from insight → specific records
 * - Downloadable spreadsheets where every metric is a formula
 */
export interface SkillEvidence {
  /** Each claim the narrative makes gets an evidence entry */
  claims: EvidenceClaim[];

  /** The full dataset the skill evaluated (for spreadsheet Tab 2) */
  evaluated_records: EvaluatedRecord[];

  /** What data sources contributed (for trust/transparency) */
  data_sources: DataSourceContribution[];

  /** The thresholds/parameters used (so users can see the assumptions) */
  parameters: SkillParameter[];
}

export interface EvidenceClaim {
  /** Unique ID for claim matching: e.g. "stale_deals" */
  claim_id: string;

  /** The claim text: "4 deals worth $380K are stale" */
  claim_text: string;

  /** Entity type this claim references */
  entity_type: 'deal' | 'contact' | 'account' | 'conversation';

  /** UUIDs of the specific records supporting this claim */
  entity_ids: string[];

  /** Metric name: "days_since_activity", "deal_amount", etc. */
  metric_name: string;

  /** Metric values: [41, 34, 67, 28] — one per entity */
  metric_values: (number | string | null)[];

  /** Threshold applied: "30 days", ">$50K", etc. */
  threshold_applied: string;

  /** Severity level */
  severity: 'critical' | 'warning' | 'info';
}

export interface EvaluatedRecord {
  /** Entity UUID */
  entity_id: string;

  /** Entity type */
  entity_type: 'deal' | 'contact' | 'account' | 'conversation';

  /** Display name */
  entity_name: string;

  /** Owner email */
  owner_email: string | null;

  /** Owner name */
  owner_name: string | null;

  /** Skill-specific fields as key-value pairs */
  fields: Record<string, string | number | boolean | null>;

  /** Computed flags (stale, past_due, single_threaded, etc.) */
  flags: Record<string, string>;

  /** Overall severity for this record */
  severity: 'critical' | 'warning' | 'healthy';
}

export interface DataSourceContribution {
  /** Source name: "salesforce", "gong", "fireflies", "hubspot" */
  source: string;

  /** Whether this source is connected */
  connected: boolean;

  /** Last sync timestamp (ISO format) */
  last_sync: string | null;

  /** Total records available from this source */
  records_available: number;

  /** Records this skill actually queried/used */
  records_used: number;

  /** Optional note: e.g. "Not connected — call data incomplete" */
  note?: string;
}

export interface SkillParameter {
  /** Internal parameter name: "stale_threshold_days" */
  name: string;

  /** Display name: "Stale Threshold (days)" */
  display_name: string;

  /** Current value */
  value: number | string | boolean;

  /** What this parameter controls */
  description: string;

  /** Whether user can change in workspace settings */
  configurable: boolean;
}

// ============================================================================
// Skill Result
// ============================================================================

export interface SkillStepResult {
  stepId: string;
  status: 'completed' | 'failed';
  tier: AITier;
  duration_ms: number;
  tokenUsage: number;
  error?: string;
}

export interface SkillResult {
  /** Unique run ID */
  runId: string;

  /** Skill that was executed */
  skillId: string;

  /** Workspace */
  workspaceId: string;

  /** Overall execution status */
  status: SkillStatus;

  /** Final skill output */
  output: any;

  /** Output format */
  outputFormat: SkillOutputFormat;

  /** Per-step execution details */
  steps: SkillStepResult[];

  /** All step results keyed by outputKey (for structured data persistence) */
  stepData?: Record<string, any>;

  /** Total execution time */
  totalDuration_ms: number;

  /** Total token usage by tier */
  totalTokenUsage: {
    compute: number;
    deepseek: number;
    claude: number;
  };

  /** When execution completed */
  completedAt: Date;

  /** Execution errors (if any) */
  errors?: Array<{
    step: string;
    error: string;
  }>;

  /** Structured evidence for "Show the Work" */
  evidence?: SkillEvidence;
}

// ============================================================================
// Tool Definition for Agent Runtime
// ============================================================================

export interface ToolDefinition {
  /** Tool name: 'queryDeals', 'getPipelineSummary' */
  name: string;

  /** Description for Claude to understand when to use it */
  description: string;

  /** Which tier executes this tool */
  tier: AITier;

  /** JSON Schema for parameters */
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      items?: any;
    }>;
    required: string[];
  };

  /** Execute the tool */
  execute: (params: any, context: SkillExecutionContext) => Promise<any>;
}

// ============================================================================
// DeepSeek Client Types
// ============================================================================

export interface DeepSeekConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export interface DeepSeekResponse {
  text: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ============================================================================
// Claude Tool Use Types (for agent runtime)
// ============================================================================

export interface ClaudeToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required: string[];
  };
}

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | Array<ClaudeTextBlock | ClaudeToolUseBlock | ClaudeToolResultBlock>;
}

export interface ClaudeTextBlock {
  type: 'text';
  text: string;
}

export interface ClaudeToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, any>;
}

export interface ClaudeToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

export interface ClaudeResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<ClaudeTextBlock | ClaudeToolUseBlock>;
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'tool_use';
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}
