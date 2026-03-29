/**
 * Engagement Drop-Off Analysis Skill
 *
 * Studies closed deals (won and lost) to find the point at which two-way engagement drops off.
 * Bifurcates by outcome. Produces stage-specific silence thresholds that are materially
 * smarter than a global "30 days stale" rule.
 *
 * Writes computed thresholds back to calibration_checklist and metric_definitions as COMPUTED confidence.
 */

import type { SkillDefinition } from '../types.js';

export const engagementDropoffAnalysisSkill: SkillDefinition = {
  id: 'engagement-dropoff-analysis',
  name: 'Engagement Drop-Off Analysis',
  description: 'Computes stage-specific engagement thresholds from won vs lost deal patterns, identifies at-risk deals',
  version: '1.0.0',
  category: 'pipeline',
  tier: 'mixed',

  requiredTools: [
    'resolveTimeWindows',
    'analyzeEngagementThresholds',
    'computeOpenDealRisk',
    'writeThresholdsToSystem',
    'classifyEngagementRisk',
    'synthesizeEngagementReport',
  ],

  requiredContext: ['business_model'],

  timeConfig: {
    analysisWindow: 'all_time',
    changeWindow: 'last_7d',
  },

  steps: [
    // Step 1: Resolve time windows
    {
      id: 'resolve-time-windows',
      name: 'Resolve Time Windows',
      tier: 'compute',
      computeFn: 'resolveTimeWindows',
      computeArgs: {
        analysisWindow: 'trailing_18m',
      },
      outputKey: 'time_windows',
    },

    // Step 2: Analyze historical engagement thresholds (closed deals)
    {
      id: 'analyze-thresholds',
      name: 'Analyze Historical Engagement Thresholds',
      tier: 'compute',
      dependsOn: ['resolve-time-windows'],
      computeFn: 'analyzeEngagementThresholds',
      computeArgs: {
        lookbackMonths: 18,
        minDealsPerCell: 5,
      },
      outputKey: 'threshold_analysis',
    },

    // Step 3: Compute open deal risk against thresholds
    {
      id: 'compute-open-deal-risk',
      name: 'Compute Open Deal Risk',
      tier: 'compute',
      dependsOn: ['analyze-thresholds'],
      computeFn: 'computeOpenDealRisk',
      computeArgs: {
        maxCriticalDeals: 20,
      },
      outputKey: 'open_deal_risk',
    },

    // Step 4: Write thresholds to system (before classify)
    {
      id: 'write-thresholds',
      name: 'Write Thresholds to WorkspaceIntelligence',
      tier: 'compute',
      dependsOn: ['analyze-thresholds'],
      computeFn: 'writeThresholdsToSystem',
      computeArgs: {},
      outputKey: 'threshold_write_result',
    },

    // Step 5: Classify engagement drop-off root causes (DeepSeek)
    {
      id: 'classify-dropoff-causes',
      name: 'Classify Engagement Drop-Off Root Causes',
      tier: 'deepseek',
      dependsOn: ['compute-open-deal-risk'],
      deepseekPrompt: `Classify engagement drop-off root cause for each deal. Return JSON only.

DEALS: {{{json open_deal_risk.critical}}}

STAGE THRESHOLDS:
{{#each threshold_analysis.stages}}
- {{@key}}: threshold {{this.threshold_days}} days (won median: {{this.won_median_days}}d, lost median: {{this.lost_median_days}}d)
{{/each}}

For each deal return:
- deal_id
- root_cause: rep_neglect | prospect_stalled | champion_change | timing | competitive_loss | data_hygiene | process_gap
- confidence: 0.0-1.0
- signals: 2-3 specific evidence strings
- suggested_action: one specific next action, max 15 words

Return ONLY: { "classifications": [...] }`,
      deepseekSchema: {
        type: 'object',
        properties: {
          classifications: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                deal_id: { type: 'string' },
                root_cause: {
                  type: 'string',
                  enum: ['rep_neglect', 'prospect_stalled', 'champion_change', 'timing', 'competitive_loss', 'data_hygiene', 'process_gap'],
                },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
                signals: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 3 },
                suggested_action: { type: 'string', maxLength: 100 },
              },
              required: ['deal_id', 'root_cause', 'confidence', 'signals', 'suggested_action'],
            },
          },
        },
        required: ['classifications'],
      },
      outputKey: 'classifications',
    },

    // Step 6: Synthesize report (Claude)
    {
      id: 'synthesize-report',
      name: 'Synthesize Engagement Drop-Off Report',
      tier: 'claude',
      dependsOn: [
        'resolve-time-windows',
        'analyze-thresholds',
        'compute-open-deal-risk',
        'classify-dropoff-causes',
        'write-thresholds',
      ],
      claudePrompt: `You are a VP RevOps analyst delivering engagement drop-off analysis for {{business_model.company_name}}.

{{#if gateResult}}{{#if (eq gateResult.gate "DRAFT")}}
⚠️ DRAFT MODE: This analysis is operating with incomplete calibration. Missing: {{#each gateResult.missing_preferred}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}. Results may not reflect confirmed business rules.
{{/if}}{{/if}}

ENGAGEMENT DROP-OFF ANALYSIS — {{business_model.company_name}}
Analyzed {{threshold_analysis.total_closed_deals_analyzed}} closed deals, last 18 months.
Data sources: {{#each threshold_analysis.data_sources}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}

STAGE THRESHOLDS (computed from won vs lost bifurcation):
{{#each threshold_analysis.stages}}
{{@key}}: warning at {{this.warning_days}} days, critical at {{this.threshold_days}} days
  (won median: {{this.won_median_days}}d, lost median: {{this.lost_median_days}}d,
   n={{this.won_deal_count}} won / {{this.lost_deal_count}} lost, confidence: {{this.confidence}})
{{/each}}

CURRENT PIPELINE RISK:
Critical: {{open_deal_risk.summary.critical_count}} deals, \${{open_deal_risk.summary.critical_value}}
Warning: {{open_deal_risk.summary.warning_count}} deals, \${{open_deal_risk.summary.warning_value}}
No engagement signal: {{open_deal_risk.no_signal.count}} deals, \${{open_deal_risk.no_signal.total_value}}
At-risk share of pipeline: {{open_deal_risk.summary.pct_pipeline_at_risk}}%

TOP CRITICAL DEALS:
{{#each open_deal_risk.critical}}
- {{this.name}} (\${{this.amount}}, {{this.stage}}):
  {{this.days_since_two_way}} days silence (threshold: {{this.threshold_days}}d).
  Root cause and action available in classifications.
{{/each}}

YOUR TASK:
1. Lead with the most important number about pipeline engagement health.
2. Call out 2-3 specific deals that need immediate action and why.
3. Note any systemic pattern across root causes.
4. One recommendation for the CRO.

VP RevOps audience. Numbers over adjectives. Short sentences. Max 300 words.

{{voiceBlock}}

After your report, emit an <actions> block containing a JSON array of specific, executable actions. Each action must have:
- action_type: one of "re_engage_deal", "update_champion", "confirm_timeline", "mark_at_risk"
- severity: "critical" | "warning" | "info"
- title: short action title
- summary: 1-2 sentence explanation
- recommended_steps: array of 1-3 concrete steps
- target_deal_name: exact deal name (if deal-specific)
- owner_email: rep email (if available)
- impact_amount: deal amount (number, no currency symbol)
- urgency_label: "overdue" | "this_week" | "next_week"

Focus on the top 5-10 most critical engagement gaps. Example:
<actions>
[{"action_type":"re_engage_deal","severity":"critical","title":"Re-engage Action Behavior Centers deal","summary":"99 days since last two-way contact. Threshold for Proposal Reviewed is 31 days.","recommended_steps":["Confirm decision timeline with champion","Schedule demo of new feature","Send ROI calculator"],"target_deal_name":"Action Behavior Centers","owner_email":"rep@company.com","impact_amount":150000,"urgency_label":"overdue"}]
</actions>`,
      outputKey: 'engagement_report',
    },
  ],

  schedule: {
    cron: '0 8 * * 1', // Monday 8 AM UTC (same cadence as pipeline-waterfall)
    trigger: 'on_demand',
  },

  outputFormat: 'slack',
  slackTemplate: 'engagement-dropoff',

  estimatedDuration: '60s',

  answers_questions: [
    'engagement',
    'stale deals',
    'silence threshold',
    'when did we last talk',
    'at-risk deals',
  ],

  evidenceSchema: {
    entity_type: 'deal',
    columns: [
      { key: 'deal_name', display: 'Deal Name', format: 'text' },
      { key: 'stage', display: 'Stage', format: 'text' },
      { key: 'amount', display: 'Amount', format: 'currency' },
      { key: 'owner', display: 'Owner', format: 'text' },
      { key: 'days_since_two_way', display: 'Days Since Engagement', format: 'number' },
      { key: 'threshold_days', display: 'Threshold', format: 'number' },
      { key: 'risk_level', display: 'Risk Level', format: 'severity' },
      { key: 'root_cause', display: 'Root Cause', format: 'text' },
      { key: 'suggested_action', display: 'Suggested Action', format: 'text' },
    ],
  },
};
