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
