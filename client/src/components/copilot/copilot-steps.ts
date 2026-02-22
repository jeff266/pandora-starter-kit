export type CopilotStep =
  | 'welcome'
  | 'audience'
  | 'focus'
  | 'skills'
  | 'schedule'
  | 'delivery'
  | 'review'
  | 'done';

export interface QuickOption {
  label: string;
  value: string;
  description?: string;
  icon?: string;
}

export interface ChatMessage {
  role: 'assistant' | 'user';
  content: string;
  options?: QuickOption[];
  selected_option?: string;
}

export interface AudienceConfig {
  role: string;
  detail_preference: 'executive' | 'manager' | 'analyst';
}

export interface ScheduleConfig {
  type: 'cron' | 'manual';
  cron?: string;
  days?: string[];
  time?: string;
}

export interface DraftConfig {
  name?: string;
  description?: string;
  icon?: string;
  template_id?: string;
  audience?: AudienceConfig;
  focus_questions?: string[];
  skills?: string[];
  schedule?: ScheduleConfig;
  output_formats?: string[];
  slack_channel?: string;
  data_window?: { primary: string; comparison: string };
}

export interface WorkspaceContext {
  templates: Array<{ id: string; name: string; description: string; icon: string; defaults: any }>;
  skills: Array<{ id: string; name: string; category: string }>;
  crm_type: string;
  has_slack: boolean;
  has_conversation_intel: boolean;
}

export interface CopilotState {
  step: CopilotStep;
  messages: ChatMessage[];
  draft_config: DraftConfig;
  workspace_context: WorkspaceContext | null;
}

const STEP_ORDER: CopilotStep[] = ['welcome', 'audience', 'focus', 'skills', 'schedule', 'delivery', 'review'];

export function getNextStep(current: CopilotStep, skip: CopilotStep[] = []): CopilotStep {
  const idx = STEP_ORDER.indexOf(current);
  for (let i = idx + 1; i < STEP_ORDER.length; i++) {
    if (!skip.includes(STEP_ORDER[i])) return STEP_ORDER[i];
  }
  return 'review';
}

export const WELCOME_MESSAGE: ChatMessage = {
  role: 'assistant',
  content: "I'll help you build an agent. What kind of briefing are you looking for?",
};

export function getStepOptions(step: CopilotStep): QuickOption[] {
  switch (step) {
    case 'welcome':
      return [
        { label: 'Pipeline review', value: 'pipeline-review', icon: '\u{1F4CA}', description: 'Weekly pipeline health check' },
        { label: 'Deal risk alerts', value: 'deal-risk', icon: '\u{1F3AF}', description: 'Flag at-risk and stalled deals' },
        { label: 'Forecast check', value: 'forecast', icon: '\\u{1F4C8}', description: 'Forecast accuracy and gap analysis' },
        { label: 'Data quality audit', value: 'data-quality', icon: '\u{1F50D}', description: 'Find missing and stale CRM data' },
        { label: 'Lead scoring digest', value: 'lead-scoring', icon: '\\u{1F3C6}', description: 'Top leads and scoring updates' },
        { label: 'Rep performance', value: 'rep-scorecard', icon: '\u{1F4CB}', description: 'Rep activity and pipeline scorecard' },
      ];
    case 'audience':
      return [
        { label: 'VP / CRO', value: 'vp-cro', icon: '\\u{1F454}' },
        { label: 'Sales Manager', value: 'sales-manager', icon: '\u{1F4CB}' },
        { label: 'RevOps / Ops', value: 'revops', icon: '\u2699\uFE0F' },
        { label: 'CEO / Founder', value: 'ceo', icon: '\\u{1F3E2}' },
      ];
    case 'focus':
      return [
        { label: 'Which deals are most at risk?', value: 'deals-at-risk' },
        { label: 'Is pipeline coverage on track?', value: 'pipeline-coverage' },
        { label: 'Are there stalled deals that need attention?', value: 'stalled-deals' },
        { label: 'How accurate is the current forecast?', value: 'forecast-accuracy' },
        { label: 'Which reps need coaching?', value: 'rep-coaching' },
        { label: 'Any new high-fit accounts?', value: 'new-accounts' },
      ];
    case 'schedule':
      return [
        { label: 'Every Monday at 8 AM', value: 'monday-8am', icon: '\\u{1F305}' },
        { label: 'Every weekday morning', value: 'weekday-8am', icon: '\u{1F4C5}' },
        { label: 'Twice a week (Mon + Thu)', value: 'mon-thu', icon: '\u{1F551}' },
        { label: 'Only when I trigger it', value: 'manual', icon: '\\u{1F514}' },
      ];
    case 'delivery':
      return [
        { label: 'Slack channel', value: 'slack', icon: '\\u{1F4AC}' },
        { label: 'In Pandora (view in app)', value: 'in_app', icon: '\\u{1F4F1}' },
        { label: 'Email', value: 'email', icon: '\u{1F4E7}' },
        { label: 'Slack + In App', value: 'slack_and_app', icon: '\u{1F4CB}' },
      ];
    default:
      return [];
  }
}

