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
      claudePrompt: `You are a senior RevOps analyst delivering a single-threading report for {{business_model.company_name}}.

{{#if dataFreshness.isStale}}
Note: {{dataFreshness.staleCaveat}}
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

STRUCTURE YOUR REPORT:
1. Opening line: single-threading rate, dollar exposure, and trend vs last period (better/worse/stable). One sentence.
2. Where risk concentrates: which stages have the most single-threaded value. Early-stage (Discovery, Qualification) single-threading is normal — mention briefly. Late-stage (Proposal, Negotiation) is where action has the highest ROI.
3. Focus deals: highest-value late-stage single-threaded deals. For each: deal name, amount, stage, single contact's name and title, days in stage. If contactRoles available, include role information.
4. Rep pattern (only if notable): if one rep is significantly different from team average, mention it. If it's consistent across reps, note it's a process pattern, not individual.
5. One recommended action for this week. Be specific.

WHAT TO OMIT:
- Pipeline composition breakdown (single/double/multi counts) unless it changed meaningfully since last report
- Deals in Discovery or Qualification unless they're >2x average deal size
- The same number stated in different formats
- Data freshness disclaimers unless data is actually >7 days old

If you need to find expansion contacts at a specific account, use the queryContacts tool with accountId filter.

ACTIONS GENERATION:
In addition to your narrative report, output a JSON block tagged with <actions>:

<actions>
[
  {
    "action_type": "add_stakeholder" | "escalate_deal" | "notify_rep",
    "severity": "critical" | "warning",
    "target_deal_name": "exact deal name",
    "owner_email": "rep email",
    "title": "Add stakeholders — single-threaded $X deal in [stage]",
    "summary": "Only [contact name] is engaged. [N] contacts in CRM have never been on a call.",
    "impact_amount": dollar_amount,
    "urgency_label": "single-threaded, [stage] stage",
    "recommended_steps": [
      "Step 1: Identify economic buyer and technical evaluator",
      "Step 2: Ask [contact] for introductions",
      "Step 3: Schedule multi-stakeholder meeting before [date]"
    ]
  }
]
</actions>

Rules:
- critical: deals > $100K with only 1 contact engaged AND in late stages (negotiation, proposal)
- warning: deals with only 1 contact engaged in any stage
- add_stakeholder: primary action type for single-threaded deals
- escalate_deal: use when the single contact is the champion but economic buyer is missing
- Always reference specific contact names and suggest who to bring in
{{/if}}

{{voiceBlock}}`,
      outputKey: 'threading_alert',
    },
  ],

  schedule: {
    trigger: 'post_sync',
  },

  outputFormat: 'slack',
  slackTemplate: 'single-thread-alert',

  estimatedDuration: '45s',

  evidenceSchema: {
    entity_type: 'deal',
    columns: [
      { key: 'deal_name', display: 'Deal Name', format: 'text' },
      { key: 'amount', display: 'Amount', format: 'currency' },
      { key: 'stage', display: 'Stage', format: 'text' },
      { key: 'owner', display: 'Owner', format: 'text' },
      { key: 'contact_count', display: 'Contacts Linked', format: 'number' },
      { key: 'account_contact_count', display: 'Total Account Contacts', format: 'number' },
      { key: 'risk_level', display: 'Threading Risk', format: 'severity' },
      { key: 'likely_cause', display: 'Likely Cause', format: 'text' },
      { key: 'has_expansion_contacts', display: 'Expansion Available', format: 'boolean' },
      { key: 'recommended_action', display: 'Recommended Action', format: 'text' },
    ],
  },
};
