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
  | 'operations'
  | 'enrichment'
  | 'intelligence'
  | 'scoring'
  | 'config'
  | 'data_enrichment'
  | 'custom';

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
    /** Trigger type: 'post_sync', 'on_demand', 'webhook' — accepts single string or array */
    trigger?: string | string[];
    /** Optional description of the schedule */
    description?: string;
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

  /** Evidence schema declaring the shape of evaluated_records for this skill */
  evidenceSchema?: EvidenceSchema;

  /** Keywords or phrases this skill can answer (used for routing) */
  answers_questions?: string[];

  /** True for skills created via the Skill Builder (not built-in) */
  isCustom?: boolean;

  /** True for utility skills hidden from the user-facing Skills library and agent picker */
  isUtility?: boolean;

  /** Slug of the built-in skill this custom skill replaces in the planner */
  replacesSkillId?: string;

  /** Number of successful runs — populated for custom skills only; used to guard override suppression */
  runCount?: number;

  /** Lifecycle status — 'stub' renders "Coming soon" and does not execute */
  status?: 'stub' | 'active';
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

  // --- OUTPUT PARSING ---
  /** How to parse the LLM response: 'json' | 'markdown' | 'text' */
  parseAs?: 'json' | 'markdown' | 'text';

  // --- MODEL OVERRIDE ---
  /** Override the default model for this step */
  model?: string;
}

// ============================================================================
// Skill Execution Context
// ============================================================================

export interface SkillExecutionContext {
  workspaceId: string;
  userId?: string;
  skillId: string;
  runId: string;
  scopeId?: string;
  businessContext: Record<string, any>;
  stepResults: Record<string, any>;
  params?: Record<string, any>;
  scopeFilters?: string[];

  /** Canonical per-request query scope — fiscal quarter bounds, user role,
   *  owner SQL fragment, pipeline names.  Resolved once by the runtime before
   *  any steps run; every tool reads from here instead of recomputing. */
  queryScope: import('../context/query-scope.js').QueryScope;

  /** Active pipeline config for value resolution. Tools call resolveValue(deal, pipelineConfig)
   *  instead of deal.amount so that value_field / value_formula overrides are respected.
   *  Defaults to the workspace's first pipeline (value_field: 'amount') so unconfigured
   *  workspaces are unaffected. Scope field_overrides.value_field is applied before this
   *  is set, so scoped runs automatically use the correct field. */
  pipelineConfig: import('../types/workspace-config.js').PipelineConfig;

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
export interface AppliedFilterEvidence {
  filter_id: string;
  filter_label: string;
  conditions_summary: string;
  source: string;
  confidence: number;
  confirmed: boolean;
}

export interface FindingAssumption {
  /** Methodology label — states the parameter, never hedges.
   *  Format: "[Parameter]: [Value]"
   *  e.g. "Stale threshold: 14 days without activity"
   *       "Pipeline scope: new business only"
   *       "Excluded owners: 8 accounts identified as non-reps" */
  label: string;

  /** Dot-notation path into WorkspaceConfig
   *  e.g. "teams.excluded_owners", "pipelines.stale_threshold_days" */
  config_path: string;

  /** Value currently used in the analysis */
  current_value: string | number | string[] | null;

  /** Whether a one-click correction is available */
  correctable: boolean;

  /** Short text for correction button. Null if not correctable.
   *  e.g. "Include these owners?" or "Change threshold?" */
  correction_prompt: string | null;

  /** For array configs: only the items this finding would remove (splice, not clear).
   *  For scalar configs: the new scalar value.
   *  Null = correction requires user input (opens a form/input). */
  correction_value: string | number | string[] | null;
}

export interface SkillEvidence {
  /** Each claim the narrative makes gets an evidence entry */
  claims: EvidenceClaim[];

  /** The full dataset the skill evaluated (for spreadsheet Tab 2) */
  evaluated_records: EvaluatedRecord[];

  /** What data sources contributed (for trust/transparency) */
  data_sources: DataSourceContribution[];

  /** The thresholds/parameters used (so users can see the assumptions) */
  parameters: SkillParameter[];

  /** Named filters applied to scope this analysis */
  applied_filters?: AppliedFilterEvidence[];

  /** Optional chart data to attach to the report section for this skill */
  chart_data?: import('../reports/types.js').SankeyChartData | import('../reports/types.js').ChartData;
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
// Evidence Schema (Column Definitions for WorkbookGenerator)
// ============================================================================

/**
 * Declares the shape of evaluated_records for a skill.
 * The WorkbookGenerator reads this to build spreadsheet tabs dynamically.
 */
export interface EvidenceSchema {
  /** Primary entity type this skill evaluates */
  entity_type: 'deal' | 'contact' | 'account' | 'conversation' | 'rep' | 'stage' | 'workspace';

  /** Column definitions for the data tab */
  columns: EvidenceColumnDef[];

  /** Optional Excel formulas for computed columns */
  formulas?: EvidenceFormulaDef[];
}

export interface EvidenceColumnDef {
  /** Field key matching evaluated_records.fields or top-level EvaluatedRecord properties */
  key: string;

  /** Display name for column header */
  display: string;

  /** Column format hint for rendering */
  format: 'text' | 'number' | 'currency' | 'percentage' | 'date' | 'severity' | 'boolean';
}

export interface EvidenceFormulaDef {
  /** Column key this formula populates */
  column: string;

  /** Excel formula template. Use {row} for current row, {{threshold_sheet}} for parameter sheet ref */
  excel_formula: string;

  /** Which parameter this formula depends on */
  depends_on_parameter?: string;
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

// ============================================================================
// Methodology Comparison
// Emitted by skills that compute dual forecasting methods (pipeline-conversion-rate,
// forecast-rollup, pipeline-coverage). Stored in skill_runs.output JSONB as
// result_data.methodologyComparisons[]. Only entries with severity 'notable' or
// 'alert' are surfaced in Ask Pandora and Slack.
// ============================================================================

export interface MethodologyComparisonMethod {
  /** Stable key: 'week3_conversion_rate' | 'win_rate_inverted' | 'stage_weighted_ev' | 'category_weighted_ev' */
  name: string;
  /** Human label: 'Week-3 Conversion Rate (trailing 4Q)' */
  label: string;
  value: number;
  /** 'multiplier' | 'percentage' | 'currency' */
  unit: string;
}

export interface MethodologyComparison {
  /** Stable identifier used by downstream consumers: 'required_coverage' | 'forecast_landing' | 'win_rate' */
  metric: string;
  primaryMethod: MethodologyComparisonMethod;
  secondaryMethod: MethodologyComparisonMethod;
  /** Math.abs(primary.value - secondary.value) */
  divergence: number;
  /** divergence / Math.min(primary.value, secondary.value) * 100 */
  divergencePct: number;
  /** info < 15% | notable 15–30% | alert > 30% */
  severity: 'info' | 'notable' | 'alert';
  /** 1–2 sentences from Claude. Never picks a winner. Explains the mechanism behind the gap. */
  gapExplanation: string;
  /** Name of the method Claude judges more reliable for this workspace */
  recommendedMethod: string;
  /** One sentence: why */
  recommendedRationale: string;
}

/**
 * Structured output returned by the extract-methodology-comparison compute step.
 * When the last skill step returns this shape, the runtime stores narrative as
 * result_data.narrative and methodologyComparisons as result_data.methodologyComparisons.
 */
export interface StructuredSkillOutput {
  narrative: string;
  methodologyComparisons: MethodologyComparison[];
}
