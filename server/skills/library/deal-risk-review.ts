/**
 * Deal Risk Assessment Skill
 *
 * Reviews open deals for risk signals using activity data, call sentiment,
 * stakeholder coverage, and velocity. Flags deals needing attention.
 *
 * Runs: After every sync (post_sync trigger)
 * Output: Structured JSON
 * Tier: Mixed (compute for data, DeepSeek for call extraction, Claude for assessment)
 */

import type { SkillDefinition } from '../types.js';

export const dealRiskReviewSkill: SkillDefinition = {
  id: 'deal-risk-review',
  name: 'Deal Risk Assessment',
  description: 'Reviews open deals for risk signals using activity data, call sentiment, stakeholder coverage, and velocity. Flags deals needing attention.',
  version: '1.0.0',
  category: 'deals',
  tier: 'mixed',

  requiredTools: [
    'queryDeals',
    'getActivityTimeline',
    'getRecentCallsForDeal',
    'getContactsForDeal',
    'getStakeholderMap',
    'queryConversations',
  ],

  requiredContext: ['business_model', 'goals_and_targets', 'definitions'],

  steps: [
    // Step 1: Get top open deals
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

    // Step 2: Get recent conversations across all deals (returns empty if no conversation data)
    {
      id: 'get-recent-conversations',
      name: 'Get Recent Conversations',
      tier: 'compute',
      computeFn: 'queryConversations',
      computeArgs: {
        startDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(), // Last 14 days
        hasTranscript: true,
        limit: 50,
      },
      outputKey: 'recent_conversations',
    },

    // Step 3: Extract call signals with DeepSeek (handles empty conversation array)
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

    // Step 4: Assess risk with Claude
    {
      id: 'assess-risk',
      name: 'Assess Deal Risk',
      tier: 'claude',
      dependsOn: ['get-open-deals', 'extract-call-signals'],
      claudeTools: [
        'getActivityTimeline',
        'getContactsForDeal',
        'getStakeholderMap',
        'getDeal',
      ],
      maxToolCalls: 10,
      claudePrompt: `Review these {{open_deals.length}} open deals for risk.

Sales cycle expectation: {{business_model.sales_cycle_days}} days
Stale threshold: {{goals_and_targets.thresholds.stale_deal_days}} days

{{#if dataFreshness.isStale}}
⚠️ DATA FRESHNESS: {{dataFreshness.staleCaveat}}
{{/if}}

Open Deals:
{{{json open_deals}}}

{{#if dataFreshness.hasConversations}}
Call Risk Signals Extracted:
{{{json call_signals}}}
{{else}}
NOTE: Conversation data not available (file import workspace). Call quality and sentiment signals skipped.
{{/if}}

For each deal, assess:
1. Activity recency: {{#if dataFreshness.hasActivities}}Compare last_activity_date to sales cycle expectations{{else}}Use deal updated_at as proxy (activity data not available){{/if}}
2. Stakeholder coverage: {{#if dataFreshness.hasContacts}}Use tools to check if single-threaded or missing economic buyer{{else}}Contact data not available - skip stakeholder analysis{{/if}}
3. Velocity: Are they moving through stages at expected pace?
{{#if dataFreshness.hasConversations}}
4. Call signals: Match call_signals to dealId and factor into assessment
{{else}}
4. Call signals: SKIP (conversation data not available)
{{/if}}
5. Data quality: Missing critical fields that indicate lack of qualification?

{{#unless dataFreshness.hasActivities}}
IMPORTANT: Activity data not available. Use deal.updated_at as staleness proxy instead of last_activity_date.
{{/unless}}

{{#unless dataFreshness.hasContacts}}
IMPORTANT: Contact data not available. Skip single-threading analysis.
{{/unless}}

You can call tools to get more details about any deal that looks concerning.

Produce a risk assessment for each deal with this structure:
{
  "dealId": "...",
  "dealName": "...",
  "amount": 50000,
  "currentStage": "...",
  "closeDate": "...",
  "risk": "high" | "medium" | "low",
  "riskScore": 75,  // 0-100, higher = more risk
  "factors": [
    "No activity in 18 days (stale)",
    "Single-threaded: only 1 contact",
    "Competitor mentioned in last call (Salesforce)",
    "Budget concerns raised"
  ],
  "recommendedAction": "Re-engage immediately: schedule executive sponsor call, bring in SE for competitive positioning"
}

Sort results by risk (high first), then by amount (largest first).
Return as JSON array.`,
      outputKey: 'risk_assessment',
    },
  ],

  schedule: {
    trigger: 'post_sync', // Run after every data sync
  },

  outputFormat: 'structured',

  estimatedDuration: '3m',
};
