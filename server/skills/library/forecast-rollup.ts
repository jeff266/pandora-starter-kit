import type { SkillDefinition } from '../types.js';

export const forecastRollupSkill: SkillDefinition = {
  id: 'forecast-rollup',
  name: 'Forecast Roll-up',
  description: 'Aggregates pipeline by forecast category with bear/base/bull scenarios, concentration risk analysis, and AI-powered risk classification.',
  version: '3.0.0',
  category: 'forecasting',
  tier: 'mixed',

  requiredTools: [
    'checkQuotaConfig',
    'resolveTimeWindows',
    'forecastRollup',
    'gatherPreviousForecast',
    'forecastWoWDelta',
    'gatherDealConcentrationRisk',
    'prepareForecastSummary',
    'calculateOutputBudget',
  ],

  requiredContext: ['goals_and_targets'],

  timeConfig: {
    analysisWindow: 'current_quarter',
    changeWindow: 'last_7d',
    trendComparison: 'previous_period',
  },

  steps: [
    {
      id: 'check-quota-config',
      name: 'Check Quota Configuration',
      tier: 'compute',
      computeFn: 'checkQuotaConfig',
      computeArgs: {},
      outputKey: 'quota_config',
    },

    {
      id: 'resolve-time-windows',
      name: 'Resolve Time Windows',
      tier: 'compute',
      dependsOn: ['check-quota-config'],
      computeFn: 'resolveTimeWindows',
      computeArgs: {
        analysisWindow: 'current_quarter',
        changeWindow: 'last_7d',
        trendComparison: 'previous_period',
      },
      outputKey: 'time_windows',
    },

    {
      id: 'gather-forecast-data',
      name: 'Gather Forecast Category Aggregation',
      tier: 'compute',
      dependsOn: ['resolve-time-windows'],
      computeFn: 'forecastRollup',
      computeArgs: {},
      outputKey: 'forecast_data',
    },

    {
      id: 'gather-previous-forecast',
      name: 'Retrieve Previous Forecast Run',
      tier: 'compute',
      dependsOn: ['gather-forecast-data'],
      computeFn: 'gatherPreviousForecast',
      computeArgs: {},
      outputKey: 'previous_forecast',
    },

    {
      id: 'gather-wow-delta',
      name: 'Compare Week-over-Week',
      tier: 'compute',
      dependsOn: ['gather-forecast-data', 'gather-previous-forecast'],
      computeFn: 'forecastWoWDelta',
      computeArgs: {},
      outputKey: 'wow_delta',
    },

    {
      id: 'gather-deal-concentration-risk',
      name: 'Analyze Deal Concentration Risk',
      tier: 'compute',
      dependsOn: ['gather-forecast-data', 'check-quota-config'],
      computeFn: 'gatherDealConcentrationRisk',
      computeArgs: {},
      outputKey: 'concentration_risk',
    },

    {
      id: 'prepare-summary',
      name: 'Prepare Forecast Summary for AI',
      tier: 'compute',
      dependsOn: ['gather-forecast-data', 'gather-wow-delta', 'check-quota-config', 'gather-deal-concentration-risk'],
      computeFn: 'prepareForecastSummary',
      computeArgs: {},
      outputKey: 'forecast_summary',
    },

    {
      id: 'classify-forecast-risks',
      name: 'Classify Forecast Behavioral Risks',
      tier: 'deepseek',
      dependsOn: ['gather-forecast-data', 'gather-previous-forecast', 'gather-wow-delta', 'gather-deal-concentration-risk'],
      deepseekPrompt: `You are a sales forecast auditor analyzing rep behavior patterns for {{business_model.company_name}}.

CURRENT FORECAST DATA:
{{{json forecast_data}}}

PREVIOUS FORECAST (if available):
{{{json previous_forecast}}}

WEEK-OVER-WEEK CHANGES:
{{{json wow_delta}}}

CONCENTRATION RISK:
{{{json concentration_risk}}}

YOUR TASK:
Analyze the forecast data for behavioral red flags that indicate sandbagging, over-forecasting, or gaming.

Return a JSON array of risk classifications. Each entry should have:
{
  "rep_name": "string",
  "risk_type": "sandbagging" | "over_forecasting" | "whale_dependency" | "category_gaming" | "none",
  "severity": "high" | "medium" | "low",
  "evidence": "1-2 sentence explanation with specific numbers",
  "suggested_action": "Specific action to take this week"
}

DETECTION RULES:
1. **Sandbagging**: Rep consistently under-forecasts, then beats by >20%. Pipeline heavy but commit light.
2. **Over-forecasting**: Commit grew but WoW movement shows deals slipping. High commit with low probability.
3. **Whale dependency**: Single deal >30% of rep quota in commit. High concentration risk.
4. **Category gaming**: Unusual shifts between best_case/commit without deal progression. Stage unchanged but category improved.
5. **None**: No red flags detected.

REQUIREMENTS:
- Only flag HIGH severity if pattern is clear and current (this week's data)
- Provide specific dollar amounts and percentages in evidence
- Suggested actions must be executable this week (1:1 review, deal audit, etc.)
- If no risks detected for a rep, you can omit them from output
- Maximum 5 risk entries (prioritize highest severity)

Return ONLY the JSON array, no other text.`,
      outputKey: 'risk_classifications',
    },

    {
      id: 'calculate-output-budget',
      name: 'Calculate Dynamic Output Budget',
      tier: 'compute',
      dependsOn: ['classify-forecast-risks', 'gather-deal-concentration-risk'],
      computeFn: 'calculateOutputBudget',
      computeArgs: {},
      outputKey: 'output_budget',
    },

    {
      id: 'synthesize-narrative',
      name: 'Synthesize Executive Forecast Narrative',
      tier: 'claude',
      dependsOn: [
        'check-quota-config',
        'resolve-time-windows',
        'gather-forecast-data',
        'gather-previous-forecast',
        'gather-wow-delta',
        'gather-deal-concentration-risk',
        'prepare-summary',
        'classify-forecast-risks',
        'calculate-output-budget',
      ],
      claudePrompt: `You are a VP of Sales Operations providing a weekly forecast roll-up to sales leadership for {{business_model.company_name}}.

{{#if dataFreshness.isStale}}
⚠️ DATA FRESHNESS: {{dataFreshness.staleCaveat}}
{{/if}}

{{#if (eq dataFreshness.source 'file_import')}}
NOTE: Forecast based on file-imported data, not live CRM sync. Week-over-week comparison only available after multiple imports. Deal movements since last import are not reflected.
{{/if}}

{{forecast_summary.quotaNote}}

TIME WINDOW:
{{time_windows.analysisRange.quarter}} ({{time_windows.analysisRange.start}} to {{time_windows.analysisRange.end}})

TEAM FORECAST:
{{forecast_summary.teamSummary}}

DEAL COUNTS:
{{forecast_summary.dealCounts}}

REP-BY-REP BREAKDOWN:
{{forecast_summary.repTable}}

WEEK-OVER-WEEK CHANGES:
{{forecast_summary.wowSummary}}

CONCENTRATION RISK ANALYSIS:
{{{json concentration_risk}}}

BEHAVIORAL RISK CLASSIFICATIONS (AI-detected):
{{{json risk_classifications}}}

{{#if forecast_data.icpForecast}}
ICP-ADJUSTED FORECAST:
- Commit: \${{forecast_data.icpForecast.commit.total}} total
  - \${{forecast_data.icpForecast.commit.ab_grade}} in A/B-grade deals (high confidence)
  - \${{forecast_data.icpForecast.commit.cdf_grade}} in C/D/F-grade deals (lower confidence)
- Best Case: \${{forecast_data.icpForecast.best_case.total}} total
  - \${{forecast_data.icpForecast.best_case.ab_grade}} in A/B-grade deals
  - \${{forecast_data.icpForecast.best_case.cdf_grade}} in C/D/F-grade deals
- Pipeline: \${{forecast_data.icpForecast.pipeline.total}} total
  - \${{forecast_data.icpForecast.pipeline.ab_grade}} in A/B-grade deals
  - \${{forecast_data.icpForecast.pipeline.cdf_grade}} in C/D/F-grade deals

{{#if forecast_data.icpForecast.has_grade_adjusted}}
Grade-Adjusted Expected Value (based on historical close rates by ICP grade):
{{#each forecast_data.icpForecast.grade_close_rates}}
  - {{@key}}-grade: {{this}}% close rate
{{/each}}
- Adjusted commit: \${{forecast_data.icpForecast.grade_adjusted_commit}}
- Adjusted best case: \${{forecast_data.icpForecast.grade_adjusted_best_case}}
{{/if}}
{{/if}}

OUTPUT GUIDANCE:
{{{json output_budget}}}

YOUR TASK:
Write an executive forecast summary following the structure below. Use the output budget guidance to calibrate depth and word count.

## Executive Summary (1-2 sentences)
- One-sentence verdict: Are we on track to hit quota this quarter?
- Bear/Base/Bull scenarios with specific dollar amounts

## Forecast Position vs Quota
- **Bear Case**: $X (Y% of quota) — Only closed + commit
- **Base Case**: $X (Y% of quota) — Closed + commit + 50% best case
- **Bull Case**: $X (Y% of quota) — Closed + commit + best case
- **Weighted Forecast**: $X (Y% of quota) — Probability-adjusted
- **Risk-Adjusted Landing Zone**: Bear to Base range (explain why)

If quota not configured, use absolute numbers and note the gap.

## Category Breakdown & Confidence
- How much is truly committed vs speculative?
- Commit/Best Case ratio (higher = more confident forecast)
- Spread analysis: Bull - Bear = $X (Y% of quota)
  - If spread >30% quota: **High volatility** — forecast unreliable
  - If spread 15-30%: **Medium volatility** — watch closely
  - If spread <15%: **Low volatility** — stable forecast

{{#if forecast_data.icpForecast}}
## ICP Quality Analysis
- **A/B-grade pipeline concentration**: What % of commit/best case is high-fit?
  - If A/B < 50% of commit: Flag as **quality problem** even if total looks healthy
  - If commit heavily C/D/F: Flag as **forecast risk** — lower close rates expected
- **Grade-adjusted forecast**: If available, compare to raw forecast
  - If grade-adjusted < raw: **Over-forecasting risk** — deals are lower quality
  - If grade-adjusted > raw: **Under-forecasting** — deals are higher quality
  - Note: Grade-adjusted only shown when 5+ closed deals per grade (enough data)
{{/if}}

## Concentration Risk
- **Top 3 Deals**: List name, amount, category, owner, probability
  - Combined weighted value: $X (Y% of base case)
  - If >50%: **CRITICAL** — forecast fragile, mitigation required
  - If 30-50%: **ELEVATED** — monitor closely
- **Whale Deals** (>20% quota): Count and total exposure
  - Flag any single deal >30% of rep quota
  - Note dependency on specific reps or accounts

## Rep Performance Spotlight
- **Top Performers**: Name reps carrying the forecast with specific amounts
  - Highlight reps with strong commit + conversion rates
- **At-Risk Reps**: Name reps below 70% attainment (if quota available)
  - Note pattern: heavy pipeline but no commit = needs coaching
  - Note pattern: low activity = needs deals

## Week-over-Week Movement
- What changed since last run?
- **Commit change**: Up/down by $X (Y%)
  - Direction matters: Growing commit = confidence. Shrinking = slippage.
- **Category shifts**: Any >10% swing in commit/best case
  - Did deals progress (good) or get pushed (bad)?
- **New risks emerged**: Compare this week's risk classifications to last week

## Behavioral Risks (AI-Detected)
For each HIGH severity risk from risk_classifications:
- Rep name + risk type (sandbagging/over-forecasting/whale dependency/gaming)
- Evidence with specific numbers
- Suggested action this week

## Top 3 Actions This Week (Ranked by Revenue Impact)
1. [Action] — Owner: [Rep Name] — Impact: $X — Why: [1 sentence]
2. [Action] — Owner: [Rep Name] — Impact: $X — Why: [1 sentence]
3. [Action] — Owner: [Rep Name] — Impact: $X — Why: [1 sentence]

Each action must:
- Be executable within 7 days
- Have a specific owner (name a rep or leader)
- Tie to a dollar amount or deal count
- Address highest risk or opportunity

STYLE RULES:
- Lead with the verdict (on track / at risk / behind)
- Use specific dollar amounts, percentages, rep names, and deal names
- Every number needs context: "$500K commit (25% of $2M quota)"
- If quotas not configured, acknowledge and use absolute numbers
- If WoW not available (first run), note it and focus on current state
- Don't repeat raw data — interpret it and explain what it means
- Avoid generic phrases like "pipeline looks healthy" — be specific about why
- Prioritize high-severity risks and high-value opportunities
- If concentration risk is high, make it prominent — this is a critical insight
{{#if forecast_data.icpForecast}}
- Reference ICP quality when assessing forecast confidence
- If A/B-grade thin in commit, flag as quality problem
- If grade-adjusted forecast available, compare to quota for realistic attainment
{{/if}}`,
      outputKey: 'narrative',
    },
  ],

  schedule: {
    cron: '0 8 * * 1',
    trigger: 'on_demand',
  },

  outputFormat: 'markdown',

  estimatedDuration: '45s',
};
