import type { SkillDefinition } from '../types.js';

export const monteCarloForecastSkill: SkillDefinition = {
  id: 'monte-carlo-forecast',
  name: 'Monte Carlo Revenue Forecast',
  description: 'Probabilistic year-end revenue forecast using 10,000 simulations fit to actual historical deal data. Returns P10–P90 range, probability of hitting quota, and variance driver ranking.',
  version: '1.0.0',
  category: 'forecasting',
  tier: 'mixed',

  requiredTools: [
    'mcResolveForecastWindow',
    'mcFitDistributions',
    'mcLoadOpenDeals',
    'mcComputeRiskAdjustments',
    'mcRunSimulation',
    'calculateOutputBudget',
  ],

  requiredContext: ['goals_and_targets'],

  steps: [
    // ── Step 1: Resolve forecast window & quota ────────────────────────────
    {
      id: 'resolve-forecast-window',
      name: 'Resolve Forecast Window & Quota',
      tier: 'compute',
      computeFn: 'mcResolveForecastWindow',
      computeArgs: {},
      outputKey: 'forecast_window',
    },

    // ── Step 2: Fit probability distributions ─────────────────────────────
    {
      id: 'fit-distributions',
      name: 'Fit Historical Distributions',
      tier: 'compute',
      dependsOn: ['resolve-forecast-window'],
      computeFn: 'mcFitDistributions',
      computeArgs: {},
      outputKey: 'distributions',
    },

    // ── Step 3: Load open deals ────────────────────────────────────────────
    {
      id: 'load-open-deals',
      name: 'Load Open Deals for Simulation',
      tier: 'compute',
      dependsOn: ['resolve-forecast-window'],
      computeFn: 'mcLoadOpenDeals',
      computeArgs: {},
      outputKey: 'open_deals',
    },

    // ── Step 4: Compute deal risk adjustments ─────────────────────────────
    {
      id: 'compute-risk-adjustments',
      name: 'Compute Deal Risk Adjustments',
      tier: 'compute',
      dependsOn: ['load-open-deals'],
      computeFn: 'mcComputeRiskAdjustments',
      computeArgs: {},
      outputKey: 'risk_adjustments',
    },

    // ── Step 5: Run 10,000-iteration simulation ────────────────────────────
    {
      id: 'run-simulation',
      name: 'Run Monte Carlo Simulation (10,000 iterations)',
      tier: 'compute',
      dependsOn: ['fit-distributions', 'load-open-deals', 'compute-risk-adjustments', 'resolve-forecast-window'],
      computeFn: 'mcRunSimulation',
      computeArgs: {},
      outputKey: 'simulation',
    },

    // ── Step 6: DeepSeek risk classification ──────────────────────────────
    {
      id: 'classify-risk-signals',
      name: 'Classify Risk Signals & Opportunities',
      tier: 'deepseek',
      dependsOn: ['run-simulation', 'compute-risk-adjustments'],
      deepseekPrompt: `You are a revenue analyst reviewing a Monte Carlo sales forecast.

SIMULATION RESULTS:
- P10 (downside): {{simulation.simulation.p10}}
- P50 (most likely): {{simulation.simulation.p50}}
- P90 (upside): {{simulation.simulation.p90}}
{{#if forecast_window.hasQuota}}- Probability of hitting target: {{simulation.simulation.probOfHittingTarget}}{{/if}}
- Forecast window end: {{forecast_window.forecastWindowEnd}}

TOP VARIANCE DRIVERS:
{{{json simulation.varianceDrivers}}}

HIGH-RISK DEALS (risk adjustments applied):
{{{json risk_adjustments.topRiskyDeals}}}

DATA QUALITY WARNINGS:
{{{json simulation.simulation.dataQuality.warnings}}}

For each item in VARIANCE DRIVERS and HIGH-RISK DEALS, classify as:
- "forecast_risk": actively suppressing the forecast number
- "growth_opportunity": if addressed, would meaningfully improve P50
- "data_gap": insufficient data to assess; requires manual review

Respond with ONLY a JSON object:
{
  "classifications": [
    {
      "item": "string",
      "type": "forecast_risk | growth_opportunity | data_gap",
      "rationale": "one sentence",
      "estimatedImpact": "dollar estimate or null"
    }
  ]
}

Cap at 15 items. Prioritize: (1) variance drivers with high totalVariance, (2) deals with risk multiplier < 0.70, (3) unreliable distributions.`,
      outputKey: 'risk_classifications',
    },

    // ── Step 7: Dynamic output budget ─────────────────────────────────────
    {
      id: 'calculate-output-budget',
      name: 'Calculate Dynamic Output Budget',
      tier: 'compute',
      dependsOn: ['classify-risk-signals'],
      computeFn: 'calculateOutputBudget',
      computeArgs: {},
      outputKey: 'output_budget',
    },

    // ── Step 8: Claude synthesis ──────────────────────────────────────────
    {
      id: 'synthesize-forecast-narrative',
      name: 'Synthesize Monte Carlo Forecast Briefing',
      tier: 'claude',
      dependsOn: [
        'resolve-forecast-window',
        'fit-distributions',
        'run-simulation',
        'classify-risk-signals',
        'calculate-output-budget',
      ],
      claudePrompt: `You are a Chief Revenue Officer interpreting a probabilistic annual revenue forecast for your team.

BUSINESS CONTEXT:
{{business_model.company_name}} — {{business_model.industry}}
{{#if forecast_window.hasQuota}}Annual quota: $\{{forecast_window.quota}}{{else}}No quota configured.{{/if}}
Forecast window: today through {{forecast_window.forecastWindowEnd}} ({{forecast_window.daysRemaining}} days remaining)

DATA QUALITY TIER: {{simulation.dataQualityTier}}
{{#if distributions.dataQuality.warnings}}⚠ Warnings: {{{json distributions.dataQuality.warnings}}}{{/if}}

SIMULATION RESULTS (10,000 scenarios):
P10 (downside — 90% chance of exceeding): $\{{simulation.simulation.p10}}
P25 (conservative):                        $\{{simulation.simulation.p25}}
P50 (most likely outcome):                 $\{{simulation.simulation.p50}}
P75 (optimistic):                          $\{{simulation.simulation.p75}}
P90 (stretch — only 10% chance):           $\{{simulation.simulation.p90}}
{{#if forecast_window.hasQuota}}Probability of hitting $\{{forecast_window.quota}} target: {{simulation.simulation.probOfHittingTarget}}{{/if}}

COMPONENT BREAKDOWN (at P50):
- Revenue from existing pipeline: $\{{simulation.simulation.existingPipelineP50}} ({{simulation.componentBreakdown.existingPipelinePct}}%)
- Revenue from pipeline yet to be created: $\{{simulation.simulation.projectedPipelineP50}} ({{simulation.componentBreakdown.projectedPipelinePct}}%)

TOP VARIANCE DRIVERS (what moves the number most):
{{{json simulation.varianceDrivers}}}

RISK SIGNAL SOURCES:
{{{json risk_adjustments.signalSources}}}

DEEPSEEK RISK CLASSIFICATIONS:
{{{json risk_classifications}}}

OUTPUT GUIDANCE:
{{{json output_budget}}}

Produce a Monte Carlo Forecast Briefing with these sections:

1. THE RANGE (2-3 sentences)
   - Lead with P50: "Your most likely outcome is $X"
   {{#if forecast_window.hasQuota}}- State probability of hitting quota: "That gives you a Z% shot at your $Y target"{{/if}}
   - Note whether that's comfortable, tight, or at-risk

2. WHAT'S DRIVING THE NUMBER
   - Name the top 2 variance drivers in plain language
   - Distinguish existing pipeline vs future pipeline dependency
   {{#if (gt simulation.componentBreakdown.projectedPipelinePct 40)}}- IMPORTANT: {{simulation.componentBreakdown.projectedPipelinePct}}% of P50 depends on pipeline yet to be created — call this out{{/if}}

3. RISK FACTORS
   - For each forecast_risk classification: name it, dollar estimate, recommended action
   - Note any data quality issues widening the confidence interval

4. THE HIGHEST-LEVERAGE ACTION
   - One concrete action to most improve probability of hitting target
   - Quantify the impact: "Improving X by Y points would move P50 from $A to $B"

5. UPSIDE CASE
   - What must be true for P75 or P90 to materialize (2-3 sentences)

Rules:
- Lead with P50 and probability of hitting target every time
- Use specific dollar amounts throughout
- {{#if (not forecast_window.hasQuota)}}No quota configured — use range language instead of probability language{{/if}}
- {{#if (eq simulation.dataQualityTier 1)}}Tier 1 data: acknowledge limited history but still produce a useful range{{/if}}
- Do not explain how Monte Carlo works
- Every sentence states a finding or recommends an action

Word budget: {{output_budget.wordBudget}} words.`,
      outputKey: 'narrative',
    },
  ],

  schedule: {
    cron: '0 6 * * 1',  // Monday 6am — before forecast-rollup at 8am
    trigger: 'on_demand',
  },

  outputFormat: 'markdown',

  estimatedDuration: '60s',

  evidenceSchema: {
    entity_type: 'deal',
    columns: [
      { key: 'deal_name', display: 'Deal Name', format: 'text' },
      { key: 'amount', display: 'CRM Amount', format: 'currency' },
      { key: 'stage_normalized', display: 'Stage', format: 'text' },
      { key: 'owner_email', display: 'Owner', format: 'text' },
      { key: 'close_date', display: 'Close Date', format: 'date' },
      { key: 'risk_multiplier', display: 'Risk Adjustment', format: 'percentage' },
      { key: 'risk_signals', display: 'Risk Signals', format: 'text' },
    ],
  },
};
