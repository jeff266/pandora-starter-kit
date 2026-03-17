/**
 * Annotation types for Report Document paragraph-level annotations
 * Used by Phase 3a annotation layer
 */

export interface Annotation {
  id: string;
  workspace_id: string;
  report_document_id: string;
  section_id: string;
  paragraph_index: number;
  annotation_type: 'note' | 'override' | 'flag';
  content: string;
  original_content?: string;
  created_at: string;
  updated_at: string;
}

export interface ReportSection {
  id: string;
  title: string;
  content: string;
  word_count: number;
  source_skills: string[];
  severity: 'critical' | 'warning' | 'info';
  flagged_for_client: boolean;
}

export interface ReportDocument {
  id?: string;
  document_type: string;
  workspace_id: string;
  agent_run_id: string;
  generated_at: string;
  week_label: string;
  headline: string;
  sections: ReportSection[];
  actions: Array<{
    urgency: 'today' | 'this_week' | 'this_month';
    text: string;
    deal_name?: string | null;
    deal_id?: string | null;
    source_id?: string | null;
    rep_name?: string | null;
    owner_email?: string | null;
  }>;
  recommended_next_steps: string;
  skills_included: string[];
  skills_omitted: string[];
  total_word_count: number;
  tokens_used: number;
  orchestrator_run_id: string;
}
