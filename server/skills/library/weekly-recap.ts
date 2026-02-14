/**
 * Weekly Pipeline Recap Skill
 *
 * Generates a weekly summary of pipeline changes, wins, losses, key activities,
 * and upcoming priorities.
 *
 * Runs: Friday 4 PM (cron) + on demand
 * Output: Slack formatted message
 * Tier: Mixed (compute for data, DeepSeek for call themes, Claude for synthesis)
 */

import type { SkillDefinition } from '../types.js';

export const weeklyRecapSkill: SkillDefinition = {
  id: 'weekly-recap',
  name: 'Weekly Pipeline Recap',
  description: 'Generates a weekly summary of pipeline changes, wins, losses, key activities, and upcoming priorities.',
  version: '1.0.0',
  category: 'reporting',
  tier: 'mixed',

  requiredTools: [
    'getActivitySummary',
    'queryDeals',
    'getPipelineSummary',
    'queryConversations',
    'summarizeForClaude',
  ],

  requiredContext: ['business_model', 'goals_and_targets'],

  steps: [
    {
      id: 'this-week-activity',
      name: 'Get This Week Activity Summary',
      tier: 'compute',
      computeFn: 'getActivitySummary',
      computeArgs: { days: 7 },
      outputKey: 'weekly_activity',
    },

    {
      id: 'pipeline-changes',
      name: 'Get Pipeline Changes This Week',
      tier: 'compute',
      computeFn: 'getPipelineSummary',
      computeArgs: {},
      outputKey: 'current_pipeline',
    },

    {
      id: 'new-deals',
      name: 'Get New Deals Created This Week',
      tier: 'compute',
      computeFn: 'queryDeals',
      computeArgs: {
        sortBy: 'created_at',
        sortDir: 'desc',
        limit: 20,
      },
      outputKey: 'recent_deals',
    },

    {
      id: 'closed-won',
      name: 'Get Closed Won Deals This Week',
      tier: 'compute',
      computeFn: 'queryDeals',
      computeArgs: {
        stageNormalized: 'closed_won',
        sortBy: 'close_date',
        sortDir: 'desc',
        limit: 20,
      },
      outputKey: 'closed_won',
    },

    {
      id: 'closed-lost',
      name: 'Get Closed Lost Deals This Week',
      tier: 'compute',
      computeFn: 'queryDeals',
      computeArgs: {
        stageNormalized: 'closed_lost',
        sortBy: 'close_date',
        sortDir: 'desc',
        limit: 20,
      },
      outputKey: 'closed_lost',
    },

    {
      id: 'this-week-calls',
      name: 'Get This Week Conversations',
      tier: 'compute',
      computeFn: 'queryConversations',
      computeArgs: {
        startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        hasTranscript: true,
        limit: 30,
      },
      outputKey: 'weekly_conversations',
    },

    {
      id: 'call-highlights',
      name: 'Extract Call Highlights and Themes',
      tier: 'deepseek',
      dependsOn: ['this-week-calls'],
      deepseekPrompt: `Analyze these sales calls from this week.

Conversations (count: {{weekly_conversations.length}}):
{{{json weekly_conversations}}}

Summarize the key themes and patterns. Return JSON:
{
  "themes": ["theme 1", "theme 2"],
  "criticalSignals": ["signal 1"],
  "topMoments": ["moment 1"],
  "competitiveLandscape": "brief summary",
  "buyingSignals": "brief summary"
}`,
      deepseekSchema: {
        type: 'object',
        properties: {
          themes: { type: 'array', items: { type: 'string' } },
          criticalSignals: { type: 'array', items: { type: 'string' } },
          topMoments: { type: 'array', items: { type: 'string' } },
          competitiveLandscape: { type: 'string' },
          buyingSignals: { type: 'string' },
        },
      },
      outputKey: 'call_highlights',
    },

    {
      id: 'summarize-for-claude',
      name: 'Pre-summarize data for Claude',
      tier: 'compute',
      dependsOn: [
        'this-week-activity',
        'pipeline-changes',
        'new-deals',
        'closed-won',
        'closed-lost',
        'call-highlights',
      ],
      computeFn: 'summarizeForClaude',
      computeArgs: {},
      outputKey: 'recap_summary',
    },

    {
      id: 'synthesize-recap',
      name: 'Synthesize Weekly Recap',
      tier: 'claude',
      dependsOn: ['summarize-for-claude'],
      claudePrompt: `Write a weekly pipeline recap for leadership.

Revenue Target: ${'$'}{{goals_and_targets.revenue_target}}
Sales Cycle: {{business_model.sales_cycle_days}} days

{{#if dataFreshness.isStale}}
⚠️ DATA FRESHNESS: {{dataFreshness.staleCaveat}}
{{/if}}

Pipeline Overview:
{{recap_summary.pipelineSummary}}

{{recap_summary.activitySummary}}

{{recap_summary.wonDeals}}

{{recap_summary.lostDeals}}

{{recap_summary.newDeals}}

{{#if dataFreshness.hasConversations}}
Call Highlights:
{{recap_summary.callHighlights}}
{{else}}
Conversation data not available.
{{/if}}

Write a concise executive recap covering:

1. WINS & LOSSES
   - What closed this week (won and lost)
   - Deal names, amounts, and key factors
   - Loss patterns

2. PIPELINE MOVEMENT
   - New deals created (total value and count)
   - Stage progression
   - Net pipeline change

3. ACTIVITY PULSE
{{#if dataFreshness.hasActivities}}
   - Activity this week (calls, emails, meetings)
   - Rep activity levels
{{else}}
   - SKIP THIS SECTION (activity data not available)
{{/if}}

4. CALL THEMES
{{#if dataFreshness.hasConversations}}
   - Primary themes from conversations
   - Critical signals for leadership
{{else}}
   - SKIP THIS SECTION (conversation data not available)
{{/if}}

5. NEXT WEEK PRIORITIES
   - What needs attention Monday morning
   - At-risk deals to focus on

Tone: Direct, specific, numbers-first. No fluff.
Use actual deal names and dollar amounts.`,
      outputKey: 'weekly_recap',
    },
  ],

  schedule: {
    cron: '0 16 * * 5',
    trigger: 'on_demand',
  },

  outputFormat: 'slack',
  slackTemplate: 'weekly-recap',

  estimatedDuration: '3m',

  evidenceSchema: {
    entity_type: 'deal',
    columns: [
      { key: 'deal_name', display: 'Deal Name', format: 'text' },
      { key: 'amount', display: 'Amount', format: 'currency' },
      { key: 'stage', display: 'Stage', format: 'text' },
      { key: 'owner', display: 'Owner', format: 'text' },
      { key: 'outcome', display: 'Outcome', format: 'text' },
      { key: 'close_date', display: 'Close Date', format: 'date' },
      { key: 'created_at', display: 'Created', format: 'date' },
      { key: 'stage_change', display: 'Stage Change', format: 'text' },
    ],
  },
};
