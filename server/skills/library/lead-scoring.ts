/**
 * Lead Scoring v1 Skill
 *
 * Point-based scoring for open deals and contacts.
 * Runs post-sync and on-demand to keep scores fresh.
 */

import type { SkillDefinition } from '../types.js';

export const leadScoringSkill: SkillDefinition = {
  id: 'lead-scoring',
  name: 'Lead Scoring',
  description: 'Scores open deals and contacts using engagement, threading, velocity, and custom field signals',
  version: '1.0.0',
  category: 'scoring',
  tier: 'compute',

  requiredTools: ['scoreLeads'],
  requiredContext: [],

  steps: [
    {
      id: 'compute-scores',
      name: 'Compute Lead Scores',
      tier: 'compute',
      computeFn: 'scoreLeads',
      computeArgs: {},
      outputKey: 'scoring_result',
    },

    {
      id: 'classify-deals',
      name: 'Classify Top & Bottom Deals',
      tier: 'deepseek',
      dependsOn: ['compute-scores'],
      deepseekPrompt: `You are a sales operations analyst classifying scored deals by their strengths and risks.

For each deal below, provide:
1. primary_strength: one of [strong_engagement, well_threaded, high_velocity, strong_fit, balanced]
2. primary_risk: one of [single_threaded, stale_engagement, no_conversations, slow_velocity, poor_fit, none]
3. recommended_action: one sentence, specific and actionable

Deals to classify:
{{{json scoring_result.topDeals}}}

{{{json scoring_result.bottomDeals}}}

Respond with ONLY a JSON object in this format:
{
  "classifications": [
    {
      "dealId": "string",
      "dealName": "string",
      "primaryStrength": "string",
      "primaryRisk": "string",
      "recommendedAction": "string"
    }
  ]
}`,
      outputKey: 'classifications',
      parseAs: 'json',
    },

    {
      id: 'synthesize-report',
      name: 'Generate Scoring Report',
      tier: 'claude',
      dependsOn: ['compute-scores', 'classify-deals'],
      claudePrompt: `You are a sales operations analyst delivering a lead scoring report. Be specific with deal names, dollar amounts, and rep names. Focus on what's actionable.

{{#if dataFreshness.isStale}}
⚠️ DATA FRESHNESS: {{dataFreshness.staleCaveat}}
{{/if}}

{{#unless dataFreshness.hasContacts}}
NOTE: Contact data not available. Scores based on deal and account attributes only.
Contact-based signals (stakeholder coverage, multi-threading) are not factored into scores.
{{/unless}}

# Scoring Summary

- Total Deals Scored: {{scoring_result.summaryStats.totalDeals}}
- Average Deal Score: {{scoring_result.summaryStats.avgDealScore}}
- Grade Distribution:
  - A: {{scoring_result.summaryStats.gradeDistribution.A}}
  - B: {{scoring_result.summaryStats.gradeDistribution.B}}
  - C: {{scoring_result.summaryStats.gradeDistribution.C}}
  - D: {{scoring_result.summaryStats.gradeDistribution.D}}
  - F: {{scoring_result.summaryStats.gradeDistribution.F}}

# Top Opportunities (Highest Scores)

{{#each scoring_result.summaryStats.topDeals}}
- **{{this.name}}** — Score: {{this.score}} ({{this.grade}})
  {{#with (lookup ../classifications.classifications this.id)}}
  - Strength: {{this.primaryStrength}}
  - Risk: {{this.primaryRisk}}
  - Action: {{this.recommendedAction}}
  {{/with}}
{{/each}}

# Deals Needing Attention (Low Scores, High Value)

{{#each scoring_result.summaryStats.bottomDeals}}
- **{{this.name}}** — Score: {{this.score}} ({{this.grade}})
  {{#with (lookup ../classifications.classifications this.id)}}
  - Primary Risk: {{this.primaryRisk}}
  - Action: {{this.recommendedAction}}
  {{/with}}
{{/each}}

{{#if scoring_result.summaryStats.movers}}
# Biggest Score Changes

{{#each scoring_result.summaryStats.movers}}
- **{{this.name}}** — {{this.from}} → {{this.to}} ({{#if (gt this.change 0)}}+{{/if}}{{this.change}} pts)
{{/each}}
{{/if}}

# Rep Performance

{{#each scoring_result.summaryStats.repScores}}
- {{@key}}: Avg score {{this.avgScore}} across {{this.dealCount}} deals
{{/each}}

{{#if scoring_result.customFieldContributions}}
# Custom Field Insights

{{#each scoring_result.customFieldContributions}}
- **{{this.fieldKey}}**: avg contribution {{this.avgPoints}} pts
  - Top value: "{{this.topValue}}" ({{this.topValueScore}} pts)
{{/each}}
{{/if}}

---

Write a Slack-ready report covering:
1. **Headline**: Overall pipeline quality score (avg deal grade) and what it means
2. **Top Opportunities**: Which A/B grade deals to prioritize with specific next steps
3. **Deals at Risk**: Which D/F grade deals need intervention and why
4. **Score Movers**: What changed significantly and what that signals
5. **Rep Comparison**: Whose deals score highest/lowest on average and why
6. **One Custom Field Insight**: If a discovered field significantly differentiates scores (e.g., "Zoominfo-sourced deals score 23 points higher on average")

Keep it concise, actionable, and use real deal names and dollar amounts from the data.

{{voiceBlock}}`,
      model: 'sonnet',
      outputKey: 'report',
      parseAs: 'markdown',
    },
  ],

  schedule: {
    cron: '0 7 * * 1', // Monday 7am
    trigger: ['post_sync', 'on_demand'],
  },

  outputFormat: 'slack',
  estimatedDuration: '45s',

  evidenceSchema: {
    entity_type: 'deal',
    columns: [
      { key: 'deal_name', display: 'Deal Name', format: 'text' },
      { key: 'amount', display: 'Amount', format: 'currency' },
      { key: 'stage', display: 'Stage', format: 'text' },
      { key: 'owner', display: 'Owner', format: 'text' },
      { key: 'score', display: 'Lead Score', format: 'number' },
      { key: 'grade', display: 'Grade', format: 'text' },
      { key: 'primary_strength', display: 'Primary Strength', format: 'text' },
      { key: 'primary_risk', display: 'Primary Risk', format: 'text' },
      { key: 'recommended_action', display: 'Recommended Action', format: 'text' },
    ],
  },
};
