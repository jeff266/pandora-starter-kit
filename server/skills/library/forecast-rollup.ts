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
    'computeForecastAnnotations',
    'mergeAnnotationsWithUserState',
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
        'merge-and-store-annotations',
      ],
      claudePrompt: `You are a senior RevOps analyst delivering the Monday morning forecast briefing for {{business_model.company_name}}.

{{#if dataFreshness.isStale}}
Note: {{dataFreshness.staleCaveat}}
{{/if}}

{{#if (eq dataFreshness.source 'file_import')}}
Note: Forecast based on file-imported data, not live CRM sync.
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

{{#if survival_curve_context}}
WIN RATE CURVE (Kaplan-Meier survival analysis — {{survival_curve_context.metadata.sampleSize}} historical deals):
- Terminal win rate: {{survival_curve_context.terminalWinRatePct}}% (all deals that ever reach creation)
- Median time to close (won deals): {{survival_curve_context.medianDaysToWin}} days
- Cumulative win rates by age: 30d={{survival_curve_context.at30d}}%, 60d={{survival_curve_context.at60d}}%, 90d={{survival_curve_context.at90d}}%, 180d={{survival_curve_context.at180d}}%
- Scenario basis: Bear = CI lower bound × remaining; Base = expected value in quarter window; Bull = CI upper bound × remaining
- Data reliability: {{survival_curve_context.dataTier}} ({{survival_curve_context.reliability}})
Use this curve to contextualize whether bear/base/bull are conservative or aggressive relative to historical conversion.
{{/if}}

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
- Pipeline: \${{forecast_data.icpForecast.pipeline.total}} total

{{#if forecast_data.icpForecast.has_grade_adjusted}}
Grade-Adjusted Expected Value:
{{#each forecast_data.icpForecast.grade_close_rates}}
  - {{@key}}-grade: {{this}}% close rate
{{/each}}
- Adjusted commit: \${{forecast_data.icpForecast.grade_adjusted_commit}}
- Adjusted best case: \${{forecast_data.icpForecast.grade_adjusted_best_case}}
{{/if}}
{{/if}}

OUTPUT GUIDANCE:
{{{json output_budget}}}

STRUCTURE YOUR REPORT:
1. Forecast summary: closed-won to date, commit pipeline, best case, total open. Compare each to last week.
2. Category movement: deals that changed forecast category this week (upgrades and downgrades). Only the meaningful ones.
3. Pacing: are we ahead or behind where we should be at this point in the quarter? Simple math, no drama.
4. Concentration: if any single deal represents >20% of remaining quota, note it factually. It's worth knowing, not worth panicking about.
5. Reps at risk: anyone pacing below 70% of their target with less than adequate pipeline. Pair with what they'd need to close the gap.
6. Key deals to watch: the 3-5 deals whose outcomes will most affect the quarter. Include amount, stage, forecast category, and next step.

{{voiceBlock}}

{{#if final_annotations}}
AI ANNOTATIONS (computed by forecast analysis):
{{{json final_annotations}}}

IMPORTANT: After your main forecast report, add a section for AI Alerts.
Only include annotations with severity "critical" or "warning" (skip positive/info).
Limit to the top 3 most urgent annotations.
Format each annotation as a Slack markdown block:

---

⚠️ *AI Alerts ({{final_annotations.length}})*

{{#each final_annotations}}
{{#if (or (eq severity "critical") (eq severity "warning"))}}
{{#if severity "critical"}}🔴{{else}}🟡{{/if}} *{{title}}*
{{body}}
{{#if recommendation}}→ {{recommendation}}{{/if}}

{{/if}}
{{/each}}

_View all insights in the Command Center →_
{{/if}}

After your report (including AI alerts if present), emit an <actions> block containing a JSON array of specific, executable actions. Each action must have:
- action_type: one of "update_forecast", "accelerate_deal", "flag_at_risk", "schedule_review", "validate_commit"
- severity: "critical" | "warning" | "info"
- title: short action title
- summary: 1-2 sentence explanation
- recommended_steps: array of 1-3 concrete steps
- target_deal_name: exact deal name (if deal-specific)
- owner_email: rep email (if available)
- impact_amount: deal or forecast amount (number, no currency symbol)
- urgency_label: "overdue" | "this_week" | "next_week"

Focus on the top 5-10 most impactful forecast risks or opportunities. Example:
<actions>
[{"action_type":"validate_commit","severity":"warning","title":"Validate $150K commit from Sara","summary":"3 committed deals totaling $150K have no activity in 14+ days.","recommended_steps":["Review deal status with Sara in 1:1","Downgrade to best case if no update by Friday"],"owner_email":"sara@company.com","impact_amount":150000,"urgency_label":"this_week"}]
</actions>`,
      outputKey: 'narrative',
    },

    {
      id: 'compute-annotations',
      name: 'Compute Forecast Annotations',
      tier: 'compute',
      dependsOn: ['gather-forecast-data', 'gather-previous-forecast', 'gather-wow-delta'],
      computeFn: 'computeForecastAnnotations',
      computeArgs: {},
      outputKey: 'raw_annotations',
    },

    {
      id: 'classify-annotations',
      name: 'Classify Annotation Severity & Anchors',
      tier: 'deepseek',
      dependsOn: ['compute-annotations'],
      deepseekPrompt: `You are classifying forecast annotations for precise display in a RevOps dashboard.

RULES:
- Maximum 2 annotations can be 'critical' severity
- Titles must include specific numbers (dollar amounts, percentages, counts)
- Anchor assignment determines where the annotation appears in the UI
- Be precise about actionability: 'immediate' = this week, 'strategic' = next 30 days, 'monitor' = ongoing

ANCHOR TYPES:
- chart: Pin to specific week number on forecast chart (for trends over time)
- metric: Attach to a dashboard metric card
- deal: Attach to a specific deal card (include deal_id and deal_name)
- rep: Attach to a rep's row in the team breakdown (include rep_email and rep_name)
- coverage: Attach to coverage/pipe gen section (include period label)
- global: Show in main alerts panel (no specific anchor)

For each annotation, return JSON:
{
  "id": "{type}-{entity_id}-{snapshot_date}",
  "severity": "critical|warning|positive|info",
  "actionability": "immediate|strategic|monitor",
  "title": "60-char max headline with specific numbers",
  "anchor": {
    "type": "chart|metric|deal|rep|coverage|global",
    ... type-specific fields
  }
}

Annotations to classify:
{{#each raw_annotations}}
Type: {{type}}
Data: {{{json raw_data}}}

{{/each}}

Return ONLY a JSON array with no other text.`,
      deepseekSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            severity: { enum: ['critical', 'warning', 'positive', 'info'] },
            actionability: { enum: ['immediate', 'strategic', 'monitor'] },
            title: { type: 'string' },
            anchor: { type: 'object' },
          },
          required: ['id', 'severity', 'title', 'anchor'],
        },
      },
      parseAs: 'json',
      outputKey: 'classified_annotations',
    },

    {
      id: 'synthesize-annotations',
      name: 'Synthesize Annotation Narratives',
      tier: 'claude',
      dependsOn: ['classify-annotations', 'compute-annotations'],
      claudePrompt: `You're a senior RevOps analyst writing annotation narratives for the forecast dashboard.

CONTEXT:
- Period: {{time_windows.analysisRange.quarter}}
- Team Quota: {{quota_config.teamQuota}}
- Current Forecast: {{forecast_data.team.commit}}

WRITING RULES:
1. Every sentence must include a specific number (dollar amount, percentage, deal name, rep name)
2. Focus on "why this matters" more than "what happened"
3. Impact must be quantified in revenue or percentage terms
4. Recommendations must be actionable THIS WEEK (specific meeting, call, review)
5. Body: 2-3 sentences maximum
6. Impact: One sentence with dollar impact or null if not quantifiable
7. Recommendation: One specific action or null if just informational

For each annotation, return JSON:
{
  "id": "{{id from classified_annotations}}",
  "body": "2-3 sentences explaining why this matters",
  "impact": "One quantified sentence or null",
  "recommendation": "One specific action or null"
}

Annotations with their raw data:
{{#each classified_annotations}}
---
ID: {{id}}
Title: {{title}}
Severity: {{severity}}
Actionability: {{actionability}}

Raw Data:
{{{json (lookup ../raw_annotations @index)}}}

{{/each}}

Return ONLY a JSON array with no other text.`,
      maxTokens: 2000,
      parseAs: 'json',
      outputKey: 'synthesized_annotations',
    },

    {
      id: 'merge-and-store-annotations',
      name: 'Merge Annotations with User State',
      tier: 'compute',
      dependsOn: ['synthesize-annotations'],
      computeFn: 'mergeAnnotationsWithUserState',
      computeArgs: {},
      outputKey: 'final_annotations',
    },
  ],

  schedule: {
    cron: '0 8 * * 1',
    trigger: 'on_demand',
  },

  outputFormat: 'markdown',

  estimatedDuration: '45s',

  answers_questions: ['forecast', 'landing', 'commit', 'best case', 'weighted', 'coverage ratio', 'on track', 'hit the number', 'attainment', 'quota', 'target', 'are we going to hit', 'will we make'],

  evidenceSchema: {
    entity_type: 'deal',
    columns: [
      { key: 'deal_name', display: 'Deal Name', format: 'text' },
      { key: 'amount', display: 'Amount', format: 'currency' },
      { key: 'stage', display: 'Stage', format: 'text' },
      { key: 'owner', display: 'Owner', format: 'text' },
      { key: 'forecast_category', display: 'Forecast Category', format: 'text' },
      { key: 'close_date', display: 'Close Date', format: 'date' },
      { key: 'probability', display: 'Probability', format: 'percentage' },
      { key: 'weighted_amount', display: 'Weighted Amount', format: 'currency' },
      { key: 'risk_type', display: 'Behavioral Risk', format: 'text' },
      { key: 'risk_severity', display: 'Risk Severity', format: 'severity' },
    ],
  },
};
