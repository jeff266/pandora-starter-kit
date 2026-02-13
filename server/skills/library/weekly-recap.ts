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
  ],

  requiredContext: ['business_model', 'goals_and_targets'],

  steps: [
    // Step 1: This week's activity
    {
      id: 'this-week-activity',
      name: 'Get This Week Activity Summary',
      tier: 'compute',
      computeFn: 'getActivitySummary',
      computeArgs: { days: 7 },
      outputKey: 'weekly_activity',
    },

    // Step 2: Pipeline changes
    {
      id: 'pipeline-changes',
      name: 'Get Pipeline Changes This Week',
      tier: 'compute',
      computeFn: 'getPipelineSummary',
      computeArgs: {},
      outputKey: 'current_pipeline',
    },

    // Step 3: New deals this week
    {
      id: 'new-deals',
      name: 'Get New Deals Created This Week',
      tier: 'compute',
      computeFn: 'queryDeals',
      computeArgs: {
        // Filter by created_at in the tool (not exposed in current schema, but can be added)
        sortBy: 'created_at',
        sortDir: 'desc',
        limit: 100,
      },
      outputKey: 'recent_deals',
    },

    // Step 4: Closed won deals
    {
      id: 'closed-won',
      name: 'Get Closed Won Deals This Week',
      tier: 'compute',
      computeFn: 'queryDeals',
      computeArgs: {
        stageNormalized: 'closed_won',
        sortBy: 'close_date',
        sortDir: 'desc',
        limit: 50,
      },
      outputKey: 'closed_won',
    },

    // Step 5: Closed lost deals
    {
      id: 'closed-lost',
      name: 'Get Closed Lost Deals This Week',
      tier: 'compute',
      computeFn: 'queryDeals',
      computeArgs: {
        stageNormalized: 'closed_lost',
        sortBy: 'close_date',
        sortDir: 'desc',
        limit: 50,
      },
      outputKey: 'closed_lost',
    },

    // Step 6: This week's conversations
    {
      id: 'this-week-calls',
      name: 'Get This Week Conversations',
      tier: 'compute',
      computeFn: 'queryConversations',
      computeArgs: {
        startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        hasTranscript: true,
        limit: 100,
      },
      outputKey: 'weekly_conversations',
    },

    // Step 7: Extract call highlights with DeepSeek
    {
      id: 'call-highlights',
      name: 'Extract Call Highlights and Themes',
      tier: 'deepseek',
      dependsOn: ['this-week-calls'],
      deepseekPrompt: `Analyze these {{weekly_conversations.length}} sales calls from this week.

Conversations:
{{weekly_conversations}}

Summarize the key themes and patterns across these calls. Look for:
- Common questions or concerns raised by prospects
- Product features frequently discussed
- Competitor mentions and competitive dynamics
- Buying signals or urgency indicators
- Objections and how they were handled
- Any critical moments or turning points

Return JSON with:
{
  "themes": [
    "Primary theme 1 with brief explanation",
    "Primary theme 2 with brief explanation",
    ...
  ],
  "criticalSignals": [
    "Important signal 1 that leadership should know",
    "Important signal 2 that leadership should know"
  ],
  "topMoments": [
    "Highlight 1: specific quote or moment with context",
    "Highlight 2: specific quote or moment with context"
  ],
  "competitiveLandscape": "Brief summary of competitive mentions and positioning",
  "buyingSignals": "Summary of urgency and buying intent signals"
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

    // Step 8: Synthesize weekly recap with Claude
    {
      id: 'synthesize-recap',
      name: 'Synthesize Weekly Recap',
      tier: 'claude',
      dependsOn: [
        'this-week-activity',
        'pipeline-changes',
        'new-deals',
        'closed-won',
        'closed-lost',
        'call-highlights',
      ],
      claudePrompt: `Write a weekly pipeline recap for leadership.

Revenue Target: ${'$'}{{goals_and_targets.revenue_target}}
Sales Cycle: {{business_model.sales_cycle_days}} days

{{#if dataFreshness.isStale}}
⚠️ DATA FRESHNESS: {{dataFreshness.staleCaveat}}
{{/if}}

This Week's Numbers:
{{#if dataFreshness.hasActivities}}
{{weekly_activity}}
{{else}}
Activity data not available (file import workspace). Activity metrics skipped.
{{/if}}

Current Pipeline:
{{current_pipeline}}

Closed Won This Week:
{{closed_won}}

Closed Lost This Week:
{{closed_lost}}

{{#if dataFreshness.hasConversations}}
Call Highlights:
{{call_highlights}}
{{else}}
Conversation data not available (file import workspace). Call analysis skipped.
{{/if}}

Write a concise executive recap covering:

1. WINS & LOSSES
   - What closed this week (won and lost)
   - Deal names, amounts, and key factors
   - Win rate trend if visible
   - Loss reasons and patterns

2. PIPELINE MOVEMENT
   - New deals created this week (total value and count)
   - Stage progression: deals that advanced
   - Deals that went dark or stalled
   - Net pipeline change vs. last week

3. ACTIVITY PULSE
{{#if dataFreshness.hasActivities}}
   - Total activity this week (calls, emails, meetings)
   - Rep activity levels: who's active, any drops
   - Coverage: are key deals getting attention?
{{else}}
   - SKIP THIS SECTION (activity data not available for file imports)
{{/if}}

4. CALL THEMES
{{#if dataFreshness.hasConversations}}
   - Primary themes from this week's conversations
   - Critical signals leadership should know
   - Competitive landscape updates
   - Buying signal trends
{{else}}
   - SKIP THIS SECTION (conversation data not available for file imports)
{{/if}}

5. NEXT WEEK PRIORITIES
   - What needs attention Monday morning
   - At-risk deals to focus on
   - Follow-ups due next week
   - Gaps to address

Tone: Direct, specific, numbers-first. This goes to a VP. No fluff.
Use actual deal names and dollar amounts. Format with clear headers and bullet points.`,
      outputKey: 'weekly_recap',
    },
  ],

  schedule: {
    cron: '0 16 * * 5', // Friday 4 PM
    trigger: 'on_demand',
  },

  outputFormat: 'slack',
  slackTemplate: 'weekly-recap',

  estimatedDuration: '3m',
};
