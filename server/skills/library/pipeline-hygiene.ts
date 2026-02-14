import type { SkillDefinition } from '../types.js';

export const pipelineHygieneSkill: SkillDefinition = {
  id: 'pipeline-hygiene',
  name: 'Pipeline Hygiene Check',
  description: 'Analyzes deal pipeline for data quality issues, stale deals, missing fields, and risk signals. Produces actionable recommendations with time-scoped analysis and dynamic report sizing.',
  version: '2.2.0',
  category: 'pipeline',
  tier: 'mixed',

  requiredTools: [
    'resolveTimeWindows',
    'computePipelineCoverage',
    'getDealsByStage',
    'aggregateStaleDeals',
    'aggregateClosingSoon',
    'getActivitySummary',
    'computeOwnerPerformance',
    'gatherPeriodComparison',
    'calculateOutputBudget',
    'queryDeals',
    'getDeal',
  ],

  requiredContext: ['business_model', 'goals_and_targets', 'definitions'],

  timeConfig: {
    analysisWindow: 'current_quarter',
    changeWindow: 'since_last_run',
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
        changeWindow: 'since_last_run',
        trendComparison: 'previous_period',
      },
      outputKey: 'time_windows',
    },

    {
      id: 'gather-pipeline-summary',
      name: 'Pipeline Summary',
      tier: 'compute',
      dependsOn: ['resolve-time-windows'],
      computeFn: 'computePipelineCoverage',
      computeArgs: {},
      outputKey: 'pipeline_summary',
    },

    {
      id: 'gather-stage-breakdown',
      name: 'Stage Breakdown',
      tier: 'compute',
      computeFn: 'getDealsByStage',
      computeArgs: {},
      outputKey: 'stage_breakdown',
    },

    {
      id: 'aggregate-stale-deals',
      name: 'Aggregate Stale Deals',
      tier: 'compute',
      computeFn: 'aggregateStaleDeals',
      computeArgs: { topN: 20 },
      outputKey: 'stale_deals_agg',
    },

    {
      id: 'aggregate-closing-soon',
      name: 'Aggregate Deals Closing Soon',
      tier: 'compute',
      computeFn: 'aggregateClosingSoon',
      computeArgs: { daysAhead: 30, topN: 10 },
      outputKey: 'closing_soon_agg',
    },

    {
      id: 'gather-activity',
      name: 'Activity Summary (7 days)',
      tier: 'compute',
      computeFn: 'getActivitySummary',
      computeArgs: { days: 7 },
      outputKey: 'recent_activity',
    },

    {
      id: 'compute-owner-performance',
      name: 'Owner Performance Summary',
      tier: 'compute',
      computeFn: 'computeOwnerPerformance',
      computeArgs: {},
      outputKey: 'owner_performance',
    },

    {
      id: 'gather-period-comparison',
      name: 'Period-over-Period Comparison',
      tier: 'compute',
      dependsOn: ['resolve-time-windows'],
      computeFn: 'gatherPeriodComparison',
      computeArgs: {},
      outputKey: 'period_comparison',
    },

    {
      id: 'classify-deal-issues',
      name: 'Classify Deal Issues (DeepSeek)',
      tier: 'deepseek',
      dependsOn: ['aggregate-stale-deals', 'aggregate-closing-soon'],
      deepseekPrompt: `You are a RevOps data analyst. Classify each deal below to identify root causes and recommend actions.

For each deal, determine:
1. root_cause: one of [rep_neglect, prospect_stalled, data_hygiene, process_gap, timing, competitive_loss, champion_change, high_fit_stale, low_fit_active, high_fit_stuck]
2. confidence: 0.0 to 1.0
3. signals: list of specific evidence supporting your classification
4. suggested_action: one concrete next step

Additional root causes (ICP-based, if grades available):
- high_fit_stale: A/B-grade ICP fit deal that has gone stale. Recommended: immediate rep outreach, manager escalation.
- low_fit_active: D/F-grade ICP fit deal still in active pipeline. Recommended: evaluate whether to continue pursuing or disqualify.
- high_fit_stuck: A/B-grade deal stuck in early stage too long. Recommended: accelerate — schedule next meeting, multi-thread.

Context:
- Stale threshold: {{goals_and_targets.thresholds.stale_deal_days}} days
- Average sales cycle: {{business_model.sales_cycle_days}} days
- Pipeline coverage target: {{goals_and_targets.pipeline_coverage_target}}x

STALE DEALS (top 20 by amount):
{{stale_deals_agg.topDeals}}

DEALS CLOSING IN 30 DAYS (top 10 by amount):
{{closing_soon_agg.topDeals}}

Return valid JSON array with one object per deal:
{
  "dealName": "...",
  "dealId": "...",
  "category": "stale" | "closing_soon",
  "root_cause": "rep_neglect | prospect_stalled | data_hygiene | process_gap | timing | competitive_loss | champion_change",
  "confidence": 0.85,
  "signals": ["signal 1", "signal 2", "signal 3"],
  "suggested_action": "specific action for this deal"
}`,
      deepseekSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            dealName: { type: 'string' },
            dealId: { type: 'string' },
            category: { type: 'string', enum: ['stale', 'closing_soon'] },
            root_cause: { type: 'string' },
            confidence: { type: 'number' },
            signals: { type: 'array', items: { type: 'string' } },
            suggested_action: { type: 'string' },
          },
          required: ['dealName', 'root_cause', 'confidence', 'signals', 'suggested_action'],
        },
      },
      outputKey: 'deal_classifications',
    },

    {
      id: 'calculate-output-budget',
      name: 'Calculate Report Complexity Budget',
      tier: 'compute',
      dependsOn: ['classify-deal-issues', 'gather-pipeline-summary', 'gather-period-comparison'],
      computeFn: 'calculateOutputBudget',
      computeArgs: {},
      outputKey: 'output_budget',
    },

    {
      id: 'synthesize-hygiene-report',
      name: 'Synthesize Pipeline Hygiene Report',
      tier: 'claude',
      dependsOn: [
        'resolve-time-windows',
        'gather-pipeline-summary',
        'gather-stage-breakdown',
        'aggregate-stale-deals',
        'aggregate-closing-soon',
        'gather-activity',
        'compute-owner-performance',
        'gather-period-comparison',
        'classify-deal-issues',
        'calculate-output-budget',
      ],
      claudeTools: ['queryDeals', 'getDeal'],
      maxToolCalls: 3,
      claudePrompt: `You have pre-analyzed pipeline data for this workspace. All raw data has been aggregated into structured summaries, and deals have been classified by root cause. Work from these summaries and classifications, not raw records.

{{#if dataFreshness.isStale}}
⚠️ DATA FRESHNESS: {{dataFreshness.staleCaveat}}
{{/if}}

{{#unless dataFreshness.hasActivities}}
NOTE: Activity data not available (file import workspace). Deal staleness based on last modification date, which may undercount truly stale deals. For better staleness detection, upload activity data or connect to your CRM.
{{/unless}}

TIME SCOPE:
- Analysis period: {{time_windows.analysisRange.start}} to {{time_windows.analysisRange.end}}
- Changes since: {{time_windows.changeRange.start}} ({{time_windows.config.changeWindow}})
- Compared to: {{time_windows.previousPeriodRange.start}} to {{time_windows.previousPeriodRange.end}}
- Last run: {{time_windows.lastRunAt}}

PERIOD-OVER-PERIOD COMPARISON:
{{{json period_comparison}}}

PIPELINE SUMMARY:
{{{json pipeline_summary}}}

STAGE BREAKDOWN:
{{{json stage_breakdown}}}

STALE DEALS (aggregated — summary + severity buckets + top 20 by amount):
{{{json stale_deals_agg}}}

DEALS CLOSING IN 30 DAYS (aggregated — summary + top 10 by amount):
{{{json closing_soon_agg}}}

ACTIVITY (change window):
{{{json recent_activity}}}

OWNER PERFORMANCE (sorted by stale rate):
{{{json owner_performance}}}

DEAL CLASSIFICATIONS (AI-analyzed root causes for top 30 deals):
{{{json deal_classifications}}}

{{#if pipeline_summary.icpSummary}}
PIPELINE QUALITY (ICP Fit):
- {{pipeline_summary.icpSummary.by_grade.A.count}} A-grade deals (\${{pipeline_summary.icpSummary.by_grade.A.value}})
- {{pipeline_summary.icpSummary.by_grade.B.count}} B-grade deals (\${{pipeline_summary.icpSummary.by_grade.B.value}})
- {{pipeline_summary.icpSummary.ab_grade_pct}}% of pipeline value is A/B-grade ICP fit
- {{pipeline_summary.icpSummary.df_grade_pct}}% of pipeline value is D/F-grade (deprioritization candidates)
{{#if pipeline_summary.icpSummary.high_fit_stale_count}}
- ⚠️ {{pipeline_summary.icpSummary.high_fit_stale_count}} A-grade deals are stale — highest priority for recovery
{{/if}}
{{#if pipeline_summary.icpSummary.low_fit_active_count}}
- {{pipeline_summary.icpSummary.low_fit_active_count}} D/F-grade deals consuming pipeline capacity
{{/if}}

When synthesizing, reference ICP grades in your recommendations:
- Prioritize recovery actions for A/B-grade stale deals over C/D/F
- Flag D/F-grade deals as deprioritization candidates, not just stale deals
- Note if a rep's pipeline is heavily weighted toward low-fit deals
{{/if}}

REPORT PARAMETERS:
- Depth: {{output_budget.reportDepth}}
- Word budget: {{output_budget.wordBudget}} words maximum
- Complexity: {{output_budget.complexityScore}} (reasoning: {{output_budget.reasoning}})

Produce a Pipeline Hygiene Report with these sections. IMPORTANT: Stay within your word budget. If pipeline is healthy with no significant changes, say so briefly and stop.

If this is NOT the first run (lastRunAt exists), LEAD with what CHANGED since last run before covering current state.

1. PIPELINE HEALTH
   - Coverage ratio vs {{goals_and_targets.pipeline_coverage_target}}x target (include period-over-period delta)
   - Gap in dollars vs ${'$'}{{goals_and_targets.revenue_target}} revenue target
   - Win rate trend and deal flow assessment (reference period comparison deltas)

2. STALE DEAL CRISIS
   - Severity breakdown: how many critical (30+ days), serious, warning, watch
   - Total value at risk from stale deals
   - Which stages have the most stale deals (pattern detection)
   - Which reps have the worst stale rates (name them)
   - Root cause breakdown from classifications: rep_neglect, prospect_stalled, data_hygiene, process_gap, etc.
   - For each root cause category, cite specific deals and their recommended actions

3. CLOSING THIS MONTH
   - Total deals and value closing in 30 days
   - Risk assessment from classifications: which deals have timing issues, data gaps, or other blockers
   - Readiness assessment: realistic vs aspirational close dates based on activity and health scores

4. REP PERFORMANCE
   - Who's executing well (low stale rate, high activity)
   - Who needs coaching (high stale rate, low activity, deals with rep_neglect classification)
   - Activity patterns and pipeline distribution

5. TOP 3 ACTIONS
   - Ranked by revenue impact
   - Each action must name specific deals or reps (use names from classifications)
   - Include root cause and expected outcome if action is taken this week
   - Example: "Action 1: Re-engage Acme Corp ($220K, stale 87 days, root cause: rep_neglect). Assign to manager for immediate outreach. Expected: move to disqualified or re-activate within 7 days."

Be direct. Use actual deal names, dollar amounts, and rep names from the data and classifications. No generic advice.
The classifications provide specific root causes and actions for each top deal — reference these directly.
If you need to drill into a specific deal for more detail, use the available tools — but prefer the pre-analyzed summaries and classifications.

WORD BUDGET ENFORCEMENT:
- {{output_budget.reportDepth}} report: {{output_budget.wordBudget}} words max
- minimal: Skip sections with no issues. Lead with "Pipeline healthy" if applicable.
- standard: Cover only sections with actionable items.
- detailed: Full coverage with specific examples and root cause analysis.`,
      outputKey: 'hygiene_report',
    },
  ],

  schedule: {
    trigger: 'on_demand',
  },

  outputFormat: 'slack',
  slackTemplate: 'pipeline-hygiene',

  estimatedDuration: '1m',

  evidenceSchema: {
    entity_type: 'deal',
    columns: [
      { key: 'deal_name', display: 'Deal Name', format: 'text' },
      { key: 'amount', display: 'Amount', format: 'currency' },
      { key: 'stage', display: 'Stage', format: 'text' },
      { key: 'owner', display: 'Owner', format: 'text' },
      { key: 'days_since_activity', display: 'Days Since Activity', format: 'number' },
      { key: 'close_date', display: 'Close Date', format: 'date' },
      { key: 'stale_flag', display: 'Stale Flag', format: 'text' },
      { key: 'close_date_flag', display: 'Close Date Status', format: 'text' },
      { key: 'root_cause', display: 'Root Cause', format: 'text' },
      { key: 'suggested_action', display: 'Suggested Action', format: 'text' },
      { key: 'severity', display: 'Severity', format: 'severity' },
    ],
    formulas: [
      {
        column: 'stale_flag',
        excel_formula: '=IF(E{row}>={{threshold_sheet}}!B2,"stale","active")',
        depends_on_parameter: 'stale_threshold_days',
      },
    ],
  },
};
