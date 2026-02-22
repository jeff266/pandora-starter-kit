import { query } from '../db.js';

export interface AgentBriefingConfig {
  audience: {
    role: string;
    detail_preference: 'executive' | 'manager' | 'analyst';
    vocabulary_avoid?: string[];
    vocabulary_prefer?: string[];
  };
  focus_questions: string[];
  data_window: {
    primary: 'current_week' | 'current_month' | 'current_quarter' | 'trailing_30d' | 'trailing_90d' | 'fiscal_year';
    comparison: 'previous_period' | 'same_period_last_year' | 'none';
  };
  output_formats: ('pdf' | 'docx' | 'pptx' | 'slack' | 'email')[];
  skills: string[];
  schedule: {
    type: 'cron' | 'event_prep' | 'manual';
    cron?: string;
    prep_days_before?: number;
    event_dates?: string[];
    event_name?: string;
  };
}

export interface AgentTemplateRow {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'briefing' | 'monitoring' | 'analysis';
  defaults: AgentBriefingConfig;
  prep_agent?: {
    skills: string[];
    schedule: { type: 'cron'; cron: string };
  };
  is_system: boolean;
  workspace_id: string | null;
  created_at: string;
}

export const BRIEFING_TEMPLATES: AgentTemplateRow[] = [
  {
    id: 'monday-pipeline-operator',
    name: 'Monday Pipeline Briefing',
    description: 'Weekly pipeline health briefing for sales leadership. Leads with what matters most this week.',
    icon: '📊',
    category: 'briefing',
    defaults: {
      skills: ['pipeline-hygiene', 'single-thread-alert', 'pipeline-coverage', 'deal-risk-review', 'forecast-rollup'],
      audience: { role: 'VP Sales', detail_preference: 'manager' },
      focus_questions: [
        'What changed in the pipeline this week?',
        'Which deals need immediate attention and why?',
        'Are we on track for the quarter?',
      ],
      data_window: { primary: 'current_week', comparison: 'previous_period' },
      output_formats: ['pdf', 'slack', 'email'],
      schedule: { type: 'cron', cron: '0 7 * * 1' },
    },
    prep_agent: {
      skills: ['pipeline-hygiene', 'single-thread-alert', 'pipeline-coverage', 'deal-risk-review', 'forecast-rollup', 'conversation-intelligence'],
      schedule: { type: 'cron', cron: '0 20 * * 0' },
    },
    is_system: true,
    workspace_id: null,
    created_at: new Date().toISOString(),
  },
  {
    id: 'forecast-call-prep',
    name: 'Forecast Call Prep',
    description: 'Pre-meeting intelligence brief for forecast calls. Frames everything as distance-to-target.',
    icon: '🎯',
    category: 'briefing',
    defaults: {
      skills: ['forecast-rollup', 'deal-risk-review', 'pipeline-coverage', 'monte-carlo-forecast', 'conversation-intelligence'],
      audience: { role: 'CRO', detail_preference: 'executive' },
      focus_questions: [
        'Will we hit the number this quarter?',
        'What deals could move the forecast up or down?',
        'Where does the rep forecast disagree with the data?',
        'What questions should I ask in the forecast call?',
      ],
      data_window: { primary: 'current_quarter', comparison: 'previous_period' },
      output_formats: ['pdf', 'slack'],
      schedule: { type: 'cron', cron: '0 16 * * 4' },
    },
    is_system: true,
    workspace_id: null,
    created_at: new Date().toISOString(),
  },
  {
    id: 'friday-recap',
    name: 'Friday Recap',
    description: 'End-of-week retrospective. Compares Monday predictions to Friday actuals.',
    icon: '📋',
    category: 'briefing',
    defaults: {
      skills: ['pipeline-hygiene', 'deal-risk-review', 'forecast-rollup', 'rep-scorecard'],
      audience: { role: 'Sales Manager', detail_preference: 'manager' },
      focus_questions: [
        'What actually happened this week vs what we expected?',
        'Which deals moved forward and which stalled?',
        "Were last Monday's risk flags addressed?",
        'What should we focus on next week?',
      ],
      data_window: { primary: 'current_week', comparison: 'previous_period' },
      output_formats: ['slack', 'email'],
      schedule: { type: 'cron', cron: '0 17 * * 5' },
    },
    is_system: true,
    workspace_id: null,
    created_at: new Date().toISOString(),
  },
  {
    id: 'board-meeting-prep',
    name: 'Board Meeting Prep',
    description: 'Strategic analysis for board meetings. Generates deck, memo, and raw data backup.',
    icon: '🏛️',
    category: 'briefing',
    defaults: {
      skills: ['forecast-rollup', 'pipeline-coverage', 'rep-scorecard', 'icp-discovery', 'conversation-intelligence', 'monte-carlo-forecast'],
      audience: {
        role: 'Board of Directors',
        detail_preference: 'executive',
        vocabulary_avoid: ['MEDDPICC', 'single-thread', 'weighted pipeline coverage', 'ACV'],
        vocabulary_prefer: ['revenue', 'growth', 'market', 'competitive position', 'unit economics'],
      },
      focus_questions: [
        'Are we going to hit the annual number?',
        'Is the sales team sized correctly for the plan?',
        'What is our competitive win rate trend?',
        'How does pipeline generation compare to plan?',
        'What are the top risks to the revenue forecast?',
      ],
      data_window: { primary: 'fiscal_year', comparison: 'same_period_last_year' },
      output_formats: ['pptx', 'pdf', 'docx'],
      schedule: {
        type: 'event_prep',
        prep_days_before: 5,
        event_dates: [],
        event_name: 'Board Meeting',
      },
    },
    is_system: true,
    workspace_id: null,
    created_at: new Date().toISOString(),
  },
  {
    id: 'qbr-strategist',
    name: 'Quarterly Business Review',
    description: 'Comprehensive quarterly analysis with full pipeline, team, and strategy review.',
    icon: '📈',
    category: 'briefing',
    defaults: {
      skills: ['forecast-rollup', 'pipeline-hygiene', 'pipeline-coverage', 'rep-scorecard', 'deal-risk-review', 'icp-discovery', 'conversation-intelligence', 'monte-carlo-forecast', 'data-quality-audit'],
      audience: { role: 'CRO + VP Sales', detail_preference: 'manager' },
      focus_questions: [
        'How did we perform against plan this quarter?',
        'Which segments and reps drove results?',
        'What does the pipeline for next quarter look like?',
        'What operational changes should we make?',
        'Where is data quality hurting our visibility?',
      ],
      data_window: { primary: 'current_quarter', comparison: 'previous_period' },
      output_formats: ['pptx', 'pdf', 'docx'],
      schedule: {
        type: 'event_prep',
        prep_days_before: 7,
        event_dates: [],
        event_name: 'QBR',
      },
    },
    is_system: true,
    workspace_id: null,
    created_at: new Date().toISOString(),
  },
];

