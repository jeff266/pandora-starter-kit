import type { SkillDefinition } from '../types.js';

export const bowtieAnalysisSkill: SkillDefinition = {
  id: 'bowtie-analysis',
  name: 'Bowtie Funnel Analysis',
  description: 'Full-funnel bowtie analysis: left-side lead-to-close conversion, right-side post-sale retention, bottleneck identification, and activity-outcome correlation.',
  version: '1.0.0',
  category: 'pipeline',
  tier: 'mixed',

  requiredTools: ['prepareBowtieSummary'],
  requiredContext: ['definitions'],

  steps: [
    {
      id: 'compute-bowtie',
      name: 'Compute Bowtie Funnel Metrics',
      tier: 'compute',
      computeFn: 'prepareBowtieSummary',
      computeArgs: {},
      outputKey: 'bowtie_data',
    },

    {
      id: 'classify-bottlenecks',
      name: 'Classify Bottleneck Patterns',
      tier: 'deepseek',
      dependsOn: ['compute-bowtie'],
      deepseekPrompt: `You are a revenue operations analyst identifying funnel bottleneck patterns.

Given this bowtie funnel data, classify each bottleneck and recommend specific interventions.

LEFT-SIDE FUNNEL:
{{{json bowtie_data.leftSideFunnel}}}

CONVERSION RATES:
{{{json bowtie_data.conversions}}}

BOTTLENECKS:
{{{json bowtie_data.bottlenecks}}}

ACTIVITY CORRELATION:
{{{json bowtie_data.activityCorrelation}}}

{{#if bowtie_data.rightSideFunnel}}
RIGHT-SIDE FUNNEL:
{{{json bowtie_data.rightSideFunnel}}}
{{/if}}

For each bottleneck, provide:
1. severity: critical | high | medium | low
2. root_cause: one of [volume_deficit, conversion_drop, velocity_slowdown, activity_gap, data_quality]
3. intervention: specific, actionable recommendation (one sentence)
4. expected_impact: estimated improvement if addressed

Respond with ONLY a JSON object:
{
  "bottleneck_classifications": [
    {
      "stage_transition": "string",
      "severity": "string",
      "root_cause": "string",
      "intervention": "string",
      "expected_impact": "string"
    }
  ],
  "overall_funnel_health": "healthy | at_risk | critical",
  "primary_constraint": "string"
}`,
      outputKey: 'bottleneck_classifications',
      parseAs: 'json',
    },

    {
      id: 'synthesize-report',
      name: 'Generate Bowtie Report',
      tier: 'claude',
      dependsOn: ['compute-bowtie', 'classify-bottlenecks'],
      claudePrompt: `You are a VP of Revenue Operations delivering a full-funnel bowtie analysis. Be specific with numbers, trends, and recommendations. No generic advice.

{{#if dataFreshness.isStale}}
⚠️ DATA FRESHNESS: {{dataFreshness.staleCaveat}}
{{/if}}

# Left-Side Funnel (Lead → Close)

## Contact Lifecycle Stages
{{#each bowtie_data.leftSideFunnel.contactStages}}
- {{this.stage}}: {{this.total}} total ({{this.new_this_month}} new this month, {{this.new_last_month}} last month)
{{/each}}

## Deal Creation (SAO)
- Open deals: {{bowtie_data.leftSideFunnel.dealCreation.total_open_deals}}
- New this month: {{bowtie_data.leftSideFunnel.dealCreation.new_this_month}} (last month: {{bowtie_data.leftSideFunnel.dealCreation.new_last_month}})
- Pipeline created: \${{bowtie_data.leftSideFunnel.dealCreation.pipeline_created_this_month}}

## Won Deals
- Won this month: {{bowtie_data.leftSideFunnel.wonDeals.won_this_month}} (\${{bowtie_data.leftSideFunnel.wonDeals.won_amount_this_month}})
- Last month: {{bowtie_data.leftSideFunnel.wonDeals.won_last_month}} (\${{bowtie_data.leftSideFunnel.wonDeals.won_amount_last_month}})
- Avg deal size: \${{bowtie_data.leftSideFunnel.wonDeals.avg_deal_size}}

# Conversion Rates
{{#each bowtie_data.conversions.conversions}}
- {{@key}}: {{this.current_month}} ({{this.trend}}, {{this.delta}}pp change)
{{/each}}
- End-to-end efficiency: {{bowtie_data.conversions.totalFunnelEfficiency}}

{{#if bowtie_data.rightSideFunnel.stages}}
# Right-Side Funnel (Post-Sale)
{{#each bowtie_data.rightSideFunnel.stages}}
- {{this.stage}}: {{this.deals}} deals (\${{this.total_value}})
{{/each}}
{{#if bowtie_data.rightSideFunnel.churn}}
- Churn (90d): {{bowtie_data.rightSideFunnel.churn.churned_count}} accounts (\${{bowtie_data.rightSideFunnel.churn.churned_value}})
{{/if}}
{{/if}}

# Bottleneck Analysis
Overall funnel health: {{bottleneck_classifications.overall_funnel_health}}
Primary constraint: {{bottleneck_classifications.primary_constraint}}

{{#each bottleneck_classifications.bottleneck_classifications}}
- **{{this.stage_transition}}** [{{this.severity}}]: {{this.root_cause}} — {{this.intervention}} (Impact: {{this.expected_impact}})
{{/each}}

# Activity Correlation
{{#if bowtie_data.activityCorrelation.won}}
- Won deals avg: {{bowtie_data.activityCorrelation.won.avg_activities}} activities ({{bowtie_data.activityCorrelation.won.avg_meetings}} meetings, {{bowtie_data.activityCorrelation.won.avg_calls}} calls)
- Lost deals avg: {{bowtie_data.activityCorrelation.not_won.avg_activities}} activities
{{/if}}

Write a bowtie analysis covering:
1. Funnel headline: one sentence on overall health
2. Top conversion bottleneck and specific fix
3. Volume vs conversion: where is the bigger problem?
4. Activity prescription: what should reps do more/less of?
{{#if bowtie_data.rightSideFunnel.stages}}
5. Post-sale health: retention risk or expansion opportunity
{{/if}}
6. One metric to watch this week

Keep it under 600 words. This is for the Monday ops review.`,
      maxTokens: 2500,
      outputKey: 'report',
    },
  ],

  outputFormat: {
    type: 'narrative',
    sections: ['funnel_headline', 'bottleneck_fix', 'volume_vs_conversion', 'activity_prescription', 'metric_to_watch'],
  },
};
