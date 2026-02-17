import type { SkillDefinition } from '../types.js';

export const pipelineGenForecastSkill: SkillDefinition = {
  id: 'pipeline-gen-forecast',
  name: 'Pipeline Generation Forecast',
  description: 'Historical pipeline creation analysis with forward projections. Answers: "Are we creating enough pipeline? Will we have enough for next quarter?" Segments by source and rep.',
  version: '1.0.0',
  category: 'pipeline',
  tier: 'mixed',

  requiredTools: [
    'resolveTimeWindows',
    'pgfGatherCreationHistory',
    'pgfGatherInqtrCloseRates',
    'pgfComputeProjections',
    'calculateOutputBudget',
  ],

  requiredContext: ['business_model'],

  timeConfig: {
    analysisWindow: 'trailing_90d',
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
        analysisWindow: 'trailing_90d',
        changeWindow: 'last_7d',
        trendComparison: 'previous_period',
      },
      outputKey: 'time_windows',
    },

    {
      id: 'gather-creation-history',
      name: 'Gather Pipeline Creation History',
      tier: 'compute',
      dependsOn: ['resolve-time-windows'],
      computeFn: 'pgfGatherCreationHistory',
      computeArgs: { lookback_months: 12 },
      outputKey: 'creation_history',
    },

    {
      id: 'gather-inqtr-close-rates',
      name: 'Gather In-Quarter Close Rates',
      tier: 'compute',
      dependsOn: ['resolve-time-windows'],
      computeFn: 'pgfGatherInqtrCloseRates',
      computeArgs: { lookback_quarters: 4 },
      outputKey: 'inqtr_close_rates',
    },

    {
      id: 'compute-projections',
      name: 'Compute Pipeline Projections',
      tier: 'compute',
      dependsOn: ['gather-creation-history', 'gather-inqtr-close-rates'],
      computeFn: 'pgfComputeProjections',
      computeArgs: {},
      outputKey: 'projections',
    },

    {
      id: 'identify-pipeline-gaps',
      name: 'Identify Pipeline Generation Gaps',
      tier: 'deepseek',
      dependsOn: ['gather-creation-history', 'compute-projections'],
      deepseekPrompt: `You are a pipeline generation analyst. Identify gaps and risks in pipeline creation patterns.

CREATION HISTORY (monthly):
{{{json creation_history}}}

PROJECTIONS:
{{{json projections}}}

IN-QUARTER CLOSE RATES:
{{{json inqtr_close_rates}}}

Classify pipeline generation risks. Return a JSON array:
[
  {
    "gap_type": "source_declining" | "rep_underproducing" | "seasonal_risk" | "coverage_gap",
    "segment": "string (source name, rep name, or 'overall')",
    "severity": "critical" | "warning" | "info",
    "evidence": "one-sentence with specific numbers",
    "current_rate": number,
    "target_rate": number
  }
]

Definitions:
- source_declining: a lead source producing >20% less pipeline than 3 months ago
- rep_underproducing: a rep creating significantly less pipeline than peers (bottom quartile)
- seasonal_risk: historical pattern shows creation typically drops in this period
- coverage_gap: projected creation won't meet 3x pipeline coverage for quota

Return ONLY the JSON array.`,
      outputKey: 'pipeline_gaps',
    },

    {
      id: 'calculate-output-budget',
      name: 'Calculate Output Budget',
      tier: 'compute',
      dependsOn: ['compute-projections', 'identify-pipeline-gaps'],
      computeFn: 'calculateOutputBudget',
      computeArgs: {},
      outputKey: 'output_budget',
    },

    {
      id: 'synthesize-pipeline-gen-report',
      name: 'Synthesize Pipeline Generation Report',
      tier: 'claude',
      dependsOn: [
        'gather-creation-history',
        'gather-inqtr-close-rates',
        'compute-projections',
        'identify-pipeline-gaps',
        'calculate-output-budget',
      ],
      claudePrompt: `You are a Revenue Operations analyst delivering the pipeline generation forecast for {{business_model.company_name}}.

CREATION HISTORY:
{{{json creation_history}}}

IN-QUARTER CLOSE RATES:
{{{json inqtr_close_rates}}}

PROJECTIONS:
{{{json projections}}}

PIPELINE GAPS:
{{{json pipeline_gaps}}}

OUTPUT GUIDANCE:
{{{json output_budget}}}

STRUCTURE YOUR REPORT:

1. **Creation Trend**: Monthly pipeline creation rate for the last 12 months. Direction (increasing/stable/declining) and % change.

2. **Source Mix**: Which sources are growing vs declining? Break down by source if available.

3. **Rep Contribution**: Who's creating pipeline and who isn't? Flag reps significantly below average.

4. **In-Quarter Conversion**: Of pipeline created this quarter, what % historically closes in-quarter? How does this compare to last quarter?

5. **Current Quarter Projection**: Pipeline created so far + projected remaining creation → projected in-quarter bookings.

6. **Next Quarter Outlook**: At current pace, projected quarterly pipeline → projected bookings → coverage ratio vs quota. Gap to 3x coverage.

7. **Gap Analysis**: Specific source, rep, or segment shortfalls with numbers.

8. **Actions**: 3-5 specific investments needed (sources to accelerate, reps to coach, segments to expand).

{{voiceBlock}}

After the report, emit an <actions> block:
[{
  "action_type": "schedule_review" | "flag_at_risk",
  "severity": "critical" | "warning" | "info",
  "title": "short title",
  "summary": "1-2 sentences",
  "recommended_steps": ["step1", "step2"],
  "target_deal_name": null,
  "owner_email": null,
  "impact_amount": 0,
  "urgency_label": "this_week" | "next_week"
}]
<actions>[]</actions>`,
      outputKey: 'narrative',
    },
  ],

  schedule: {
    cron: '0 8 * * 1',
    trigger: 'on_demand',
  },

  outputFormat: 'markdown',
  estimatedDuration: '60s',

  evidenceSchema: {
    entity_type: 'workspace',
    columns: [
      { key: 'period', display: 'Period', format: 'text' },
      { key: 'deals_created', display: 'Deals Created', format: 'number' },
      { key: 'amount_created', display: 'Pipeline Created', format: 'currency' },
      { key: 'avg_deal_size', display: 'Avg Deal Size', format: 'currency' },
    ],
  },
};
