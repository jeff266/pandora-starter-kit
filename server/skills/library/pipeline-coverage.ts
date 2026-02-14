import type { SkillDefinition } from '../types.js';

export const pipelineCoverageSkill: SkillDefinition = {
  id: 'pipeline-coverage',
  name: 'Pipeline Coverage by Rep',
  description: 'Answers "will each rep hit their number?" by showing coverage ratios against quota, gap analysis, and week-over-week trends.',
  version: '1.0.0',
  category: 'pipeline',
  tier: 'mixed',

  requiredTools: [
    'resolveTimeWindows',
    'checkQuotaConfig',
    'coverageByRep',
    'coverageTrend',
    'repPipelineQuality',
    'getCWDByRep',
    'prepareAtRiskReps',
    'calculateOutputBudget',
    'summarizeForClaude',
  ],

  requiredContext: ['business_model', 'goals_and_targets', 'definitions'],

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
      id: 'check-quota-config',
      name: 'Check Quota Configuration',
      tier: 'compute',
      computeFn: 'checkQuotaConfig',
      computeArgs: {},
      outputKey: 'quota_config',
    },

    {
      id: 'gather-coverage-data',
      name: 'Gather Coverage Data',
      tier: 'compute',
      dependsOn: ['resolve-time-windows', 'check-quota-config'],
      computeFn: 'coverageByRep',
      computeArgs: {},
      outputKey: 'coverage_data',
    },

    {
      id: 'gather-coverage-trend',
      name: 'Gather Coverage Trend',
      tier: 'compute',
      dependsOn: ['gather-coverage-data'],
      computeFn: 'coverageTrend',
      computeArgs: {},
      outputKey: 'coverage_trend',
    },

    {
      id: 'gather-cwd-by-rep',
      name: 'Gather Conversations Without Deals by Rep',
      tier: 'compute',
      dependsOn: ['resolve-time-windows'],
      computeFn: 'getCWDByRep',
      computeArgs: { daysBack: 90 },
      outputKey: 'cwd_by_rep',
    },

    {
      id: 'gather-rep-pipeline-quality',
      name: 'Gather Rep Pipeline Quality',
      tier: 'compute',
      dependsOn: ['resolve-time-windows'],
      computeFn: 'repPipelineQuality',
      computeArgs: {},
      outputKey: 'pipeline_quality',
    },

    {
      id: 'prepare-at-risk-reps',
      name: 'Prepare At-Risk Reps Data',
      tier: 'compute',
      dependsOn: ['gather-coverage-data', 'gather-rep-pipeline-quality', 'gather-coverage-trend', 'gather-cwd-by-rep'],
      computeFn: 'prepareAtRiskReps',
      computeArgs: {},
      outputKey: 'at_risk_reps',
    },

    {
      id: 'classify-rep-risk',
      name: 'Classify Rep Risk (DeepSeek)',
      tier: 'deepseek',
      dependsOn: ['prepare-at-risk-reps'],
      deepseekPrompt: `You are a sales operations analyst reviewing rep pipeline coverage data.

For each underperforming rep, classify their coverage risk:
1. risk_level: one of [critical, concerning, watch]
2. root_cause: one of [insufficient_prospecting, poor_conversion, deal_slippage, quota_mismatch, ramping, pipeline_quality, active_not_logging]
3. recommended_intervention: one specific, actionable recommendation

Definitions:
- insufficient_prospecting: low pipeline relative to quota, not enough new deals
- poor_conversion: adequate pipeline created but deals stall or close-lost at high rate
- deal_slippage: deals keep pushing close dates beyond the quarter
- quota_mismatch: quota may be unrealistic given territory/segment
- ramping: rep is new, building pipeline from scratch
- pipeline_quality: pipeline exists but concentrated in early stages with low probability
- active_not_logging: rep has low pipeline coverage BUT high CWD count (≥3 conversations without deals) — different intervention than 'insufficient_prospecting'

IMPORTANT: If a rep has ≤2x coverage AND ≥3 conversations_without_deals_count, use 'active_not_logging' as the root cause instead of 'insufficient_prospecting'

Context:
- Quarter: {{time_windows.analysisRange.quarter}} ({{coverage_data.team.daysElapsed}} days elapsed, {{coverage_data.team.daysRemaining}} remaining)
- Team coverage target: {{coverage_data.team.coverageTarget}}x
- Team coverage: {{coverage_data.team.coverageRatio}}x

Reps to classify (only at-risk/behind reps, max 10):
{{{json at_risk_reps}}}

If no at-risk reps provided, respond with: { "classifications": [], "skipped": true }

Otherwise, respond with ONLY a JSON object: { "classifications": [...] }

Each classification should be:
{
  "email": "rep email",
  "name": "rep name",
  "risk_level": "critical | concerning | watch",
  "root_cause": "insufficient_prospecting | poor_conversion | deal_slippage | quota_mismatch | ramping | pipeline_quality",
  "recommended_intervention": "specific action for this rep"
}`,
      deepseekSchema: {
        type: 'object',
        properties: {
          classifications: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                email: { type: 'string' },
                name: { type: 'string' },
                risk_level: { type: 'string', enum: ['critical', 'concerning', 'watch'] },
                root_cause: {
                  type: 'string',
                  enum: ['insufficient_prospecting', 'poor_conversion', 'deal_slippage', 'quota_mismatch', 'ramping', 'pipeline_quality', 'active_not_logging'],
                },
                recommended_intervention: { type: 'string' },
              },
              required: ['email', 'name', 'risk_level', 'root_cause', 'recommended_intervention'],
            },
          },
          skipped: { type: 'boolean' },
        },
        required: ['classifications'],
      },
      outputKey: 'rep_risk_classifications',
    },

    {
      id: 'calculate-output-budget',
      name: 'Calculate Report Complexity Budget',
      tier: 'compute',
      dependsOn: ['gather-coverage-data', 'classify-rep-risk', 'gather-cwd-by-rep'],
      computeFn: 'calculateOutputBudget',
      computeArgs: {},
      outputKey: 'output_budget',
    },

    {
      id: 'summarize-for-claude',
      name: 'Summarize for Claude',
      tier: 'compute',
      dependsOn: ['gather-coverage-data', 'gather-coverage-trend', 'gather-rep-pipeline-quality', 'classify-rep-risk', 'gather-cwd-by-rep'],
      computeFn: 'summarizeForClaude',
      computeArgs: {},
      outputKey: 'coverage_summary',
    },

    {
      id: 'synthesize-coverage-report',
      name: 'Synthesize Coverage Report',
      tier: 'claude',
      dependsOn: [
        'resolve-time-windows',
        'check-quota-config',
        'gather-coverage-data',
        'gather-coverage-trend',
        'gather-rep-pipeline-quality',
        'gather-cwd-by-rep',
        'classify-rep-risk',
        'calculate-output-budget',
        'summarize-for-claude',
      ],
      claudePrompt: `You are a VP of Revenue Operations analyzing pipeline coverage for {{business_model.company_name}}.

{{#if dataFreshness.isStale}}
⚠️ DATA FRESHNESS: Coverage calculations based on data imported {{dataFreshness.daysSinceUpdate}} days ago. Re-upload latest CRM export for current coverage numbers.
{{/if}}

REPORT PERIOD: {{time_windows.analysisRange.quarter}}

{{coverage_summary.quotaNote}}

TEAM OVERVIEW:
{{coverage_summary.teamSummary}}

REP-BY-REP STATUS:
{{coverage_summary.repTable}}

PIPELINE QUALITY FLAGS:
{{coverage_summary.qualityFlags}}

WEEK-OVER-WEEK TREND:
{{coverage_summary.trend}}

AT-RISK REP ANALYSIS:
{{coverage_summary.riskClassifications}}

SHADOW PIPELINE (Conversations Without Deals):
{{{json cwd_by_rep}}}

REPORT PARAMETERS:
- Word budget: {{output_budget.wordBudget}} words maximum
- Report depth: {{output_budget.reportDepth}}

YOUR TASK:
Produce a Pipeline Coverage Report. Include:

1. TEAM HEADLINE
   - One sentence verdict: are we on track to hit quota this quarter?
   - Use specific coverage ratio and gap number

2. COVERAGE GAP ANALYSIS
   - How much new pipeline needs to be generated?
   - By when? (use daysRemaining and requiredWeeklyPipelineGen)
   - What's the weekly run rate needed?

3. AT-RISK REPS
   - Specific actions per rep from classifications
   - Example: "Mike needs 3 new qualified opportunities worth $150K by end of month"
   - Include their current coverage, gap, and recommended intervention
   - If rep has conversations_without_deals_count > 0, mention shadow pipeline:
     Example: "Sara shows 1.2x coverage, but has 3 untracked demo conversations at [accounts]. If these convert to deals, true coverage may be closer to 2.0x. Priority: create deals for demo conversations."

4. PIPELINE QUALITY CONCERNS
   - Flag reps with early-stage-heavy pipeline (>70% in awareness/qualification)
   - These deals are at risk of not closing this quarter

5. TOP 3 ACTIONS
   - Ranked by revenue impact
   - Must be actionable this week
   - Each action must name specific reps or dollar amounts

RULES:
- Use "{{time_windows.analysisRange.quarter}}" as the report period in the header — do NOT guess the quarter or year
- Lead with the verdict (on track / at risk / behind)
- Use specific dollar amounts, rep names, and deal counts
- If quotas aren't configured, note this and show absolute numbers only
- Every recommendation must be actionable this week
- Don't repeat raw data — interpret it
- Stay within word budget

WORD BUDGET ENFORCEMENT:
- minimal: If team is on track and <3 at-risk reps, keep it brief
- standard: Focus on at-risk reps and quality issues
- detailed: Full breakdown with trend analysis and specific interventions`,
      outputKey: 'coverage_report',
    },
  ],

  schedule: {
    cron: '0 8 * * 1',
    trigger: 'on_demand',
  },

  outputFormat: 'slack',
  slackTemplate: 'pipeline-coverage',

  estimatedDuration: '45s',

  evidenceSchema: {
    entity_type: 'rep',
    columns: [
      { key: 'rep_name', display: 'Rep Name', format: 'text' },
      { key: 'rep_email', display: 'Email', format: 'text' },
      { key: 'quota', display: 'Quota', format: 'currency' },
      { key: 'open_pipeline', display: 'Open Pipeline', format: 'currency' },
      { key: 'coverage_ratio', display: 'Coverage Ratio', format: 'number' },
      { key: 'gap_to_quota', display: 'Gap to Quota', format: 'currency' },
      { key: 'closed_won', display: 'Closed Won', format: 'currency' },
      { key: 'risk_level', display: 'Risk Level', format: 'severity' },
      { key: 'root_cause', display: 'Root Cause', format: 'text' },
      { key: 'recommended_intervention', display: 'Recommended Intervention', format: 'text' },
    ],
  },
};
