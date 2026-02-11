import type { SkillDefinition } from '../types.js';

export const forecastRollupSkill: SkillDefinition = {
  id: 'forecast-rollup',
  name: 'Forecast Roll-up',
  description: 'Aggregates pipeline by forecast category with bear/base/bull scenarios, rep-level breakdowns, and week-over-week comparison.',
  version: '2.0.0',
  category: 'forecasting',
  tier: 'mixed',

  requiredTools: [
    'checkQuotaConfig',
    'forecastRollup',
    'forecastWoWDelta',
    'prepareForecastSummary',
  ],

  requiredContext: ['goals_and_targets'],

  timeConfig: {
    analysisWindow: 'current_quarter',
    changeWindow: 'last_7d',
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
      id: 'gather-forecast-data',
      name: 'Gather Forecast Category Aggregation',
      tier: 'compute',
      dependsOn: ['check-quota-config'],
      computeFn: 'forecastRollup',
      computeArgs: {},
      outputKey: 'forecast_data',
    },

    {
      id: 'gather-wow-delta',
      name: 'Compare Week-over-Week',
      tier: 'compute',
      dependsOn: ['gather-forecast-data'],
      computeFn: 'forecastWoWDelta',
      computeArgs: {},
      outputKey: 'wow_delta',
    },

    {
      id: 'prepare-summary',
      name: 'Prepare Forecast Summary for Claude',
      tier: 'compute',
      dependsOn: ['gather-forecast-data', 'gather-wow-delta', 'check-quota-config'],
      computeFn: 'prepareForecastSummary',
      computeArgs: {},
      outputKey: 'forecast_summary',
    },

    {
      id: 'synthesize-narrative',
      name: 'Synthesize Forecast Narrative',
      tier: 'claude',
      dependsOn: [
        'check-quota-config',
        'gather-forecast-data',
        'gather-wow-delta',
        'prepare-summary',
      ],
      claudePrompt: `You are a VP of Sales Operations providing a weekly forecast roll-up to sales leadership for {{business_model.company_name}}.

{{forecast_summary.quotaNote}}

TEAM FORECAST:
{{forecast_summary.teamSummary}}

DEAL COUNTS:
{{forecast_summary.dealCounts}}

REP-BY-REP BREAKDOWN:
{{forecast_summary.repTable}}

WEEK-OVER-WEEK CHANGES:
{{forecast_summary.wowSummary}}

YOUR TASK:
Write a concise executive forecast summary (300-500 words max). Structure it as:

## Forecast Status
- One-sentence verdict: Are we on track to hit quota?
- Bear/Base/Bull scenarios with dollar amounts
- Weighted forecast vs quota (if available)

## Category Analysis
- How much is truly committed vs speculative?
- Spread between bear and bull indicates forecast confidence
- If spread > 30% of quota, flag as high volatility

## Rep Spotlight
- Which reps are driving the forecast? (name them, with amounts)
- Who needs attention? (low commit, heavy pipeline but no conversion)
- If quota data available, flag reps below 70% attainment

## Week-over-Week Movement
- What changed since last week?
- Did commit grow or shrink? (direction matters)
- Any category with >10% swing deserves commentary

## Top 3 Actions This Week
- Ranked by revenue impact
- Each must name a specific rep, deal category, or dollar amount
- Must be actionable within 7 days

RULES:
- Lead with the verdict (on track / at risk / behind)
- Use specific dollar amounts, percentages, and rep names
- If quotas not configured, acknowledge and use absolute numbers
- If WoW not available (first run), note it and focus on current state
- Every recommendation must be actionable this week
- Don't repeat raw data — interpret it
- Avoid generic phrases like "pipeline looks healthy" — be specific`,
      outputKey: 'narrative',
    },
  ],

  schedule: {
    cron: '0 8 * * 1',
    trigger: 'on_demand',
  },

  outputFormat: 'markdown',

  estimatedDuration: '30s',
};
