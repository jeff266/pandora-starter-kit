import type { SkillDefinition } from '../types.js';

export const forecastModelSkill: SkillDefinition = {
  id: 'forecast-model',
  name: 'Forecast Model',
  description: 'Probability-weighted quarterly forecast with rep haircuts, in-quarter pipeline creation projections, and bear/base/bull scenarios. Replaces simple pipeline category rollups with deal-level probability scoring.',
  version: '1.0.0',
  category: 'forecasting',
  tier: 'mixed',

  requiredTools: [
    'resolveTimeWindows',
    'fmScoreOpenDeals',
    'fmApplyRepHaircuts',
    'fmComputePipelineProjection',
    'fmBuildForecastModel',
    'calculateOutputBudget',
  ],

  requiredContext: ['business_model'],

  timeConfig: {
    analysisWindow: 'current_quarter',
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
        analysisWindow: 'current_quarter',
        changeWindow: 'last_7d',
        trendComparison: 'previous_period',
      },
      outputKey: 'time_windows',
    },

    {
      id: 'score-open-deals',
      name: 'Score All Open Deals',
      tier: 'compute',
      dependsOn: ['resolve-time-windows'],
      computeFn: 'fmScoreOpenDeals',
      computeArgs: {},
      outputKey: 'scored_deals',
    },

    {
      id: 'apply-rep-haircuts',
      name: 'Apply Rep Forecast Haircuts',
      tier: 'compute',
      dependsOn: ['score-open-deals'],
      computeFn: 'fmApplyRepHaircuts',
      computeArgs: {},
      outputKey: 'adjusted_deals',
    },

    {
      id: 'compute-pipeline-projection',
      name: 'Compute In-Quarter Pipeline Projection',
      tier: 'compute',
      dependsOn: ['resolve-time-windows'],
      computeFn: 'fmComputePipelineProjection',
      computeArgs: {},
      outputKey: 'pipeline_projection',
    },

    {
      id: 'build-forecast-model',
      name: 'Build Forecast Model',
      tier: 'compute',
      dependsOn: ['apply-rep-haircuts', 'compute-pipeline-projection'],
      computeFn: 'fmBuildForecastModel',
      computeArgs: {},
      outputKey: 'forecast_model',
    },

    {
      id: 'identify-forecast-risks',
      name: 'Identify Forecast Risks',
      tier: 'deepseek',
      dependsOn: ['build-forecast-model'],
      deepseekPrompt: `You are a forecast risk analyst. Classify the risk profile of each deal in the commit and best-case tiers.

FORECAST MODEL:
{{{json forecast_model}}}

TOP DEALS (by weighted amount):
{{{json adjusted_deals}}}

TIME WINDOWS:
{{{json time_windows}}}

For each deal in the top 20 by weighted_amount, classify its risk type. Return a JSON array:
[
  {
    "deal_id": "string",
    "deal_name": "string",
    "risk_type": "over_weighted" | "cliff_deal" | "close_date_risk" | "rep_pattern_risk" | "velocity_risk" | "healthy",
    "evidence": "one-sentence explanation citing specific data",
    "severity": "critical" | "warning" | "info"
  }
]

Definitions:
- over_weighted: scored high but has data_gaps (no calls, no contacts, no benchmarks) — probability may be overstated
- cliff_deal: very large deal (>25% of commit tier), binary outcome — closes or goes to $0
- close_date_risk: close date is within 14 days OR deal has pushed before (check signals.regressions > 0)
- rep_pattern_risk: rep's adjusted amount is significantly below raw weighted_amount (haircut_factor < 0.8)
- velocity_risk: days_in_stage > benchmark_p90 (deal is slower than 90% of historical deals)
- healthy: probability well-supported by data, progressing normally

Return ONLY the JSON array.`,
      outputKey: 'risk_classifications',
    },

    {
      id: 'calculate-output-budget',
      name: 'Calculate Output Budget',
      tier: 'compute',
      dependsOn: ['build-forecast-model', 'identify-forecast-risks'],
      computeFn: 'calculateOutputBudget',
      computeArgs: {},
      outputKey: 'output_budget',
    },

    {
      id: 'synthesize-forecast-report',
      name: 'Synthesize Quarterly Forecast Report',
      tier: 'claude',
      dependsOn: [
        'resolve-time-windows',
        'apply-rep-haircuts',
        'build-forecast-model',
        'identify-forecast-risks',
        'calculate-output-budget',
      ],
      claudePrompt: `You are the VP of Revenue Operations presenting the quarterly forecast to the CRO and CFO for {{business_model.company_name}}.

FORECAST MODEL OUTPUT:
{{{json forecast_model}}}

RISK CLASSIFICATIONS:
{{{json risk_classifications}}}

TOP DEALS (probability-scored with haircuts):
{{{json adjusted_deals}}}

TIME WINDOWS:
{{{json time_windows}}}

OUTPUT GUIDANCE:
{{{json output_budget}}}

STRUCTURE YOUR REPORT:

1. **THE CALL** (2-3 sentences)
   - "We expect to land between $bear and $bull, with base case of $base"
   - State the base case as the working number
   - One sentence on confidence level and what drives the range width

2. **HOW WE GOT HERE** (probability-weighted model breakdown)
   - Closed-Won (locked): show amount and deal count
   - Commit Tier (>70% probability): raw vs haircut-adjusted amount
   - Best Case Tier (40-70%): raw vs haircut-adjusted amount
   - Pipeline Tier (<40%): weighted contribution
   - In-Quarter Pipeline Creation: projected bookings from not-yet-created pipeline
   - Explain rep haircuts in plain language if applied

3. **THE RISKS**
   - Concentration: if top 3 deals are >50% of commit tier, flag it
   - Cliff deals: binary outcomes that swing the range
   - Close date risks: deals that have pushed before
   - Velocity risks: deals slower than benchmarks
   - Rep pattern risks: over-committers with big deals

4. **REP STATUS**
   - Table: Rep | Closed-Won | Commit | Best Case | Total Forecast | Haircut Applied
   - Flag any rep whose forecast relies on 1-2 deals

5. **UPSIDE AND DOWNSIDE SCENARIOS**
   - Bull case: what needs to go right
   - Bear case: what could go wrong
   - In-quarter creation: realistic given current pace?

6. **THIS QUARTER'S ACTIONS** (3-5 specific items)
   - Name specific deals and owners
   - Reference probability scores and risk factors

{{voiceBlock}}

After the report, emit an <actions> block:
[{
  "action_type": "accelerate_deal" | "flag_at_risk" | "schedule_review",
  "severity": "critical" | "warning" | "info",
  "title": "short title",
  "summary": "1-2 sentences with specific evidence",
  "recommended_steps": ["step1", "step2"],
  "target_deal_name": "exact deal name",
  "owner_email": "rep email if known",
  "impact_amount": deal amount as number,
  "urgency_label": "overdue" | "this_week" | "next_week"
}]
<actions>[]</actions>

Word budget: {{output_budget.target_words}} words.`,
      outputKey: 'narrative',
    },
  ],

  schedule: {
    cron: '0 8 1 * *',
    trigger: 'on_demand',
  },

  outputFormat: 'markdown',
  estimatedDuration: '90s',

  evidenceSchema: {
    entity_type: 'deal',
    columns: [
      { key: 'deal_name', display: 'Deal', format: 'text' },
      { key: 'amount', display: 'Amount', format: 'currency' },
      { key: 'stage', display: 'Stage', format: 'text' },
      { key: 'probability', display: 'Probability', format: 'number' },
      { key: 'weighted_amount', display: 'Weighted Amount', format: 'currency' },
      { key: 'adjusted_amount', display: 'Haircut-Adjusted', format: 'currency' },
      { key: 'risk_type', display: 'Risk Type', format: 'text' },
      { key: 'owner', display: 'Owner', format: 'text' },
      { key: 'close_date', display: 'Close Date', format: 'date' },
    ],
  },
};