export function getStepMessage(step: CopilotStep, draft: DraftConfig): string {
  switch (step) {
    case 'audience':
      return 'Who will be reading this briefing?';
    case 'focus':
      return 'What questions should this briefing answer each time it runs? Pick a few or type your own.';
    case 'skills':
      return 'Based on what you\'ve told me, here are the skills I\'d include. Toggle any to add or remove.';
    case 'schedule':
      return 'When do you want this delivered?';
    case 'delivery':
      return 'Where do you want to receive the briefing?';
    case 'review':
      return 'Here\'s what I\'ve built. Review and confirm:';
    default:
      return '';
  }
}

export function getStepPlaceholder(step: CopilotStep): string {
  switch (step) {
    case 'welcome': return 'Describe what you need...';
    case 'audience': return 'e.g., My CRO, she only cares about deals over $100K';
    case 'focus': return 'Add your own question...';
    case 'schedule': return 'e.g., Tuesday and Friday before our 9am standup';
    case 'delivery': return 'e.g., Post it to #sales-leadership';
    default: return 'Type a message...';
  }
}

export const QUESTION_TO_SKILL_MAP: Record<string, string[]> = {
  'risk': ['pipeline-hygiene', 'single-thread-alert'],
  'stale': ['pipeline-hygiene'],
  'stalled': ['pipeline-hygiene'],
  'coverage': ['pipeline-coverage'],
  'forecast': ['forecast-rollup', 'monte-carlo-forecast'],
  'rep': ['pipeline-coverage', 'rep-scorecard'],
  'lead': ['lead-scoring'],
  'icp': ['icp-discovery', 'lead-scoring'],
  'data quality': ['data-quality-audit'],
  'coaching': ['conversation-intelligence', 'rep-scorecard'],
  'slipped': ['pipeline-hygiene'],
  'close date': ['pipeline-hygiene'],
  'single thread': ['single-thread-alert'],
  'multi-thread': ['single-thread-alert'],
  'conversation': ['conversation-intelligence'],
  'scoring': ['deal-scoring-model', 'lead-scoring'],
  'pipeline': ['pipeline-hygiene', 'pipeline-coverage'],
  'waterfall': ['pipeline-waterfall'],
  'velocity': ['stage-velocity-benchmarks'],
  'competitive': ['competitive-intelligence'],
};

export function suggestSkills(focusQuestions: string[]): string[] {
  const suggested = new Set<string>();
  for (const q of focusQuestions) {
    const lower = q.toLowerCase();
    for (const [keyword, skills] of Object.entries(QUESTION_TO_SKILL_MAP)) {
      if (lower.includes(keyword)) {
        skills.forEach(s => suggested.add(s));
      }
    }
  }
  if (suggested.size === 0) {
    suggested.add('pipeline-hygiene');
  }
  return [...suggested];
}

export function getPresetUpdates(step: CopilotStep, value: string): Partial<DraftConfig> {
  switch (step) {
    case 'welcome':
      return getWelcomePresetConfig(value);
    case 'audience':
      return getAudiencePresetConfig(value);
    case 'focus':
      return {};
    case 'schedule':
      return getSchedulePresetConfig(value);
    case 'delivery':
      return getDeliveryPresetConfig(value);
    default:
      return {};
  }
}

