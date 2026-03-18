export type DocumentType =
  | 'monday_briefing'
  | 'weekly_business_review'
  | 'qbr'
  | 'board_deck';

export interface AtRiskDeal {
  name: string;
  amount: number;
  owner: string;
  stage: string;
  risk_score: number;
  risk_factors: string[];
  days_in_stage: number;
  close_date: string;
  recommended_action?: string;
}

export interface StaleDeal {
  name: string;
  amount: number;
  owner: string;
  stage: string;
  days_stale: number;
  last_activity_date: string;
}

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
  at_risk_deals?: AtRiskDeal[];  // Deal-risk-review: top 5 at-risk deals
  stale_deals?: StaleDeal[];     // Pipeline-hygiene: stale deals needing action
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

export type ReasoningLayer =
  | 'cause'
  | 'second_order'
  | 'third_order'
  | 'action';

export interface ReasoningNode {
  layer: ReasoningLayer;
  question: string;        // The question this node answers
  answer: string;          // The answer, evidence-backed
  evidence_skill?: string; // Which skill provided evidence
  data_gap?: boolean;      // True if answer is limited by missing data
  urgency?: 'today' | 'this_week' | 'this_month';  // Only on 'action' nodes
  chart_hint?: {           // Hint for Chart Intelligence
    type: 'bar' | 'line' | 'pie' | 'doughnut' | 'horizontalBar';
    title: string;
    data_description: string; // What data would make this chart
  };
}

export interface ReportSection {
  id: string;
  title: string;
  content: string;
  word_count: number;
  source_skills: string[];
  severity?: 'critical' | 'warning' | 'info';
  flagged_for_client?: boolean;  // Set by annotation merge later
  reasoning_tree?: ReasoningNode[];  // McKinsey-style reasoning layers
}

export interface ChartSuggestion {
  section_id: string;
  chart_type: 'bar' | 'line' | 'pie' | 'doughnut' | 'horizontalBar';
  title: string;
  data_labels: string[];
  data_values: number[];
  reasoning: string;        // Why this chart makes sense (1 sentence)
  priority: 'high' | 'medium' | 'low';
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
  chart_suggestions: ChartSuggestion[];  // AI-suggested charts per section
  hypothesis_updates?: HypothesisUpdate[];  // Hypothesis confidence changes this week

  skills_included: string[];
  skills_omitted: string[];  // No meaningful signal this week
  total_word_count: number;
  tokens_used: number;
  orchestrator_run_id: string;
}

export interface PriorContext {
  hypotheses: Array<{
    hypothesis_text: string;
    confidence: number;
    metric_key: string;
    current_value: number;
    threshold: number;
    unit: string;
    trend?: string;
  }>;
}

export interface HypothesisUpdate {
  metric_key: string;
  hypothesis_text: string;
  old_confidence: number;
  new_confidence: number;
  confidence_delta: number;
  direction: 'holding' | 'strengthening' | 'weakening' | 'confirmed' | 'refuted';
  current_value: number;
  threshold: number;
  unit: string;
  evidence_skill: string | null;
  summary: string;  // human-readable summary for report display
}

export interface IssueTreeNode {
  node_id: string;
  title: string;
  standing_question: string | null;
  mece_category: string;
  primary_skill_ids: string[];
  position: number;
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
  prior_context?: PriorContext;
  issue_tree_nodes?: IssueTreeNode[];
}
