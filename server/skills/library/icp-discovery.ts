/**
 * ICP Discovery Skill — Descriptive Mode
 *
 * Analyzes closed deal data to discover ideal customer profile patterns:
 * - Winning personas (seniority × department clustering)
 * - Ideal buying committee compositions
 * - Company sweet spots (industry, size, custom field segments)
 * - Lead source funnel performance
 *
 * Three-phase pattern:
 * 1. Compute: Analyze closed deals, discover patterns
 * 2. DeepSeek: Classify insight quality and actionability
 * 3. Claude: Synthesize human-readable ICP report
 */

import type { SkillDefinition } from '../types.js';

export const icpDiscoverySkill: SkillDefinition = {
  id: 'icp-discovery',
  name: 'ICP Discovery',
  description: 'Discover ideal customer profile patterns from closed deal data (personas, buying committees, company sweet spots)',
  version: '1.0.0',
  category: 'intelligence',
  tier: 'claude',
  slackTemplate: 'icp-discovery',

  requiredTools: ['resolveContactRoles', 'discoverICP'],
  requiredContext: [],

  steps: [
    {
      id: 'ensure-contact-roles',
      name: 'Ensure Contact Roles for Closed Deals',
      tier: 'compute',
      computeFn: 'resolveContactRoles',
      computeArgs: { includeClosedDeals: true },
      outputKey: 'contact_role_result',
    },

    {
      id: 'discover-patterns',
      name: 'Discover ICP Patterns',
      tier: 'compute',
      dependsOn: ['ensure-contact-roles'],
      computeFn: 'discoverICP',
      computeArgs: {},
      outputKey: 'discovery_result',
    },

    {
      id: 'classify-conversation-content',
      name: 'Classify Conversation Content (Optional)',
      tier: 'deepseek',
      dependsOn: ['discover-patterns'],
      // Note: This step should be skipped if discovery_result.conversationExcerpts is empty
      deepseekPrompt: `You are a B2B sales call analyst. For each deal's conversation excerpts, classify the following signals. Respond with ONLY a JSON array.

For each deal, output:
{
  "deal_id": "uuid",
  "competitor_mentions": ["competitor_name", ...],  // empty array if none
  "pricing_discussed": true/false,
  "budget_mentioned": true/false,
  "timeline_discussed": true/false,
  "objection_topics": ["topic", ...],               // e.g., "security", "pricing", "integration"
  "champion_language": true/false,                   // customer used advocacy language internally
  "champion_evidence": "quote or null",              // brief evidence if true
  "technical_depth": 0-5,                            // 0=no technical, 5=deep architecture discussion
  "sentiment_overall": "positive" | "neutral" | "negative",
  "sentiment_trajectory": "improving" | "stable" | "declining",  // across multiple calls
  "next_steps_explicit": true/false,                 // were concrete next steps stated?
  "decision_criteria_surfaced": ["criterion", ...]   // what the buyer cares about
}

Deal excerpts:

{{#each discovery_result.conversationExcerpts}}
## Deal ID: {{this.dealId}}
### Conversation: {{this.title}}
{{#if this.fullSummary}}
**Summary:** {{this.fullSummary}}
{{else}}
[START]
{{this.excerptStart}}
...
[END]
{{this.excerptEnd}}
{{/if}}

{{/each}}

Respond with a JSON array of classification objects, one per deal.`,
      deepseekSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            deal_id: { type: 'string' },
            competitor_mentions: {
              type: 'array',
              items: { type: 'string' },
            },
            pricing_discussed: { type: 'boolean' },
            budget_mentioned: { type: 'boolean' },
            timeline_discussed: { type: 'boolean' },
            objection_topics: {
              type: 'array',
              items: { type: 'string' },
            },
            champion_language: { type: 'boolean' },
            champion_evidence: { type: ['string', 'null'] },
            technical_depth: {
              type: 'number',
              minimum: 0,
              maximum: 5,
            },
            sentiment_overall: {
              type: 'string',
              enum: ['positive', 'neutral', 'negative'],
            },
            sentiment_trajectory: {
              type: 'string',
              enum: ['improving', 'stable', 'declining'],
            },
            next_steps_explicit: { type: 'boolean' },
            decision_criteria_surfaced: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: [
            'deal_id',
            'competitor_mentions',
            'pricing_discussed',
            'budget_mentioned',
            'timeline_discussed',
            'objection_topics',
            'champion_language',
            'champion_evidence',
            'technical_depth',
            'sentiment_overall',
            'sentiment_trajectory',
            'next_steps_explicit',
            'decision_criteria_surfaced',
          ],
        },
      },
      outputKey: 'conversation_signals',
      parseAs: 'json',
    },

    {
      id: 'classify-insights',
      name: 'Classify Insight Quality',
      tier: 'deepseek',
      dependsOn: ['discover-patterns', 'classify-conversation-content'],
      deepseekPrompt: `You are classifying ICP insights discovered from closed deal analysis.

For each finding, classify:
1. insight_type: confirmed_pattern | new_discovery | contradicts_assumption | emerging_trend | noise
2. actionability: immediate | strategic | monitor
3. confidence: 0.0-1.0 (based on sample size and lift)

Confidence guidelines:
- Sample < 10: max 0.5
- Sample 10-30: max 0.7
- Sample 30-100: max 0.85
- Sample > 100: 0.9+
- Lift < 1.2: reduce by 0.2

Findings to classify:

**Top Personas:**
{{{json discovery_result.personas}}}

**Buying Committee Combinations:**
{{{json discovery_result.committees}}}

**Company Sweet Spots:**
{{{json discovery_result.companyProfile.sweetSpots}}}

**Custom Field Segments:**
{{{json discovery_result.companyProfile.customFieldSegments}}}

**Lead Source Funnel:**
{{{json discovery_result.companyProfile.leadSourceFunnel}}}

Respond with ONLY a JSON object in this format:
{
  "classifications": [
    {
      "finding": "string (brief description)",
      "insightType": "confirmed_pattern|new_discovery|contradicts_assumption|emerging_trend|noise",
      "actionability": "immediate|strategic|monitor",
      "confidence": 0.85
    }
  ]
}`,
      outputKey: 'classifications',
      parseAs: 'json',
    },

    {
      id: 'synthesize-report',
      name: 'Generate ICP Report',
      tier: 'claude',
      dependsOn: ['discover-patterns', 'classify-conversation-content', 'classify-insights'],
      claudePrompt: `You are a revenue intelligence analyst delivering an ICP Discovery report based on real deal outcome data. Be specific with numbers, percentages, and dollar amounts. This is descriptive analysis — patterns observed, not predictions.

{{#if dataFreshness.isStale}}
⚠️ DATA FRESHNESS: {{dataFreshness.staleCaveat}}
{{/if}}

{{#unless dataFreshness.hasContacts}}
NOTE: Contact data not available (file import workspace). ICP analysis based on account-level patterns only.
Persona and buying committee analysis will be limited or unavailable.
{{/unless}}

## Data Analyzed

**Mode:** {{discovery_result.mode}}
**Deals:** {{discovery_result.metadata.dealsAnalyzed}} closed ({{discovery_result.metadata.wonCount}} won, {{discovery_result.metadata.lostCount}} lost)
{{#if dataFreshness.hasContacts}}
**Contact Roles:** {{discovery_result.dataReadiness.totalContactRoles}} across {{discovery_result.dataReadiness.dealsWithContacts}} deals
{{else}}
**Contact Roles:** Not available (file import workspace without contacts)
{{/if}}
**Custom Fields:** {{discovery_result.dataReadiness.customFieldsAvailable}} discovered and integrated
{{#if discovery_result.conversationCoverage}}
**Conversation Data:** {{discovery_result.conversationCoverage.dealsWithConversations}}/{{discovery_result.metadata.dealsAnalyzed}} deals ({{discovery_result.conversationCoverage.conversationCoverage}}% coverage, Tier {{discovery_result.conversationCoverage.tier}})
**Average Calls per Deal:** {{discovery_result.conversationCoverage.avgConversationsPerDeal}}
{{else}}
**Conversation Data:** Not available (no Gong/Fireflies connected)
{{/if}}
**Execution:** {{discovery_result.metadata.executionMs}}ms

## Persona Patterns Discovered

Top personas by lift (frequency in won deals vs lost deals):

{{#each discovery_result.personas}}
{{@index}}. **{{this.name}}** ({{this.dealCount}} deals)
   - Lift: {{this.lift}}x (appears in {{multiply this.frequency_in_won 100}}% of won deals vs {{multiply this.frequency_in_lost 100}}% of lost)
   - Top titles: {{join this.topTitles ", "}}
   - Top buying roles: {{join this.topBuyingRoles ", "}}
   - Avg deal size won: \${{formatNumber this.avgDealSizeWon}}
   - Confidence: {{this.confidence}}
{{/each}}

## Winning Buying Committees

Committee combinations with highest win rates:

{{#each discovery_result.committees}}
{{@index}}. **{{join this.personaNames " + "}}**
   - Win rate: {{multiply this.winRate 100}}% ({{this.wonCount}}/{{this.totalCount}} deals)
   - Lift: {{this.lift}}x vs baseline
   - Avg deal size: \${{formatNumber this.avgDealSize}}
{{/each}}

## Company Sweet Spots

{{#each discovery_result.companyProfile.sweetSpots}}
- **{{this.description}}**: {{multiply this.winRate 100}}% win rate ({{this.count}} deals, {{this.lift}}x lift)
{{/each}}

## Industry Analysis (AUTHORITATIVE — use these exact names and numbers)

{{#each discovery_result.companyProfile.industryWinRates}}
- **{{this.industry}}**: {{multiply this.winRate 100}}% win rate across {{this.count}} deals, avg \${{formatNumber this.avgDeal}}
{{/each}}

CRITICAL: The industries listed above are the ONLY industries in the dataset. Do NOT invent, rename, or substitute industry names. Use the exact industry names and numbers shown above in your report.

## Custom Field Segmentation

{{#each discovery_result.companyProfile.customFieldSegments}}
**{{this.fieldLabel}}:**
{{#each this.segments}}
  - {{this.value}}: {{multiply this.winRate 100}}% win rate ({{this.count}} deals)
{{/each}}
{{/each}}

## Lead Source Funnel

{{#each discovery_result.companyProfile.leadSourceFunnel}}
- **{{this.source}}**: {{this.leads}} leads → {{this.converted}} converted ({{multiply this.conversionRate 100}}%) → {{this.wonDeals}} won deals ({{multiply this.fullFunnelRate 100}}% full funnel)
{{/each}}

## Insight Classifications

{{#each classifications.classifications}}
- {{this.finding}}: {{this.insightType}}, {{this.actionability}}, confidence {{this.confidence}}
{{/each}}

{{#if conversation_signals}}
## Conversation Intelligence Patterns

Based on {{discovery_result.conversationCoverage.dealsWithConversations}} deals with conversation data ({{discovery_result.conversationCoverage.conversationCoverage}}% coverage):

**Content Signals:**
{{#each conversation_signals}}
- Deal {{this.deal_id}}: {{#if this.champion_language}}Champion language detected{{/if}}{{#if this.pricing_discussed}}, Pricing discussed{{/if}}{{#if this.budget_mentioned}}, Budget mentioned{{/if}}{{#if this.timeline_discussed}}, Timeline discussed{{/if}}, Technical depth: {{this.technical_depth}}/5, Sentiment: {{this.sentiment_overall}} ({{this.sentiment_trajectory}})
  {{#if this.competitor_mentions.length}}- Competitors mentioned: {{join this.competitor_mentions ", "}}{{/if}}
  {{#if this.objection_topics.length}}- Objections: {{join this.objection_topics ", "}}{{/if}}
  {{#if this.decision_criteria_surfaced.length}}- Decision criteria: {{join this.decision_criteria_surfaced ", "}}{{/if}}
{{/each}}

**Coverage Tier:** {{discovery_result.conversationCoverage.tier}}
- Tier 0: No conversation data
- Tier 1: <30% coverage (sparse - emerging signals only)
- Tier 2: 30-70% coverage (moderate - actionable patterns)
- Tier 3: >70% coverage (strong - high confidence patterns)

{{#if (lt discovery_result.conversationCoverage.tier 3)}}
⚠️ **Coverage Note:** Analysis based on {{discovery_result.conversationCoverage.conversationCoverage}}% of deals. Connect more conversations to Gong/Fireflies for stronger insights.
{{/if}}
{{/if}}

---

Write a Slack-ready ICP report covering:

1. **ICP Summary** — In 2-3 sentences, who does this company actually sell to successfully? Be specific about industry, company profile{{#if dataFreshness.hasContacts}}, and buying committee composition{{/if}}.

{{#if dataFreshness.hasContacts}}
2. **Winning Personas** — The 3-5 personas most correlated with won deals. For each: title patterns, department, seniority, frequency in won deals, and lift score. Call out which persona is the strongest positive signal.

3. **Ideal Buying Committee** — The combination of personas with the highest win rate. "When you have [X] AND [Y] in the deal, you win at Z% — versus W% baseline."
{{else}}
2. **Winning Personas** — SKIPPED (contact data not available). Upload contacts to enable persona analysis.

3. **Ideal Buying Committee** — SKIPPED (contact data not available). Upload contacts to enable buying committee analysis.
{{/if}}

4. **Company Sweet Spot** — Industry, size, and any custom field values that define the ideal target. Include win rates.

5. **Acquisition Channel Insights** — Which lead sources produce the highest quality pipeline (conversion rate × win rate × deal size). If lead data is available.

6. **Custom Field Discoveries** — Any customer-specific fields that strongly segment outcomes. "Deals with [Field = Value] win at X% versus Y% for [Field = Other Value]."

{{#if conversation_signals}}
7. **Conversation Intelligence** — Behavioral patterns from call data (Tier {{discovery_result.conversationCoverage.tier}}, {{discovery_result.conversationCoverage.conversationCoverage}}% coverage):
   - Champion Detection: Frequency of champion language in won vs lost deals
   - Competitive Landscape: Most mentioned competitors, pricing discussion patterns
   - Technical Engagement: Technical depth correlation with win rates
   - Sentiment Signals: Sentiment trajectory patterns (improving/stable/declining)
   - Decision Process: Common decision criteria and objection patterns
   - Next Steps: Deals with explicit next steps vs. those without

   {{#if (eq discovery_result.conversationCoverage.tier 1)}}
   NOTE: Low coverage (<30%) - treat as emerging signals, not confirmed patterns.
   {{/if}}
   {{#if (eq discovery_result.conversationCoverage.tier 2)}}
   NOTE: Moderate coverage (30-70%) - actionable patterns with medium confidence.
   {{/if}}
   {{#if (eq discovery_result.conversationCoverage.tier 3)}}
   NOTE: Strong coverage (>70%) - high confidence behavioral patterns.
   {{/if}}
{{/if}}

{{#if conversation_signals}}
8. **Gaps & Recommendations** — Where the current stated ICP diverges from the data. What the sales team should do differently based on these patterns.

9. **Data Quality Notes** — What data limitations affect confidence. What additional data would improve the analysis.
{{else}}
7. **Gaps & Recommendations** — Where the current stated ICP diverges from the data. What the sales team should do differently based on these patterns.

8. **Data Quality Notes** — What data limitations affect confidence. What additional data would improve the analysis.
{{/if}}

CRITICAL RULES:
- Do NOT make up data. Only reference patterns with sufficient sample size (5+ deals). Flag low-confidence findings explicitly.
- Do NOT invent or rename industries. Use ONLY the exact industry names from the Industry Analysis section above.
- Every number (win rate, deal size, count) you cite MUST come from the data above. If a metric is not in the data, do not fabricate it.

Keep it concise and actionable. Use real deal sizes and percentages from the data.

{{voiceBlock}}`,
      outputKey: 'report',
      parseAs: 'markdown',
    },
  ],

  schedule: {
    cron: '0 6 1 * *', // Monthly on 1st at 6am
    trigger: ['on_demand'],
  },

  outputFormat: 'slack',
  estimatedDuration: '90s',

  evidenceSchema: {
    entity_type: 'deal',
    columns: [
      { key: 'deal_name', display: 'Deal Name', format: 'text' },
      { key: 'amount', display: 'Amount', format: 'currency' },
      { key: 'outcome', display: 'Outcome', format: 'text' },
      { key: 'industry', display: 'Industry', format: 'text' },
      { key: 'company_size', display: 'Company Size', format: 'text' },
      { key: 'personas_involved', display: 'Personas Involved', format: 'text' },
      { key: 'icp_grade', display: 'ICP Grade', format: 'text' },
      { key: 'win_rate_segment', display: 'Segment Win Rate', format: 'percentage' },
      { key: 'lead_source', display: 'Lead Source', format: 'text' },
    ],
  },
};
