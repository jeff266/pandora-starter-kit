export type DocumentType =
  | 'monday_briefing'
  | 'weekly_business_review'
  | 'qbr'
  | 'board_deck';

export interface SkillSummary {
  skill_id: string;
  ran_at: string;
  data_age_hours: number;
  headline: string;          // Single most important finding, ≤20 words
  key_metrics: Record<string, string | number>;
  top_findings: string[];    // Max 5, each ≤25 words
  top_actions: ActionSummary[];  // Max 3
  conflicts_with?: string[]; // skill_ids this contradicts
  has_signal: boolean;       // false = nominal, omit from Orchestrator
}

export interface ActionSummary {
  urgency: 'today' | 'this_week' | 'this_month';
  text: string;              // ≤20 words, consulting voice
  deal_name?: string;
  deal_id?: string;
  source_id?: string;        // HubSpot/Salesforce ID
  rep_name?: string;
  owner_email?: string;
}

export interface ReportSection {
  id: string;
  title: string;
  content: string;
  word_count: number;
  source_skills: string[];
  severity?: 'critical' | 'warning' | 'info';
  flagged_for_client?: boolean;  // Set by annotation merge later
}

export interface ReportDocument {
  id?: string;               // Set after DB insert
  document_type: DocumentType;
  workspace_id: string;
  agent_run_id: string;
  generated_at: string;
  week_label: string;

  headline: string;          // One sentence. The story of this week.
  sections: ReportSection[];
  actions: ActionSummary[];  // Max 5, sorted urgency then impact
  recommended_next_steps: string;  // ≤80 words, consulting voice

  skills_included: string[];
  skills_omitted: string[];  // No meaningful signal this week
  total_word_count: number;
  tokens_used: number;
  orchestrator_run_id: string;
}

export interface OrchestratorInput {
  document_type: DocumentType;
  workspace_id: string;
  agent_run_id: string;
  workspace_context: {
    company_name: string;
    week_label: string;
    days_remaining_in_quarter: number;
    attainment_pct: number | null;
    has_quota: boolean;
    prior_report_headline?: string;
    timezone?: string;
  };
  skill_summaries: SkillSummary[];
  word_budget: number;
}
