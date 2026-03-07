export interface WorkspaceDocumentProfile {
  calibration: {
    completedAt?: string;
    completedSessions: number;
    nextScheduledAt?: string;
    answers: CalibrationAnswers;
  };
  sectionPreferences: Record<string, SectionPreferences>; // key: template:section
  qualityScores: {
    overall: number;
    trend: 'up' | 'down' | 'stable';
    lastUpdated: string;
  };
  distributionPatterns: {
    averageEditDistance: number;
    trainingPairsCount: number;
    slackEngagementByTemplate: Record<string, { reactions: number; replies: number }>;
  };
}

export interface CalibrationAnswers {
  execSummaryLeadsWith?: 'deal_count' | 'revenue_gap' | 'pacing_status' | 'risk_narrative';
  repNamingInRisks?: 'full_name' | 'last_name' | 'rep_role' | 'anonymous';
  comparisonBlock?: 'pacing_to_quota' | 'week_over_week' | 'quarter_over_quarter';
  recommendationStyle?: 'prescriptive' | 'suggestive' | 'coaching_questions';
  primaryAudience?: 'cro' | 'vpsales' | 'front_line_manager' | 'ops';
  execSummaryMaxParagraphs?: number;
}

export interface SectionPreferences {
  templateType: string;
  sectionId: string;
  averageEditDistance: number;
  editCount: number;
  styleSignals: string[]; // e.g., "shorter_sentences", "more_data_points"
  lastEditedAt?: string;
}

export interface DocumentEdit {
  id: string;
  workspace_id: string;
  document_id: string;
  template_type: string;
  section_id: string;
  raw_text: string;
  edited_text: string;
  edit_distance: number;
  derived_signals: string[];
  voice_profile_snapshot: any;
  quarter_phase_at_time: string;
  attainment_pct_at_time: number;
  edited_by: string;
  edited_at: string;
}

export interface TrainingPair {
  id: string;
  workspace_id: string;
  template_type: string;
  section_id: string;
  system_prompt_at_time: string;
  raw_output: string;
  corrected_output: string;
  edit_distance: number;
  derived_style_signals: string[];
  was_distributed: boolean;
  recommendations_actioned: boolean;
  quality_label: 'good' | 'needs_improvement' | 'poor';
  voice_profile_snapshot: any;
  quarter_phase: string;
  attainment_pct: number;
  created_at: string;
}

export const DEFAULT_DOCUMENT_PROFILE: WorkspaceDocumentProfile = {
  calibration: {
    completedSessions: 0,
    answers: {}
  },
  sectionPreferences: {},
  qualityScores: {
    overall: 0,
    trend: 'stable',
    lastUpdated: new Date().toISOString()
  },
  distributionPatterns: {
    averageEditDistance: 0,
    trainingPairsCount: 0,
    slackEngagementByTemplate: {}
  }
};
