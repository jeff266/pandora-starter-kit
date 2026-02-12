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

  requiredTools: ['discoverICP'],
  requiredContext: [],

  steps: [
    {
      id: 'discover-patterns',
      name: 'Discover ICP Patterns',
      tier: 'compute',
      computeFn: 'discoverICP',
      computeArgs: {},
      outputKey: 'discovery_result',
    },

    {
      id: 'classify-insights',
      name: 'Classify Insight Quality',
      tier: 'deepseek',
      dependsOn: ['discover-patterns'],
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
      dependsOn: ['discover-patterns', 'classify-insights'],
      claudePrompt: `You are a revenue intelligence analyst delivering an ICP Discovery report based on real deal outcome data. Be specific with numbers, percentages, and dollar amounts. This is descriptive analysis — patterns observed, not predictions.

## Data Analyzed

**Mode:** {{discovery_result.mode}}
**Deals:** {{discovery_result.metadata.dealsAnalyzed}} closed ({{discovery_result.metadata.wonCount}} won, {{discovery_result.metadata.lostCount}} lost)
**Contact Roles:** {{discovery_result.dataReadiness.totalContactRoles}} across {{discovery_result.dataReadiness.dealsWithContacts}} deals
**Custom Fields:** {{discovery_result.dataReadiness.customFieldsAvailable}} discovered and integrated
**Execution:** {{discovery_result.metadata.executionMs}}ms

## Persona Patterns Discovered

Top personas by lift (frequency in won deals vs lost deals):

{{#each discovery_result.personas}}
{{@index}}. **{{this.name}}** ({{this.dealCount}} deals)
   - Lift: {{this.lift}}x (appears in {{multiply this.frequency_in_won 100}}% of won deals vs {{multiply this.frequency_in_lost 100}}% of lost)
   - Top titles: {{join this.topTitles ", "}}
   - Top buying roles: {{join this.topBuyingRoles ", "}}
   - Avg deal size won: ${{formatNumber this.avgDealSizeWon}}
   - Confidence: {{this.confidence}}
{{/each}}

## Winning Buying Committees

Committee combinations with highest win rates:

{{#each discovery_result.committees}}
{{@index}}. **{{join this.personaNames " + "}}**
   - Win rate: {{multiply this.winRate 100}}% ({{this.wonCount}}/{{this.totalCount}} deals)
   - Lift: {{this.lift}}x vs baseline
   - Avg deal size: ${{formatNumber this.avgDealSize}}
{{/each}}

## Company Sweet Spots

{{#each discovery_result.companyProfile.sweetSpots}}
- **{{this.description}}**: {{multiply this.winRate 100}}% win rate ({{this.count}} deals, {{this.lift}}x lift)
{{/each}}

## Industry Analysis

{{#each discovery_result.companyProfile.industryWinRates}}
- **{{this.industry}}**: {{multiply this.winRate 100}}% win rate across {{this.count}} deals, avg ${{formatNumber this.avgDeal}}
{{/each}}

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

---

Write a Slack-ready ICP report covering:

1. **ICP Summary** — In 2-3 sentences, who does this company actually sell to successfully? Be specific about industry, company profile, and buying committee composition.

2. **Winning Personas** — The 3-5 personas most correlated with won deals. For each: title patterns, department, seniority, frequency in won deals, and lift score. Call out which persona is the strongest positive signal.

3. **Ideal Buying Committee** — The combination of personas with the highest win rate. "When you have [X] AND [Y] in the deal, you win at Z% — versus W% baseline."

4. **Company Sweet Spot** — Industry, size, and any custom field values that define the ideal target. Include win rates.

5. **Acquisition Channel Insights** — Which lead sources produce the highest quality pipeline (conversion rate × win rate × deal size). If lead data is available.

6. **Custom Field Discoveries** — Any customer-specific fields that strongly segment outcomes. "Deals with [Field = Value] win at X% versus Y% for [Field = Other Value]."

7. **Gaps & Recommendations** — Where the current stated ICP diverges from the data. What the sales team should do differently based on these patterns.

8. **Data Quality Notes** — What data limitations affect confidence. What additional data would improve the analysis.

Do NOT make up data. Only reference patterns with sufficient sample size (5+ deals). Flag low-confidence findings explicitly.

Keep it concise and actionable. Use real deal sizes and percentages from the data.`,
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
};
