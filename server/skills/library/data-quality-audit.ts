import type { SkillDefinition } from '../types.js';

export const dataQualityAuditSkill: SkillDefinition = {
  id: 'data-quality-audit',
  name: 'Data Quality Audit',
  description: 'Audits data completeness across all normalized tables and identifies records, reps, and patterns that degrade every other skill\'s output quality.',
  version: '1.0.0',
  category: 'operations',
  tier: 'mixed',

  requiredTools: [
    'resolveTimeWindows',
    'dataQualityAudit',
    'gatherQualityTrend',
    'enrichWorstOffenders',
    'calculateOutputBudget',
    'queryDeals',
    'queryContacts',
  ],

  requiredContext: ['business_model', 'goals_and_targets', 'definitions'],

  timeConfig: {
    analysisWindow: 'all_time',
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
        analysisWindow: 'all_time',
        changeWindow: 'since_last_run',
        trendComparison: 'previous_period',
      },
      outputKey: 'time_windows',
    },

    {
      id: 'gather-quality-metrics',
      name: 'Analyze Data Quality',
      tier: 'compute',
      computeFn: 'dataQualityAudit',
      computeArgs: {},
      outputKey: 'quality_metrics',
    },

    {
      id: 'gather-quality-trend',
      name: 'Gather Quality Trend',
      tier: 'compute',
      dependsOn: ['gather-quality-metrics'],
      computeFn: 'gatherQualityTrend',
      computeArgs: {},
      outputKey: 'quality_trend',
    },

    {
      id: 'enrich-worst-offenders',
      name: 'Enrich Worst Offenders',
      tier: 'compute',
      dependsOn: ['gather-quality-metrics'],
      computeFn: 'enrichWorstOffenders',
      computeArgs: {},
      outputKey: 'enriched_offenders',
    },

    {
      id: 'classify-quality-patterns',
      name: 'Classify Quality Patterns (DeepSeek)',
      tier: 'deepseek',
      dependsOn: ['gather-quality-metrics', 'enrich-worst-offenders'],
      deepseekPrompt: `You are a CRM operations analyst reviewing data quality patterns.

For each rep/owner below, classify their data quality pattern:
1. pattern: one of [systematic_neglect, specific_field_gap, new_rep_onboarding, process_not_enforced, tool_issue, acceptable]
2. worst_field: the field they most frequently leave empty
3. severity: 'critical' (completeness < 50%), 'moderate' (50-75%), 'minor' (75-90%)
4. recommended_fix: one of [training, required_field_enforcement, bulk_cleanup, process_change, tool_config]

Definitions:
- systematic_neglect: consistently low completeness across multiple fields
- specific_field_gap: good data overall but one specific field always missing
- new_rep_onboarding: recent records are incomplete, older ones are fine (or no older ones)
- process_not_enforced: the fields exist but the team doesn't have a habit of filling them
- tool_issue: patterns suggest a CRM configuration problem (e.g., field not visible in layout)
- acceptable: completeness is above 90% for critical fields

Only classify owners with avgCompleteness < 80 OR criticalIssues > 5. Limit to 15 owners maximum.

OWNER DATA QUALITY:
{{quality_metrics.ownerBreakdown}}

TOP PROBLEM RECORDS:
{{enriched_offenders}}

Respond with ONLY a JSON object: { "classifications": [...] }

Each classification object should have:
{
  "owner": "owner name",
  "pattern": "systematic_neglect | specific_field_gap | new_rep_onboarding | process_not_enforced | tool_issue | acceptable",
  "worst_field": "field name",
  "severity": "critical | moderate | minor",
  "recommended_fix": "training | required_field_enforcement | bulk_cleanup | process_change | tool_config"
}`,
      deepseekSchema: {
        type: 'object',
        properties: {
          classifications: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                owner: { type: 'string' },
                pattern: {
                  type: 'string',
                  enum: ['systematic_neglect', 'specific_field_gap', 'new_rep_onboarding', 'process_not_enforced', 'tool_issue', 'acceptable'],
                },
                worst_field: { type: 'string' },
                severity: { type: 'string', enum: ['critical', 'moderate', 'minor'] },
                recommended_fix: {
                  type: 'string',
                  enum: ['training', 'required_field_enforcement', 'bulk_cleanup', 'process_change', 'tool_config'],
                },
              },
              required: ['owner', 'pattern', 'worst_field', 'severity', 'recommended_fix'],
            },
          },
        },
        required: ['classifications'],
      },
      outputKey: 'quality_classifications',
    },

    {
      id: 'calculate-output-budget',
      name: 'Calculate Report Complexity Budget',
      tier: 'compute',
      dependsOn: ['classify-quality-patterns', 'gather-quality-metrics'],
      computeFn: 'calculateOutputBudget',
      computeArgs: {},
      outputKey: 'output_budget',
    },

    {
      id: 'synthesize-quality-report',
      name: 'Synthesize Quality Report',
      tier: 'claude',
      dependsOn: [
        'resolve-time-windows',
        'gather-quality-metrics',
        'gather-quality-trend',
        'enrich-worst-offenders',
        'classify-quality-patterns',
        'calculate-output-budget',
      ],
      claudeTools: ['queryDeals', 'queryContacts'],
      maxToolCalls: 5,
      claudePrompt: `You are a RevOps operations analyst auditing CRM data quality for {{business_model.company_name}}.

TIME SCOPE:
- Analysis period: {{time_windows.analysisRange.start}} to {{time_windows.analysisRange.end}}
- Last audit: {{time_windows.lastRunAt}}

DATA QUALITY SUMMARY:
Overall completeness: {{quality_metrics.overall.overallCompleteness}}%
Critical field completeness: {{quality_metrics.overall.criticalFieldCompleteness}}%
Total records audited: {{quality_metrics.overall.totalRecords}}

BY ENTITY:
Deals: {{quality_metrics.byEntity.deals.total}} total
  Field completeness: {{quality_metrics.byEntity.deals.fieldCompleteness}}
  Issues: {{quality_metrics.byEntity.deals.issues}}

Contacts: {{quality_metrics.byEntity.contacts.total}} total
  Field completeness: {{quality_metrics.byEntity.contacts.fieldCompleteness}}
  Issues: {{quality_metrics.byEntity.contacts.issues}}

Accounts: {{quality_metrics.byEntity.accounts.total}} total
  Field completeness: {{quality_metrics.byEntity.accounts.fieldCompleteness}}
  Issues: {{quality_metrics.byEntity.accounts.issues}}

TREND (vs last audit):
{{quality_trend}}

OWNER PATTERNS (from automated classification):
{{quality_classifications}}

REPORT PARAMETERS:
- Depth: {{output_budget.reportDepth}}
- Word budget: {{output_budget.wordBudget}} words maximum

YOUR TASK:
Produce a Data Quality Audit Report. Include:

1. OVERALL HEALTH GRADE
   - Grade A through F, based on critical field completeness:
     A=95%+, B=85-94%, C=75-84%, D=60-74%, F=<60%
   - One sentence summary of overall data health

2. TOP 3 RISKS
   - Specific problems that affect other analyses
   - Example: "47 deals worth $2.1M have no close date — forecasting is unreliable"
   - Include dollar amounts and record counts

3. PER-REP DATA QUALITY PATTERNS
   - Use classifications to identify reps needing coaching
   - Call out specific worst_field and recommended_fix for each
   - Example: "John Smith (systematic_neglect, severity: critical) — missing close_date on 80% of deals. Fix: required_field_enforcement"

4. TREND ANALYSIS
   - Is quality improving or declining since last audit?
   - Which fields got better, which got worse?
   - Cite specific deltas from quality_trend

5. TOP 5 ACTIONS
   - Ranked by impact on data quality
   - Each action must have clear owner and timeline
   - Focus on critical fields that affect pipeline analysis, forecasting, and deal health scoring
   - Example: "Action 1: Enforce required close_date field for all open deals (47 deals, $2.1M). Owner: Sales Ops. Timeline: This week."

RULES:
- Use specific numbers, dollar amounts, and rep names
- Every action must be specific enough to execute this week
- If data quality is actually good (>90% critical completeness), say so briefly and focus on the few remaining gaps
- Keep response under {{output_budget.wordBudget}} words

WORD BUDGET ENFORCEMENT:
- minimal: If >90% critical completeness, say "data quality looks healthy" and list top 3 remaining gaps
- standard: Cover only sections with actionable items
- detailed: Full coverage with specific examples and rep-by-rep breakdown

If you need to drill into specific deals or contacts for more context, use the available tools.`,
      outputKey: 'quality_report',
    },
  ],

  schedule: {
    cron: '0 8 * * 1',
    trigger: 'on_demand',
  },

  outputFormat: 'slack',
  slackTemplate: 'data-quality-audit',

  estimatedDuration: '45s',
};
