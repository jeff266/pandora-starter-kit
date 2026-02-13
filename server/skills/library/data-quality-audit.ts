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
    'checkWorkspaceHasConversations',
    'auditConversationDealCoverage',
    'calculateOutputBudget',
    'summarizeForClaude',
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
      id: 'check-conversation-data',
      name: 'Check Conversation Data Availability',
      tier: 'compute',
      computeFn: 'checkWorkspaceHasConversations',
      computeArgs: {},
      outputKey: 'has_conversation_data',
    },

    {
      id: 'audit-conversation-deal-coverage',
      name: 'Audit Conversation Deal Coverage (CWD)',
      tier: 'compute',
      dependsOn: ['check-conversation-data'],
      computeFn: 'auditConversationDealCoverage',
      computeArgs: { daysBack: 90 },
      outputKey: 'cwd_data',
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
      dependsOn: ['gather-quality-metrics', 'enrich-worst-offenders', 'audit-conversation-deal-coverage'],
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

{{#if cwd_data.has_conversation_data}}
CONVERSATION COVERAGE GAPS (CWD):
Total CWD: {{cwd_data.summary.total_cwd}}
By severity: High={{cwd_data.summary.by_severity.high}}, Medium={{cwd_data.summary.by_severity.medium}}, Low={{cwd_data.summary.by_severity.low}}

Top high-severity examples:
{{cwd_data.top_examples}}

For each high-severity CWD, classify:
- root_cause: one of [deal_not_created, deal_linking_gap, disqualified_unlogged]
- urgency: one of [immediate, this_week, backlog]
- recommended_action: specific action for this conversation

Definitions:
- deal_not_created: demo/meeting happened, rep didn't create the deal
- deal_linking_gap: deal may exist but linker couldn't connect conversation to it
- disqualified_unlogged: prospect was disqualified but not marked in CRM

Urgency:
- immediate: high severity, demo call with no deal, 7+ days old
- this_week: medium severity, recent call or account has other deals
- backlog: low severity, short call, old, or ambiguous
{{/if}}

Respond with ONLY a JSON object: { "classifications": [...], "cwd_classifications": [...] }

Each data quality classification object should have:
{
  "owner": "owner name",
  "pattern": "systematic_neglect | specific_field_gap | new_rep_onboarding | process_not_enforced | tool_issue | acceptable",
  "worst_field": "field name",
  "severity": "critical | moderate | minor",
  "recommended_fix": "training | required_field_enforcement | bulk_cleanup | process_change | tool_config"
}

{{#if cwd_data.has_conversation_data}}
Each CWD classification object should have:
{
  "conversation_title": "title",
  "account_name": "account name",
  "rep_name": "rep name",
  "root_cause": "deal_not_created | deal_linking_gap | disqualified_unlogged",
  "recommended_action": "specific action",
  "urgency": "immediate | this_week | backlog"
}
{{/if}}`,
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
          cwd_classifications: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                conversation_title: { type: 'string' },
                account_name: { type: 'string' },
                rep_name: { type: 'string' },
                root_cause: {
                  type: 'string',
                  enum: ['deal_not_created', 'deal_linking_gap', 'disqualified_unlogged'],
                },
                recommended_action: { type: 'string' },
                urgency: { type: 'string', enum: ['immediate', 'this_week', 'backlog'] },
              },
              required: ['conversation_title', 'account_name', 'rep_name', 'root_cause', 'recommended_action', 'urgency'],
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
      dependsOn: ['classify-quality-patterns', 'gather-quality-metrics', 'audit-conversation-deal-coverage'],
      computeFn: 'calculateOutputBudget',
      computeArgs: {},
      outputKey: 'output_budget',
    },

    {
      id: 'summarize-for-claude',
      name: 'Summarize Metrics for Claude',
      tier: 'compute',
      dependsOn: ['gather-quality-metrics'],
      computeFn: 'summarizeForClaude',
      computeArgs: {},
      outputKey: 'quality_summary',
    },

    {
      id: 'synthesize-quality-report',
      name: 'Synthesize Quality Report',
      tier: 'claude',
      dependsOn: [
        'resolve-time-windows',
        'gather-quality-metrics',
        'gather-quality-trend',
        'audit-conversation-deal-coverage',
        'classify-quality-patterns',
        'calculate-output-budget',
        'summarize-for-claude',
      ],
      claudePrompt: `You are a RevOps operations analyst auditing CRM data quality for {{business_model.company_name}}.

{{#if dataFreshness.isStale}}
⚠️ DATA FRESHNESS: {{dataFreshness.staleCaveat}}
{{/if}}

{{#if (eq dataFreshness.source 'file_import')}}
DATA SOURCE: File import (CSV/Excel).
Available entities: {{#if dataFreshness.hasDeals}}deals{{/if}}{{#if dataFreshness.hasContacts}}, contacts{{/if}}{{#if dataFreshness.hasAccounts}}, accounts{{/if}}.
{{#unless dataFreshness.hasActivities}}
Activity data not available — activity-related quality checks will be skipped.
{{/unless}}
{{#unless dataFreshness.hasConversations}}
Conversation data not available — conversation-deal coverage (CWD) audit will be skipped.
{{/unless}}
{{/if}}

TIME SCOPE:
- Analysis period: {{time_windows.analysisRange.start}} to {{time_windows.analysisRange.end}}
- Last audit: {{time_windows.lastRunAt}}

DATA QUALITY SUMMARY:
Overall completeness: {{quality_metrics.overall.overallCompleteness}}%
Critical field completeness: {{quality_metrics.overall.criticalFieldCompleteness}}%
Total records audited: {{quality_metrics.overall.totalRecords}}

BY ENTITY:
{{quality_summary.entitySummaries}}

TREND (vs last audit):
{{quality_trend}}

OWNER PATTERNS (from automated classification):
{{quality_classifications}}

{{#if cwd_data.has_conversation_data}}
CONVERSATION COVERAGE GAPS:
- {{cwd_data.summary.total_cwd}} external conversations in the last 90 days have no associated deal
- By severity: {{cwd_data.summary.by_severity.high}} high, {{cwd_data.summary.by_severity.medium}} medium, {{cwd_data.summary.by_severity.low}} low
- By rep: {{cwd_data.summary.by_rep}}
- Estimated pipeline gap: {{cwd_data.summary.estimated_pipeline_gap}}

Top issues classified:
{{quality_classifications.cwd_classifications}}
{{/if}}

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
   - Include dollar amounts and record counts from the entity summaries

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

{{#if cwd_data.has_conversation_data}}
6. CONVERSATION COVERAGE GAPS
   - Include this section if CWD data exists
   - For each high-severity item, name the rep, account, call type, and recommended action
   - If you see a pattern across a single rep (e.g., multiple demo calls with no deals created), call that out as a process gap
   - Estimate untracked pipeline based on high-severity CWD count
   - Example: "Sara Bollman: Precious Care ABA (Clinical Demo, 47 min, Jan 15) — no deal exists at this account. Likely missing deal creation."
{{/if}}

RULES:
- Use specific numbers, dollar amounts, and rep names
- Every action must be specific enough to execute this week
- If data quality is actually good (>90% critical completeness), say so briefly and focus on the few remaining gaps
- Keep response under {{output_budget.wordBudget}} words
- Do NOT request additional data via tools — all data you need is provided above`,
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
