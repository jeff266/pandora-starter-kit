export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  skills: AgentSkillStep[];
  synthesis: {
    enabled: boolean;
    provider: 'claude' | 'deepseek';
    systemPrompt: string;
    userPromptTemplate: string;
    maxTokens?: number;
  };
  trigger: AgentTrigger;
  delivery: AgentDelivery;
  workspaceIds: string[] | 'all';
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  enabled: boolean;
  /** High-level mandate for goal-aware synthesis (STATUS / Q&A / ACTIONS briefings). */
  goal?: string;
  /** Recurring questions answered in every run briefing. */
  standing_questions?: string[];

  // Operator model fields (all optional — existing agents don't have them)
  role?: string;
  execution_mode?: 'pipeline' | 'loop' | 'auto';
  loop_config?: {
    available_skills: string[];
    max_iterations: number;
    termination: 'goal_satisfied' | 'max_iterations';
    planning_prompt?: string;
  };
  post_action_playbook?: PlaybookEntry[];
  autonomy_tier?: 1 | 2 | 3;
  promotion_history?: PromotionRecord[];
}

export interface AgentSkillStep {
  skillId: string;
  required: boolean;
  timeout_seconds?: number;
  params?: Record<string, any>;
  outputKey: string;
  cacheTtlMinutes?: number; // Cache skill output for this many minutes (default: 30)
}

export interface AgentTrigger {
  type: 'cron' | 'event' | 'manual' | 'calendar';
  cron?: string;
  event?: string;
  calendarMatch?: string;
}

export interface AgentDelivery {
  channel: 'slack' | 'email' | 'api';
  slackWebhookUrl?: string;
  slackChannel?: string;
  emailTo?: string[];
  emailSubject?: string;
  format: 'slack' | 'markdown' | 'html';
}

export interface SkillOutput {
  skillId: string;
  output: any;
  summary: string;
  tokenUsage: { compute: number; deepseek: number; claude: number } | null;
  duration: number;
  cached?: boolean; // True if output was reused from a recent run
  evidence?: import('../skills/types.js').SkillEvidence;
}

export interface AgentSkillResult {
  skillId: string;
  status: 'completed' | 'failed' | 'skipped' | 'cached';
  duration: number;
  error?: string;
}

export interface AgentRunResult {
  runId: string;
  agentId: string;
  workspaceId: string;
  status: 'completed' | 'failed' | 'partial';
  duration: number;
  skillResults: AgentSkillResult[];
  synthesizedOutput: string | null;
  tokenUsage: {
    skills: number;
    synthesis: number;
    total: number;
  };
  /** Accumulated evidence from all skills that produced it, keyed by skill outputKey */
  skillEvidence?: Record<string, import('../skills/types.js').SkillEvidence>;
}

export class AgentExecutionError extends Error {
  public cause: Error | undefined;
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'AgentExecutionError';
    this.cause = cause;
  }
}

// ============================================================================
// Operator Model Types
// ============================================================================

export interface PlaybookEntry {
  trigger: string;
  actions: PlaybookAction[];
}

export interface PlaybookAction {
  type: 'emit_action' | 'notify' | 'log_finding';
  action_type?: string;
  channel?: 'slack' | 'email';
  template?: string;
  payload_template?: Record<string, any>;
}

export interface PromotionRecord {
  from_tier: number;
  to_tier: number;
  promoted_at: string;
  promoted_by: string;
  evidence: {
    total_runs: number;
    weeks_active: number;
    approval_rate?: number;
  };
}

export interface LoopIteration {
  iteration: number;
  observation: string;
  plan: string;
  skill_executed: string | null;
  evaluation: string;
  goal_progress: 'none' | 'partial' | 'satisfied';
  tokens: number;
}

export interface LoopRunResult {
  iterations: LoopIteration[];
  termination_reason: 'goal_satisfied' | 'max_iterations' | 'token_limit' | 'error';
  total_loop_tokens: number;
  final_synthesis: string;
}
