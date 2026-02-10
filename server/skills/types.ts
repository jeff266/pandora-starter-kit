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
