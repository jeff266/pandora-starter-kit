import type { SkillDefinition } from '../types.js';

export const singleThreadAlertSkill: SkillDefinition = {
  id: 'single-thread-alert',
  name: 'Single-Thread Risk Alert',
  description: 'Identifies deals with only one contact engaged and flags expansion opportunities to reduce deal risk.',
  version: '1.0.0',
  category: 'deals',
  tier: 'mixed',

  requiredTools: [
    'resolveTimeWindows',
    'dealThreadingAnalysis',
    'enrichCriticalDeals',
    'calculateOutputBudget',
    'queryContacts',
  ],

  requiredContext: ['business_model', 'goals_and_targets', 'definitions'],

  timeConfig: {
    analysisWindow: 'all_time',
    changeWindow: 'since_last_run',
    trendComparison: 'none',
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
        trendComparison: 'none',
      },
      outputKey: 'time_windows',
    },

    {
      id: 'gather-threading-data',
      name: 'Analyze Deal Threading',
      tier: 'compute',
      computeFn: 'dealThreadingAnalysis',
      computeArgs: {},
      outputKey: 'threading_data',
    },

    {
      id: 'enrich-critical-deals',
      name: 'Enrich Critical Deals',
      tier: 'compute',
      dependsOn: ['gather-threading-data'],
      computeFn: 'enrichCriticalDeals',
      computeArgs: {},
      outputKey: 'enriched_deals',
    },

    {
      id: 'classify-threading-risk',
      name: 'Classify Threading Risk (DeepSeek)',
      tier: 'deepseek',
      dependsOn: ['gather-threading-data', 'enrich-critical-deals'],
      deepseekPrompt: `You are a sales operations analyst. Classify each deal below to identify why it's single-threaded and recommend expansion actions.

{{#unless dataFreshness.hasContacts}}
IMPORTANT: Contact data not available (file import workspace). Return empty JSON array: []
{{/unless}}

{{#if dataFreshness.hasContacts}}
For each deal, determine:
1. risk_level: one of [critical, high, moderate, low]
2. likely_cause: one of [early_stage_normal, champion_only, gatekeeper_block, rep_not_prospecting, small_org, transactional_deal]
3. has_expansion_contacts: boolean (true if totalContactsAtAccount > contactCount)
4. recommended_action: specific next step to expand threading

Context:
- Average sales cycle: {{business_model.sales_cycle_days}} days
- Critical stages: evaluation, decision, negotiation

CRITICAL DEALS (single-threaded in late stage OR above-average value):
{{{json enriched_deals}}}

SUMMARY STATS:
- Total pipeline: {{threading_data.summary.totalOpenDeals}} deals
- Single-threaded: {{threading_data.summary.singleThreaded.count}} deals ({{threading_data.summary.singleThreadedPctOfPipeline}}% of pipeline value)
- Average deal size: ${'$'}{{threading_data.summary.avgDealSize}}

Return valid JSON array with one object per deal:
{
  "dealId": "...",
  "dealName": "...",
  "risk_level": "critical | high | moderate | low",
  "likely_cause": "early_stage_normal | champion_only | gatekeeper_block | rep_not_prospecting | small_org | transactional_deal",
  "has_expansion_contacts": true | false,
  "recommended_action": "specific action for this deal"
}
{{/if}}`,
      deepseekSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            dealId: { type: 'string' },
            dealName: { type: 'string' },
            risk_level: { type: 'string', enum: ['critical', 'high', 'moderate', 'low'] },
            likely_cause: { type: 'string' },
            has_expansion_contacts: { type: 'boolean' },
            recommended_action: { type: 'string' },
          },
          required: ['dealId', 'dealName', 'risk_level', 'likely_cause', 'recommended_action'],
        },
      },
      outputKey: 'risk_classifications',
    },

    {
      id: 'calculate-output-budget',
      name: 'Calculate Report Complexity Budget',
      tier: 'compute',
      dependsOn: ['classify-threading-risk', 'gather-threading-data'],
      computeFn: 'calculateOutputBudget',
      computeArgs: {},
      outputKey: 'output_budget',
    },

    {
      id: 'synthesize-threading-alert',
      name: 'Synthesize Threading Alert',
      tier: 'claude',
      dependsOn: [
        'resolve-time-windows',
        'gather-threading-data',
        'enrich-critical-deals',
        'classify-threading-risk',
        'calculate-output-budget',
      ],
      claudeTools: ['queryContacts'],
      maxToolCalls: 5,
      claudePrompt: `You have pre-analyzed deal threading data for this workspace. All deals have been classified by contact coverage and expansion risk.

{{#if dataFreshness.isStale}}
⚠️ DATA FRESHNESS: {{dataFreshness.staleCaveat}}
{{/if}}

{{#unless dataFreshness.hasContacts}}
CONTACT DATA NOT AVAILABLE: This workspace uses file-imported data without contacts.
Single-thread analysis requires contact data to evaluate stakeholder coverage.

Output a brief message:
"Single-thread analysis skipped — contact data not yet imported for this workspace.
Recommendation: Upload a contacts export (CSV/Excel) to identify single-threaded deals and reduce deal risk."

Do not produce the full report. Stop here.
{{/unless}}

{{#if dataFreshness.hasContacts}}
TIME SCOPE:
- Analysis period: {{time_windows.analysisRange.start}} to {{time_windows.analysisRange.end}}
- Last run: {{time_windows.lastRunAt}}

THREADING SUMMARY:
{{{json threading_data.summary}}}

BY STAGE:
{{{json threading_data.byStage}}}

BY OWNER:
{{{json threading_data.byOwner}}}

CLASSIFIED DEALS (with expansion analysis):
{{{json risk_classifications}}}

REPORT PARAMETERS:
- Depth: {{output_budget.reportDepth}}
- Word budget: {{output_budget.wordBudget}} words maximum

Produce a Single-Thread Risk Alert with these sections:

1. TEAM PATTERN
   - What % of pipeline is single-threaded
   - Which stages have the highest single-threading rate
   - Is this normal for the sales motion (e.g., SMB transactional vs Enterprise)

2. REP PATTERNS
   - Which reps have the highest single-threading rates
   - Call out reps who need coaching on multi-threading
   - Highlight reps doing it well (low single-thread rate)

3. CRITICAL DEALS
   - For each critical/high risk classified deal:
     * Deal name, amount, stage, current contact
     * If contactRoles available: include role information (e.g., "Champion", "Decision Maker")
     * Threading status: "Multi-threaded (3): Decision Maker, Champion, End User" or "Single-threaded (1): Economic Buyer" or "No contacts linked"
     * Why it's risky (likely_cause from classification)
     * Specific expansion action (cite recommended_action)
     * If has_expansion_contacts: suggest using queryContacts to find expansion targets

4. TOP 3 ACTIONS
   - Ranked by revenue impact
   - Each action must name specific deals or reps
   - Include root cause and expected outcome
   - Example: "Action 1: Expand Acme Corp ($220K, champion_only). Contact the VP Finance (available at account). Expected: Add decision-maker, reduce close risk."

Be direct. Use actual deal names, dollar amounts, and rep names. No generic advice.
If you need to find expansion contacts at a specific account, use the queryContacts tool with accountId filter.

WORD BUDGET ENFORCEMENT:
- {{output_budget.reportDepth}} report: {{output_budget.wordBudget}} words max
- minimal: If <20% single-threaded and no critical deals, say "threading looks healthy" and stop
- standard: Cover only sections with actionable items
- detailed: Full coverage with specific examples and expansion playbook
{{/if}}`,
      outputKey: 'threading_alert',
    },
  ],

  schedule: {
    trigger: 'post_sync',
  },

  outputFormat: 'slack',
  slackTemplate: 'single-thread-alert',

  estimatedDuration: '45s',
};
