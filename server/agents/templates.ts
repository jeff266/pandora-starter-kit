export interface AgentTemplate {
  template_id: string;
  name: string;
  description: string;
  icon: string;
  skill_ids: string[];
  trigger_config: Record<string, any>;
  filter_config: Record<string, any>;
  template_format: string;
  estimated_tokens_per_week: number;
  fatigue_score: number;
  focus_score: number;
  best_for: string;
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    template_id: 'monday-pipeline-brief',
    name: 'Monday Pipeline Brief',
    description: 'Weekly pipeline health snapshot delivered before your Monday standup. Critical stale deals, single-thread risks, and stage anomalies.',
    icon: '📋',
    skill_ids: ['pipeline-hygiene', 'single-thread-alert', 'stage-velocity-benchmarks'],
    trigger_config: { type: 'cron', schedule: '0 8 * * 1', timezone: 'America/New_York' },
    filter_config: { severities: ['critical', 'warning'], max_findings: 15 },
    template_format: 'digest',
    estimated_tokens_per_week: 20000,
    fatigue_score: 18,
    focus_score: 72,
    best_for: 'VP Sales, CRO, RevOps lead',
  },
  {
    template_id: 'daily-deal-risk',
    name: 'Daily Deal Risk Alert',
    description: 'Score-based deal risk alerts. Fires when any deal AI score drops below 30 — catch deteriorating deals before they slip.',
    icon: '🚨',
    skill_ids: ['deal-scoring-model'],
    trigger_config: { type: 'threshold', field: 'ai_score', operator: '<', value: 30, check_interval_minutes: 60 },
    filter_config: { severities: ['critical'], min_amount: 25000, max_findings: 5 },
    template_format: 'alert',
    estimated_tokens_per_week: 12000,
    fatigue_score: 22,
    focus_score: 85,
    best_for: 'Sales managers, CRO',
  },
  {
    template_id: 'weekly-forecast-brief',
    name: 'Weekly Forecast Brief',
    description: 'End-of-week forecast summary with rep accuracy, commit reliability, and bear/base/bull scenarios.',
    icon: '🎯',
    skill_ids: ['weekly-forecast-rollup', 'forecast-model', 'forecast-accuracy-tracking'],
    trigger_config: { type: 'cron', schedule: '0 8 * * 5', timezone: 'America/New_York' },
    filter_config: { severities: ['critical', 'warning', 'info'], max_findings: 20 },
    template_format: 'digest',
    estimated_tokens_per_week: 25000,
    fatigue_score: 15,
    focus_score: 68,
    best_for: 'CRO, CFO, Board prep',
  },
  {
    template_id: 'rep-performance-digest',
    name: 'Rep Performance Digest',
    description: 'Friday rep scorecard with pipeline coverage, activity quality, and coaching priorities — ready before weekly 1:1s.',
    icon: '👤',
    skill_ids: ['rep-scorecard', 'pipeline-coverage'],
    trigger_config: { type: 'cron', schedule: '0 16 * * 5', timezone: 'America/New_York' },
    filter_config: { severities: ['critical', 'warning'], max_findings: 20 },
    template_format: 'digest',
    estimated_tokens_per_week: 17000,
    fatigue_score: 20,
    focus_score: 70,
    best_for: 'Sales managers, VP Sales',
  },
  {
    template_id: 'data-quality-watchdog',
    name: 'Data Quality Watchdog',
    description: 'Friday CRM hygiene digest. Missing fields, incomplete contacts, data gaps — delivered before Monday so you can fix before the week starts.',
    icon: '🔍',
    skill_ids: ['data-quality-audit', 'contact-role-resolution'],
    trigger_config: { type: 'cron', schedule: '0 16 * * 5', timezone: 'America/New_York' },
    filter_config: { severities: ['critical', 'warning'], max_findings: 20 },
    template_format: 'standard',
    estimated_tokens_per_week: 11000,
    fatigue_score: 16,
    focus_score: 74,
    best_for: 'RevOps lead, CRM admin',
  },
  {
    template_id: 'competitive-watch',
    name: 'Competitive Watch',
    description: "Weekly competitive intelligence briefing. Who you're facing, where you're winning and losing, open deals at risk.",
    icon: '⚔️',
    skill_ids: ['competitive-intelligence'],
    trigger_config: { type: 'cron', schedule: '0 8 * * 5', timezone: 'America/New_York' },
    filter_config: { severities: ['critical', 'warning', 'info'], max_findings: 15 },
    template_format: 'standard',
    estimated_tokens_per_week: 4500,
    fatigue_score: 12,
    focus_score: 88,
    best_for: 'AEs, Sales enablement, VP Sales',
  },
  {
    template_id: 'pipeline-creation-health',
    name: 'Pipeline Creation Health',
    description: 'Monday pipeline generation check. Are we creating enough pipeline? At current rates, what will we close next quarter?',
    icon: '📈',
    skill_ids: ['pipeline-gen-forecast', 'pipeline-waterfall'],
    trigger_config: { type: 'cron', schedule: '0 9 * * 1', timezone: 'America/New_York' },
    filter_config: { severities: ['critical', 'warning'], max_findings: 10 },
    template_format: 'standard',
    estimated_tokens_per_week: 15000,
    fatigue_score: 19,
    focus_score: 71,
    best_for: 'CRO, Marketing, SDR manager',
  },
  {
    template_id: 'icp-misalignment-alert',
    name: 'ICP Misalignment Alert',
    description: "Weekly off-ICP pipeline review. Deals that don't match your win pattern — flagged before you waste more cycles on them.",
    icon: '🎪',
    skill_ids: ['icp-discovery'],
    trigger_config: { type: 'cron', schedule: '0 8 * * 0', timezone: 'America/New_York' },
    filter_config: { severities: ['warning'], categories: ['off_icp_deal'], max_findings: 10 },
    template_format: 'standard',
    estimated_tokens_per_week: 8000,
    fatigue_score: 14,
    focus_score: 82,
    best_for: 'RevOps, VP Sales, AEs',
  },
];