function getWelcomePresetConfig(value: string): Partial<DraftConfig> {
  switch (value) {
    case 'pipeline-review':
      return {
        name: 'Pipeline Review',
        icon: '/avatars/char-01.png',
        skills: ['pipeline-hygiene', 'pipeline-coverage', 'single-thread-alert'],
        focus_questions: ['Which deals are most at risk?', 'Is pipeline coverage on track?', 'Are there stalled deals?'],
        audience: { role: 'Sales Manager', detail_preference: 'manager' },
      };
    case 'deal-risk':
      return {
        name: 'Deal Risk Alerts',
        icon: '/avatars/char-06.png',
        skills: ['pipeline-hygiene', 'single-thread-alert', 'deal-risk-review'],
        focus_questions: ['Which deals are at risk of slipping?', 'Any single-threaded deals?'],
        audience: { role: 'Sales Manager', detail_preference: 'manager' },
      };
    case 'forecast':
      return {
        name: 'Forecast Check',
        icon: '/avatars/char-15.png',
        skills: ['forecast-rollup', 'monte-carlo-forecast', 'pipeline-coverage'],
        focus_questions: ['How accurate is the current forecast?', 'What is the gap to quota?'],
        audience: { role: 'VP Sales', detail_preference: 'executive' },
      };
    case 'data-quality':
      return {
        name: 'Data Quality Audit',
        icon: '/avatars/char-19.png',
        skills: ['data-quality-audit', 'pipeline-hygiene'],
        focus_questions: ['Which CRM fields are missing or stale?', 'What is overall data hygiene score?'],
        audience: { role: 'RevOps Manager', detail_preference: 'analyst' },
      };
    case 'lead-scoring':
      return {
        name: 'Lead Scoring Digest',
        icon: '/avatars/char-05.png',
        skills: ['lead-scoring', 'icp-discovery'],
        focus_questions: ['Which leads have the highest ICP fit?', 'Any new high-fit accounts?'],
        audience: { role: 'Sales Manager', detail_preference: 'manager' },
      };
    case 'rep-scorecard':
      return {
        name: 'Rep Performance',
        icon: '/avatars/char-08.png',
        skills: ['rep-scorecard', 'pipeline-coverage'],
        focus_questions: ['Which reps are behind on activity?', 'How does pipeline coverage look per rep?'],
        audience: { role: 'Sales Manager', detail_preference: 'manager' },
      };
    default:
      return {};
  }
}

function getAudiencePresetConfig(value: string): Partial<DraftConfig> {
  switch (value) {
    case 'vp-cro':
      return { audience: { role: 'CRO', detail_preference: 'executive' } };
    case 'sales-manager':
      return { audience: { role: 'Sales Manager', detail_preference: 'manager' } };
    case 'revops':
      return { audience: { role: 'RevOps Manager', detail_preference: 'analyst' } };
    case 'ceo':
      return { audience: { role: 'CEO', detail_preference: 'executive' } };
    default:
      return {};
  }
}

function getSchedulePresetConfig(value: string): Partial<DraftConfig> {
  switch (value) {
    case 'monday-8am':
      return { schedule: { type: 'cron', cron: '0 8 * * 1' } };
    case 'weekday-8am':
      return { schedule: { type: 'cron', cron: '0 8 * * 1-5' } };
    case 'mon-thu':
      return { schedule: { type: 'cron', cron: '0 8 * * 1,4' } };
    case 'manual':
      return { schedule: { type: 'manual' } };
    default:
      return {};
  }
}

function getDeliveryPresetConfig(value: string): Partial<DraftConfig> {
  switch (value) {
    case 'slack':
      return { output_formats: ['slack'] };
    case 'in_app':
      return { output_formats: ['in_app'] };
    case 'email':
      return { output_formats: ['email'] };
    case 'slack_and_app':
      return { output_formats: ['slack', 'in_app'] };
    default:
      return {};
  }
}

export function getFocusQuestionText(value: string): string {
  const map: Record<string, string> = {
    'deals-at-risk': 'Which deals are most at risk?',
    'pipeline-coverage': 'Is pipeline coverage on track?',
    'stalled-deals': 'Are there stalled deals that need attention?',
    'forecast-accuracy': 'How accurate is the current forecast?',
    'rep-coaching': 'Which reps need coaching?',
    'new-accounts': 'Any new high-fit accounts?',
  };
  return map[value] || value;
}