export async function seedAgentTemplates(): Promise<void> {
  for (const t of BRIEFING_TEMPLATES) {
    await query(
      `INSERT INTO agent_templates (id, name, description, icon, category, defaults, prep_agent, is_system, workspace_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         icon = EXCLUDED.icon,
         category = EXCLUDED.category,
         defaults = EXCLUDED.defaults,
         prep_agent = EXCLUDED.prep_agent`,
      [
        t.id,
        t.name,
        t.description,
        t.icon,
        t.category,
        JSON.stringify(t.defaults),
        t.prep_agent ? JSON.stringify(t.prep_agent) : null,
        t.is_system,
        t.workspace_id,
      ]
    );
  }
}

export async function getAgentTemplates(workspaceId?: string): Promise<AgentTemplateRow[]> {
  const result = await query<AgentTemplateRow>(
    `SELECT * FROM agent_templates
     WHERE is_system = true OR workspace_id = $1
     ORDER BY
       CASE category
         WHEN 'briefing' THEN 1
         WHEN 'monitoring' THEN 2
         WHEN 'analysis' THEN 3
         ELSE 4
       END,
       name`,
    [workspaceId ?? null]
  );
  return result.rows;
}

export async function getAgentTemplate(templateId: string): Promise<AgentTemplateRow | null> {
  const result = await query<AgentTemplateRow>(
    'SELECT * FROM agent_templates WHERE id = $1',
    [templateId]
  );
  return result.rows[0] ?? null;
}
