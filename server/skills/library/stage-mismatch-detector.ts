import type { SkillDefinition } from '../types.js';

export const stageMismatchDetectorSkill: SkillDefinition = {
  id: 'stage-mismatch-detector',
  name: 'Stage Mismatch Detector',
  description: 'Identifies deals where conversation signals indicate progression beyond current CRM stage, generating actionable stage update recommendations.',
  version: '1.0.0',
  category: 'deals',
  tier: 'mixed',

  requiredTools: [
    'resolveTimeWindows',
    'stageMismatchAnalysis',
    'enrichMismatchedDeals',
    'calculateOutputBudget',
    'queryConversations',
    'queryStageHistory',
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
      id: 'gather-stage-data',
      name: 'Analyze Stage Mismatches',
      tier: 'compute',
      computeFn: 'stageMismatchAnalysis',
      computeArgs: {},
      outputKey: 'mismatch_data',
    },

    {
      id: 'enrich-mismatched-deals',
      name: 'Enrich Mismatched Deals',
      tier: 'compute',
      dependsOn: ['gather-stage-data'],
      computeFn: 'enrichMismatchedDeals',
      computeArgs: {},
      outputKey: 'enriched_deals',
    },

    {
      id: 'classify-stage-mismatches',
      name: 'Classify Stage Mismatches (DeepSeek)',
      tier: 'deepseek',
      dependsOn: ['gather-stage-data', 'enrich-mismatched-deals'],
      deepseekPrompt: `You are a sales operations analyst. Classify each stage mismatch below to determine confidence level and recommended stage progression.

{{#unless dataFreshness.hasConversations}}
IMPORTANT: Conversation data not available. Return empty JSON array: []
{{/unless}}

{{#if dataFreshness.hasConversations}}
For each deal, determine:
1. confidence: integer 0-100 (how confident are we in the mismatch?)
2. severity: one of [critical, warning, info]
3. recommended_stage_normalized: normalized stage name (e.g., "proposal", "negotiation")
4. primary_evidence_type: one of [conversation_keywords, stakeholder_expansion, activity_intensity, explicit_commitment]
5. reasoning: 2-3 sentence explanation of why stage should advance

Context:
- Your CRM stage names: {{#each definitions.dealStages}}{{label}}{{#unless @last}}, {{/unless}}{{/each}}
- Average sales cycle: {{business_model.sales_cycle_days}} days
- Typical progression: Discovery → Demo → Proposal → Negotiation → Closed Won

Confidence scoring guide:
- 90-100%: Multiple explicit buying signals (e.g., "send us the contract", "when can we start?")
- 75-89%: Clear progression signals (pricing discussed, legal/CFO engaged, timeline commitments)
- 60-74%: Moderate signals (multiple stakeholders added, detailed product questions)
- Below 60%: Weak signals (do not recommend)

DEALS WITH POTENTIAL STAGE MISMATCHES:
{{{json enriched_deals}}}

SUMMARY STATS:
- Total open deals: {{mismatch_data.summary.totalOpenDeals}}
- Potential mismatches: {{mismatch_data.summary.mismatchCount}} deals
- Average inferred phase gap: {{mismatch_data.summary.avgPhaseGap}} stages

Return valid JSON array with one object per deal where confidence >= 60:
{
  "dealId": "...",
  "dealName": "...",
  "current_stage": "...",
  "current_stage_normalized": "...",
  "recommended_stage_normalized": "proposal | negotiation | ...",
  "confidence": 85,
  "severity": "critical | warning | info",
  "primary_evidence_type": "conversation_keywords | stakeholder_expansion | activity_intensity | explicit_commitment",
  "reasoning": "Detailed explanation of why this stage advancement is recommended",
  "key_signals": ["signal 1", "signal 2", "signal 3"]
}
{{/if}}`,
      deepseekSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            dealId: { type: 'string' },
            dealName: { type: 'string' },
            current_stage: { type: 'string' },
            current_stage_normalized: { type: 'string' },
            recommended_stage_normalized: { type: 'string' },
            confidence: { type: 'number', minimum: 60, maximum: 100 },
            severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
            primary_evidence_type: { type: 'string' },
            reasoning: { type: 'string' },
            key_signals: { type: 'array', items: { type: 'string' } },
          },
          required: [
            'dealId',
            'dealName',
            'current_stage_normalized',
            'recommended_stage_normalized',
            'confidence',
            'severity',
            'reasoning',
          ],
        },
      },
      outputKey: 'stage_classifications',
    },

    {
      id: 'calculate-output-budget',
      name: 'Calculate Report Complexity Budget',
      tier: 'compute',
      dependsOn: ['classify-stage-mismatches', 'gather-stage-data'],
      computeFn: 'calculateOutputBudget',
      computeArgs: {},
      outputKey: 'output_budget',
    },

    {
      id: 'synthesize-stage-report',
      name: 'Synthesize Stage Mismatch Report',
      tier: 'claude',
      dependsOn: [
        'resolve-time-windows',
        'gather-stage-data',
        'enrich-mismatched-deals',
        'classify-stage-mismatches',
        'calculate-output-budget',
      ],
      claudeTools: ['queryConversations', 'queryStageHistory'],
      maxToolCalls: 10,
      claudePrompt: `You are a senior RevOps analyst delivering a stage mismatch detection report for {{business_model.company_name}}.

{{#if dataFreshness.isStale}}
Note: {{dataFreshness.staleCaveat}}
{{/if}}

{{#unless dataFreshness.hasConversations}}
CONVERSATION DATA NOT AVAILABLE: This workspace does not have conversation/call data.
Stage mismatch detection requires conversation analysis to identify progression signals.

Recommended actions:
- Connect Gong, Fireflies, or another call recording platform
- Or: Upload call transcripts via CSV import
- Alternative: Use manual stage progression based on activity data alone
{{/unless}}

{{#if dataFreshness.hasConversations}}
OBJECTIVE: Identify deals where recent conversation signals indicate they've progressed beyond their current CRM stage.

STAGE MISMATCH ANALYSIS RESULTS:
{{{json stage_classifications}}}

PIPELINE CONTEXT:
- Total open deals: {{mismatch_data.summary.totalOpenDeals}}
- Deals analyzed: {{mismatch_data.summary.mismatchCount}}
- Average stage age: {{mismatch_data.summary.avgStageAge}} days
- CRM source: {{mismatch_data.summary.crmSource}}

OUTPUT BUDGET: {{output_budget.complexity}} complexity
- Top mismatches to highlight: {{output_budget.top_n}}
- Max table rows: {{output_budget.max_table_rows}}

REPORT STRUCTURE:

## Executive Summary
Write 2-3 sentences summarizing:
- How many deals have stage mismatches (severity: critical or warning)
- Total dollar value affected
- Most common pattern (e.g., "deals stuck in Demo despite pricing conversations")

## Critical Stage Mismatches
For each critical severity mismatch:
- **Deal name** ($amount) — Current: [stage] → Recommended: [stage]
- One-sentence explanation of why
- Key signals (2-3 bullet points from conversation excerpts)

## Recommended Actions
Prioritized list of 3-5 stage updates to make this week, ranked by:
1. Confidence level (higher = safer to update)
2. Deal value
3. Time stuck in current stage

## Methodology Note
One paragraph explaining:
- How stage inference works (conversation keyword analysis + stakeholder mapping)
- Confidence thresholds used (only recommending changes with 60%+ confidence)
- CRM stage mapping approach (normalized → HubSpot/Salesforce stages)

CRITICAL FORMATTING RULES:
1. Use markdown headers (##, ###)
2. Bold deal names with **double asterisks**
3. Use → arrow for stage transitions
4. Keep explanations concise (1-2 sentences per deal)
5. Include $ amounts in parentheses after deal names
6. Use bullet points for signals/actions
7. Do NOT include raw JSON or technical implementation details
8. Match the voice and tone of previous RevOps reports

If you need more context on specific deals, use queryConversations or queryStageHistory tools to pull recent call transcripts or stage change history.

OUTPUT BUDGET REMINDER: Stay within {{output_budget.complexity}} complexity. If low budget, focus only on critical mismatches.
{{/if}}`,
      outputKey: 'final_report',
    },
  ],

  evidenceBuilder: 'stageMismatchEvidence',
  actionGenerator: 'stageMismatchActions',

  outputFormats: ['markdown', 'slack', 'in_app'],

  scheduling: {
    recommendedCadence: 'daily',
    minInterval: '6h',
    defaultEnabled: true,
  },

  metadata: {
    icon: '🎯',
    color: '#f97316',
    tags: ['pipeline-health', 'data-quality', 'automation', 'crm-hygiene'],
    estimatedRuntime: '45-90s',
    primaryUseCase: 'Systematically detect and correct CRM stage data drift based on conversation analysis',
    benefitStatement: 'Keeps pipeline stages accurate, enabling better forecasting and preventing deals from stalling unnoticed',
  },
};
