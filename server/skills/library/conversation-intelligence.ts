import type { SkillDefinition } from '../types.js';

export const conversationIntelligenceSkill: SkillDefinition = {
  id: 'conversation-intelligence',
  name: 'Conversation Intelligence',
  description: 'Analyzes recent sales calls for objection themes, competitive mentions, coaching signals, and deal-level sentiment. Runs weekly and surfaces patterns the team can act on.',
  version: '1.0.0',
  category: 'calls',
  tier: 'mixed',

  requiredTools: [
    'resolveTimeWindows',
    'ciGatherConversations',
    'ciAggregateThemes',
    'calculateOutputBudget',
  ],

  requiredContext: ['business_model'],

  timeConfig: {
    analysisWindow: 'trailing_7d',
    changeWindow: 'last_7d',
    trendComparison: 'previous_period',
  },

  steps: [
    {
      id: 'resolve-time-windows',
      name: 'Resolve Time Windows',
      tier: 'compute',
      computeFn: 'resolveTimeWindows',
      computeArgs: {
        analysisWindow: 'trailing_7d',
        changeWindow: 'last_7d',
        trendComparison: 'previous_period',
      },
      outputKey: 'time_windows',
    },

    {
      id: 'gather-conversations',
      name: 'Gather Recent Conversations',
      tier: 'compute',
      dependsOn: ['resolve-time-windows'],
      computeFn: 'ciGatherConversations',
      computeArgs: {},
      outputKey: 'conversations',
    },

    {
      id: 'extract-themes',
      name: 'Extract Themes from Call Summaries',
      tier: 'deepseek',
      dependsOn: ['gather-conversations'],
      deepseekPrompt: `You are a conversation analyst. Extract structured signals from sales call summaries.

RECENT CONVERSATIONS (last 7 days):
{{{json conversations}}}

For each conversation that has a summary, extract signals. Return a JSON array — one entry per conversation:
[
  {
    "conversation_id": "string",
    "conversation_title": "string",
    "account_name": "string or null",
    "deal_name": "string or null",
    "objections_mentioned": ["string"],
    "competitors_mentioned": ["string"],
    "buying_signals": ["string"],
    "risk_signals": ["string"],
    "topics_discussed": ["string"],
    "momentum": "accelerating" | "steady" | "decelerating" | "unclear"
  }
]

Guidelines:
- objections: concerns the prospect raised (pricing, timing, security, integration, etc.)
- competitors: named competitors or "evaluating alternatives" mentions
- buying_signals: positive intent signals (asked about contract, timeline, next steps)
- risk_signals: negative signals (champion left, budget frozen, evaluation stalled, competitor shortlisted)
- momentum: overall deal direction based on tone and content of the call
- Only include non-empty arrays. If nothing was found for a field, use [].
- Skip conversations with no summary.

Return ONLY the JSON array.`,
      outputKey: 'theme_extractions',
    },

    {
      id: 'aggregate-themes',
      name: 'Aggregate Themes Across Calls',
      tier: 'compute',
      dependsOn: ['gather-conversations', 'extract-themes'],
      computeFn: 'ciAggregateThemes',
      computeArgs: {},
      outputKey: 'aggregated_themes',
    },

    {
      id: 'calculate-output-budget',
      name: 'Calculate Output Budget',
      tier: 'compute',
      dependsOn: ['aggregate-themes'],
      computeFn: 'calculateOutputBudget',
      computeArgs: {},
      outputKey: 'output_budget',
    },

    {
      id: 'synthesize-report',
      name: 'Synthesize Conversation Intelligence Report',
      tier: 'claude',
      dependsOn: [
        'resolve-time-windows',
        'gather-conversations',
        'extract-themes',
        'aggregate-themes',
        'calculate-output-budget',
      ],
      claudePrompt: `You are a Revenue Intelligence analyst delivering the weekly conversation brief for {{business_model.company_name}}.

CONVERSATION SUMMARY (this week):
{{{json conversations.summary}}}

THEME EXTRACTIONS (per call):
{{{json theme_extractions}}}

AGGREGATED THEMES:
{{{json aggregated_themes}}}

OUTPUT GUIDANCE:
{{{json output_budget}}}

STRUCTURE YOUR REPORT:

1. **This Week at a Glance**: N calls, N accounts, N reps. Total time on calls. % with summaries analyzed.

2. **Top Objections**: List the top 3-5 objections heard this week with frequency count and which deals/accounts they came from. Quote specific examples when available.

3. **Competitive Landscape**: Which competitors came up? In which deals? What was the context (active evaluation, already replaced, pricing comparison)?

4. **Buying Signals**: Deals showing strong positive momentum this week — what happened and what should happen next.

5. **Risk Signals**: Deals showing negative signals — champion concerns, budget holds, stalled evaluations. Be specific: which deal, what signal, what to do.

6. **Coaching Opportunities**: Any patterns in rep behavior worth addressing — talk time imbalances, short discovery calls, missed next steps.

{{voiceBlock}}

After the report, emit an <actions> block with a JSON array:
[{
  "action_type": "flag_at_risk" | "accelerate_deal" | "schedule_review",
  "severity": "critical" | "warning" | "info",
  "title": "short title",
  "summary": "1-2 sentences with specific evidence",
  "recommended_steps": ["step1", "step2"],
  "target_deal_name": "exact deal name if deal-specific",
  "owner_email": "rep email if known",
  "impact_amount": 0,
  "urgency_label": "overdue" | "this_week" | "next_week"
}]
<actions>[]</actions>`,
      outputKey: 'narrative',
    },
  ],

  schedule: {
    cron: '0 7 * * 1',
    trigger: 'on_demand',
  },

  outputFormat: 'markdown',
  estimatedDuration: '45s',

  evidenceSchema: {
    entity_type: 'conversation',
    columns: [
      { key: 'conversation_title', display: 'Call', format: 'text' },
      { key: 'account_name', display: 'Account', format: 'text' },
      { key: 'call_date', display: 'Date', format: 'date' },
      { key: 'duration_minutes', display: 'Duration (min)', format: 'number' },
      { key: 'rep_name', display: 'Rep', format: 'text' },
      { key: 'objections', display: 'Objections', format: 'text' },
      { key: 'competitors', display: 'Competitors', format: 'text' },
      { key: 'momentum', display: 'Momentum', format: 'text' },
    ],
  },
};
