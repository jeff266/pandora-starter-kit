export interface CategoryDefinition {
  label: string;
  description: string;
  default_enabled: boolean;
  default_delivery: 'realtime' | 'digest' | 'smart';
  supports_threshold?: boolean;
  default_min_severity?: 'critical' | 'warning' | 'info';
  default_min_score_change?: number;
  default_min_score_tier?: string;
  default_max_per_run?: number;
}

export const NOTIFICATION_CATEGORIES: Record<string, CategoryDefinition> = {
  icp_score_jump: {
    label: 'ICP Score Jumps',
    description: 'Account fit score increased significantly',
    default_enabled: true,
    default_delivery: 'smart',
    supports_threshold: true,
    default_min_score_change: 15,
    default_min_score_tier: 'B',
    default_max_per_run: 5,
  },
  icp_score_drop: {
    label: 'ICP Score Drops',
    description: 'Account fit score decreased significantly',
    default_enabled: true,
    default_delivery: 'digest',
    supports_threshold: true,
    default_min_score_change: 20,
  },
  new_a_grade_lead: {
    label: 'New A-Grade Leads',
    description: 'Contact scored A-grade for the first time',
    default_enabled: true,
    default_delivery: 'realtime',
  },
  deal_risk_alert: {
    label: 'Deal Risk Alerts',
    description: 'Deal flagged as at-risk by pipeline hygiene',
    default_enabled: true,
    default_delivery: 'smart',
    default_min_severity: 'warning',
  },
  stale_deal_alert: {
    label: 'Stale Deal Alerts',
    description: 'Deal has been inactive beyond threshold',
    default_enabled: true,
    default_delivery: 'digest',
  },
  single_thread_alert: {
    label: 'Single-Thread Alerts',
    description: 'Deal has only one contact engaged',
    default_enabled: true,
    default_delivery: 'digest',
  },
  forecast_variance: {
    label: 'Forecast Variance',
    description: 'Significant gap between forecast and pipeline',
    default_enabled: true,
    default_delivery: 'realtime',
    default_min_severity: 'warning',
  },
  data_quality_issue: {
    label: 'Data Quality Issues',
    description: 'Missing or invalid CRM fields detected',
    default_enabled: true,
    default_delivery: 'digest',
    default_max_per_run: 10,
  },
  agent_briefing_ready: {
    label: 'Agent Briefings',
    description: 'Scheduled agent briefing is ready to view',
    default_enabled: true,
    default_delivery: 'realtime',
  },
  skill_run_complete: {
    label: 'Skill Run Results',
    description: 'Skill run completed with findings',
    default_enabled: true,
    default_delivery: 'realtime',
  },
  action_created: {
    label: 'Action Items',
    description: 'New action items created by skills or agents',
    default_enabled: true,
    default_delivery: 'smart',
    default_min_severity: 'warning',
  },
  sync_error: {
    label: 'Sync Errors',
    description: 'CRM sync or skill run failed',
    default_enabled: true,
    default_delivery: 'realtime',
  },
  config_drift: {
    label: 'Config Drift Detected',
    description: 'Workspace config audit found changes',
    default_enabled: true,
    default_delivery: 'digest',
  },
};
