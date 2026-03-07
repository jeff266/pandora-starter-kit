export type DocumentTemplateType = 'WBR' | 'QBR' | 'BOARD_DECK' | 'FORECAST_MEMO' | 'DEAL_REVIEW';

export interface DocumentSection {
  id: string;
  title: string;
  description?: string;
  content: DocumentContribution[];
}

export interface DocumentContribution {
  id: string;
  type: 'finding' | 'chart' | 'table' | 'recommendation';
  source_skill_id?: string;
  source_run_id?: string;
  title: string;
  body?: string;
  data?: any;
  severity?: 'critical' | 'warning' | 'info';
  timestamp: string;
  user_overridden_section?: string;
}

export interface AccumulatedDocument {
  sessionId: string;
  workspaceId: string;
  templateType: DocumentTemplateType;
  sections: DocumentSection[];
  lastUpdated: string;
}

export const TEMPLATE_CONFIGS: Record<DocumentTemplateType, { title: string; sections: { id: string; title: string }[] }> = {
  WBR: {
    title: 'Weekly Business Review',
    sections: [
      { id: 'executive_summary', title: 'Executive Summary' },
      { id: 'key_risks', title: 'Key Risks & Blockers' },
      { id: 'pipeline_dynamics', title: 'Pipeline Dynamics' },
      { id: 'forecast_status', title: 'Forecast & Attainment' },
      { id: 'next_steps', title: 'Next Steps & Actions' },
    ],
  },
  QBR: {
    title: 'Quarterly Business Review',
    sections: [
      { id: 'quarterly_performance', title: 'Quarterly Performance' },
      { id: 'strategic_initiatives', title: 'Strategic Initiatives' },
      { id: 'market_trends', title: 'Market & Competitive Trends' },
      { id: 'team_productivity', title: 'Team Productivity' },
      { id: 'plan_for_next_quarter', title: 'Plan for Next Quarter' },
    ],
  },
  BOARD_DECK: {
    title: 'Board Deck Highlights',
    sections: [
      { id: 'top_line_growth', title: 'Top-line Growth' },
      { id: 'efficiency_metrics', title: 'Efficiency & Unit Economics' },
      { id: 'pipeline_health', title: 'Pipeline Health' },
      { id: 'major_wins_losses', title: 'Major Wins & Losses' },
      { id: 'risks_to_plan', title: 'Risks to Plan' },
    ],
  },
  FORECAST_MEMO: {
    title: 'Forecast Memo',
    sections: [
      { id: 'forecast_summary', title: 'Forecast Summary' },
      { id: 'confidence_assessment', title: 'Confidence Assessment' },
      { id: 'bridge_to_quota', title: 'Bridge to Quota' },
      { id: 'at_risk_deals', title: 'At-Risk Deals' },
      { id: 'upside_opportunities', title: 'Upside Opportunities' },
    ],
  },
  DEAL_REVIEW: {
    title: 'Deal Strategy Review',
    sections: [
      { id: 'deal_overview', title: 'Deal Overview' },
      { id: 'stakeholder_map', title: 'Stakeholder Map' },
      { id: 'competitive_situation', title: 'Competitive Situation' },
      { id: 'win_plan', title: 'Win Plan & Next Steps' },
      { id: 'risk_mitigation', title: 'Risk Mitigation' },
    ],
  },
};
