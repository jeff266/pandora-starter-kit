/**
 * Deal Risk Assessment Skill
 *
 * Reviews open deals for risk signals using activity data, call sentiment,
 * stakeholder coverage, and velocity. Flags deals needing attention.
 *
 * Runs: After every sync (post_sync trigger)
 * Output: Structured JSON
 * Tier: Mixed (compute for data, DeepSeek for call extraction, Claude for assessment)
 *
 * Token optimization: Uses summarizeForClaude to batch-fetch activities/contacts
 * for all 20 deals in 2 SQL queries instead of Claude tool calls (83K→<10K tokens).
 */

import type { SkillDefinition } from '../types.js';

export const dealRiskReviewSkill: SkillDefinition = {
  id: 'deal-risk-review',
  name: 'Deal Risk Assessment',
  description: 'Reviews open deals for risk signals using activity data, call sentiment, stakeholder coverage, and velocity. Flags deals needing attention.',
  version: '1.1.0',
  category: 'deals',
  tier: 'mixed',

  requiredTools: [
    'queryDeals',
    'queryConversations',
    'summarizeForClaude',
  ],

  requiredContext: ['business_model', 'goals_and_targets', 'definitions'],

  steps: [
    {
      id: 'get-open-deals',
      name: 'Get Open Deals',
      tier: 'compute',
      computeFn: 'queryDeals',
      computeArgs: {
        stageNormalized: ['awareness', 'qualification', 'evaluation', 'decision', 'negotiation'],
        sortBy: 'amount',
        sortDir: 'desc',
        limit: 20,
      },
      outputKey: 'open_deals',
    },

    {
      id: 'get-recent-conversations',
      name: 'Get Recent Conversations',
      tier: 'compute',
      computeFn: 'queryConversations',
      computeArgs: {
        startDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
        hasTranscript: true,
        limit: 50,
      },
      outputKey: 'recent_conversations',
    },

    {
      id: 'extract-call-signals',
      name: 'Extract Risk Signals from Call Transcripts',
      tier: 'deepseek',
      dependsOn: ['get-recent-conversations'],
      deepseekPrompt: `You are analyzing sales call transcripts for risk signals.

{{#unless dataFreshness.hasConversations}}
No conversation data available (file import workspace). Return empty JSON array: []
{{/unless}}

{{#if dataFreshness.hasConversations}}
Conversations:
{{{json recent_conversations}}}
{{/if}}

Extract risk signals from these call transcripts. Look for:
- Objections raised (pricing, features, timeline, budget)
- Competitor mentions
- Budget concerns or approval delays
- Timeline delays or pushback
- Champion changes or stakeholder disengagement
- Technical blockers or integration concerns
- Contract negotiation friction

For each signal found, return:
- conversationId: ID of the conversation
- dealId: Associated deal ID (if mentioned in source_data)
- type: Type of risk (objection, competitor, budget, timeline, stakeholder, technical, contract)
- severity: low, medium, high
- quote: Exact quote from transcript that indicates the risk
- context: Brief explanation of why this is a risk

Return valid JSON array of signals.`,
      deepseekSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            conversationId: { type: 'string' },
            dealId: { type: 'string' },
            type: { type: 'string' },
            severity: { type: 'string' },
            quote: { type: 'string' },
            context: { type: 'string' },
          },
        },
      },
      outputKey: 'call_signals',
    },

    {
      id: 'batch-deal-context',
      name: 'Batch Fetch Deal Context (Activities + Contacts)',
      tier: 'compute',
      dependsOn: ['get-open-deals', 'extract-call-signals'],
      computeFn: 'summarizeForClaude',
      computeArgs: {},
      outputKey: 'deal_context',
    },

    {
      id: 'assess-risk',
      name: 'Assess Deal Risk',
      tier: 'claude',
      dependsOn: ['batch-deal-context'],
      claudePrompt: `Review these deals for risk. All data is pre-fetched below — do NOT request additional tools.

Sales cycle expectation: {{business_model.sales_cycle_days}} days
Stale threshold: {{goals_and_targets.thresholds.stale_deal_days}} days

{{#if dataFreshness.isStale}}
⚠️ DATA FRESHNESS: {{dataFreshness.staleCaveat}}
{{/if}}

DEAL PROFILES (with activity & contact data):
{{{deal_context.dealProfiles}}}

Contact coverage: {{deal_context.contactCoverage}}

{{#if deal_context.dataAvailability.activityNote}}
⚠️ {{deal_context.dataAvailability.activityNote}}
{{/if}}
{{#if deal_context.dataAvailability.contactNote}}
⚠️ {{deal_context.dataAvailability.contactNote}}
{{/if}}

{{#if dataFreshness.hasConversations}}
CALL RISK SIGNALS:
{{{deal_context.signalsSummary}}}
{{else}}
NOTE: Conversation data not available. Call signals skipped.
{{/if}}

For each deal, assess:
1. Activity recency vs sales cycle expectations{{#if deal_context.dataAvailability.activityNote}} (use updated_at as proxy){{/if}}
2. Stakeholder coverage: single-threaded deals are high risk{{#if deal_context.dataAvailability.contactNote}} (SKIP - no contact data){{/if}}
3. Velocity: stage progression vs expected pace
{{#if dataFreshness.hasConversations}}
4. Call signals: factor matched signals into assessment
{{/if}}
5. Data quality: missing critical fields

Produce a risk assessment for each deal:
{
  "dealId": "...",
  "dealName": "...",
  "amount": 50000,
  "currentStage": "...",
  "closeDate": "...",
  "risk": "high" | "medium" | "low",
  "riskScore": 75,
  "factors": [
    "No activity in 18 days (stale)",
    "Single-threaded: only 1 contact",
    "Competitor mentioned in last call"
  ],
  "recommendedAction": "Re-engage immediately: schedule executive sponsor call"
}

Sort by risk (high first), then by amount (largest first).
Return as JSON array.`,
      outputKey: 'risk_assessment',
    },
  ],

  schedule: {
    trigger: 'post_sync',
  },

  outputFormat: 'structured',

  estimatedDuration: '2m',
};
