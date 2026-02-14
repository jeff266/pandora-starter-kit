import type { SkillDefinition } from '../types.js';

export const bowtieAnalysisSkill: SkillDefinition = {
  id: 'bowtie-analysis',
  name: 'Bowtie Funnel Analysis',
  description: 'Dynamic full-funnel analysis: pre-sale conversion, post-sale retention, bottleneck identification, and activity-outcome correlation. Adapts to workspace funnel definition.',
  version: '2.0.0',
  category: 'pipeline',
  tier: 'mixed',

  requiredTools: ['prepareBowtieSummary'],
  requiredContext: ['definitions'],

  steps: [
    {
      id: 'compute-bowtie',
      name: 'Compute Dynamic Funnel Metrics',
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

FUNNEL MODEL: {{bowtie_data.funnel.definition.model_label}} ({{bowtie_data.funnel.definition.model_type}})
{{#if (eq bowtie_data.funnel.status "discovered")}}
⚠️ This funnel was auto-detected and has not been confirmed by the user.
{{/if}}

PRE-SALE FUNNEL STAGES:
{{{json bowtie_data.leftSideFunnel.stages}}}

CONVERSION RATES:
{{{json bowtie_data.conversions.conversions}}}

BOTTLENECKS:
{{{json bowtie_data.bottlenecks}}}

ACTIVITY CORRELATION:
{{{json bowtie_data.activityCorrelation}}}

{{#if bowtie_data.rightSideFunnel}}
POST-SALE FUNNEL STAGES:
{{{json bowtie_data.rightSideFunnel.stages}}}
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
      name: 'Generate Dynamic Funnel Report',
      tier: 'claude',
      dependsOn: ['compute-bowtie', 'classify-bottlenecks'],
      claudePrompt: `You are a VP of Revenue Operations delivering a full-funnel analysis. Be specific with numbers, trends, and recommendations. No generic advice.

{{#if dataFreshness.isStale}}
⚠️ DATA FRESHNESS: {{dataFreshness.staleCaveat}}
{{/if}}

# Funnel Model: {{bowtie_data.funnel.definition.model_label}}
Type: {{bowtie_data.funnel.definition.model_type}}
{{#if (eq bowtie_data.funnel.status "discovered")}}
Status: Auto-detected (not yet confirmed by user)
{{else}}
Status: {{bowtie_data.funnel.status}}
{{/if}}

# Pre-Sale Funnel

## Stage Volumes
{{#each bowtie_data.leftSideFunnel.stages}}
{{#unless this.unmapped}}
- **{{this.label}}**: {{this.total}} total ({{this.new_this_month}} new this month, {{this.new_last_month}} last month)
{{else}}
- **{{this.label}}**: ⚠️ Not mapped to CRM data
{{/unless}}
{{/each}}

## Conversion Rates (Current vs Prior Month)
{{#each bowtie_data.conversions.conversions}}
- **{{this.from_label}} → {{this.to_label}}**: {{this.current_month.converted}}/{{this.current_month.total}} = {{this.current_month.rate}} (was {{this.prior_month.rate}}, {{this.trend}}, {{this.delta_pp}} change)
{{/each}}

Total funnel efficiency: {{bowtie_data.conversions.totalFunnelEfficiency}}

{{#if bowtie_data.rightSideFunnel.stages}}
# Post-Sale Funnel
{{#each bowtie_data.rightSideFunnel.stages}}
{{#unless this.unmapped}}
- **{{this.label}}**: {{this.total}} total
{{/unless}}
{{/each}}
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
- Gap: {{bowtie_data.activityCorrelation.activityGap.activities_delta}} more activities for won deals
{{/if}}

Write a funnel analysis covering:
1. Funnel headline: one sentence on overall health using the workspace's stage names
2. Top conversion bottleneck and specific fix (use actual stage names from this funnel)
3. Volume vs conversion: where is the bigger problem?
4. Activity prescription: what should reps do more/less of?
{{#if bowtie_data.rightSideFunnel.stages}}
5. Post-sale health: retention risk or expansion opportunity
{{/if}}
6. One metric to watch this week

IMPORTANT: Use this workspace's funnel stage names ({{bowtie_data.funnel.definition.model_label}}) throughout your analysis. Do NOT use generic terms like "Lead", "MQL", "SQL" unless those are actually this workspace's stage names.

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
