/**
 * Contact Role Resolution Skill — Three-Phase
 *
 * Sweeps all contacts on open deals, infers buying roles via DeepSeek,
 * writes enriched roles back to deal_contacts, and surfaces deals missing
 * critical roles (economic buyer, champion).
 *
 * Schedule: Monday 6 AM — runs before other Monday skills.
 * Phase 1: Compute — gather contacts needing roles + call participation
 * Phase 2: DeepSeek — infer roles per contact, classify deal coverage risk
 * Phase 3: Claude — synthesize Slack report with critical gaps
 */

import type { SkillDefinition } from '../types.js';

export const contactRoleResolutionSkill: SkillDefinition = {
  id: 'contact-role-resolution',
  name: 'Contact Role Resolution',
  description: 'Infers buying roles for deal contacts using title + call participation, flags deals missing economic buyer or champion',
  version: '2.0.0',
  category: 'enrichment',
  tier: 'claude',
  slackTemplate: 'contact-role-resolution',

  requiredTools: [
    'crrGatherContactsNeedingRoles',
    'crrGatherConversationContext',
    'crrPersistRoleEnrichments',
    'crrGenerateCoverageFindings',
  ],
  requiredContext: [],

  steps: [
    // ─── PHASE 1: COMPUTE ─────────────────────────────────────────────────────

    {
      id: 'gather-contacts',
      name: 'Gather Contacts Needing Role Inference',
      tier: 'compute',
      computeFn: 'crrGatherContactsNeedingRoles',
      computeArgs: { limit: 50 },
      outputKey: 'contacts_needing_roles',
    },

    {
      id: 'gather-conversation-context',
      name: 'Gather Call Participation Context',
      tier: 'compute',
      dependsOn: ['gather-contacts'],
      computeFn: 'crrGatherConversationContext',
      computeArgs: {},
      outputKey: 'conversation_context',
    },

    // ─── PHASE 2a: DEEPSEEK — Role Inference ──────────────────────────────────

    {
      id: 'infer-roles',
      name: 'Infer Buying Roles (DeepSeek)',
      tier: 'deepseek',
      dependsOn: ['gather-contacts', 'gather-conversation-context'],
      deepseekPrompt: `You are a B2B sales analyst inferring buying roles from job titles and call participation.

For each contact below, determine their buying role in the deal.

ROLE DEFINITIONS:
- economic_buyer: Budget owner, final approval authority (CFO, CEO, VP Finance, Owner)
- champion: Internal advocate who sells for you (Director/Manager level, operationally close to the problem)
- technical_evaluator: Evaluates the technical fit (IT Director, CTO, Engineer, Architect)
- coach: Provides inside guidance but limited authority (colleague of champion)
- blocker: Creates friction, may oppose the deal
- unknown: Insufficient signals to classify

SIGNALS:
- Title signals: seniority + department keywords (e.g., "CFO" → economic_buyer, "VP Engineering" → technical_evaluator)
- Call signals: contacts with 3+ calls and early participation often champions or coaches
- Low call participation (<2 calls) with senior title = economic_buyer or blocker

Contacts to classify:

{{{json contacts_needing_roles.contacts}}}

Call participation context:

{{{json conversation_context.participation}}}

Respond ONLY with a JSON array. One object per contact:
[
  {
    "contact_id": "uuid",
    "deal_id": "uuid",
    "role": "economic_buyer|champion|technical_evaluator|coach|blocker|unknown",
    "confidence": 0.0-1.0,
    "rationale": "brief 1-line reason"
  }
]

Confidence guidelines:
- Strong title signal (CFO, CEO, CTO) = 0.8+
- Ambiguous title + low calls = 0.4-0.6
- No title, no call data = 0.3
- Only assign economic_buyer or champion if genuinely confident (>= 0.6)`,
      deepseekSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            contact_id: { type: 'string' },
            deal_id: { type: 'string' },
            role: {
              type: 'string',
              enum: ['economic_buyer', 'champion', 'technical_evaluator', 'coach', 'blocker', 'unknown'],
            },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            rationale: { type: 'string' },
          },
          required: ['contact_id', 'deal_id', 'role', 'confidence'],
        },
      },
      outputKey: 'role_inferences',
      parseAs: 'json',
    },

    // ─── PHASE 2b: COMPUTE — Persist Inferences ───────────────────────────────

    {
      id: 'persist-roles',
      name: 'Persist Inferred Roles to CRM',
      tier: 'compute',
      dependsOn: ['infer-roles'],
      computeFn: 'crrPersistRoleEnrichments',
      computeArgs: { min_confidence: 0.5 },
      outputKey: 'persistence_result',
    },

    {
      id: 'check-coverage',
      name: 'Compute Deal Role Coverage',
      tier: 'compute',
      dependsOn: ['persist-roles'],
      computeFn: 'crrGenerateCoverageFindings',
      computeArgs: {},
      outputKey: 'coverage_findings',
    },

    // ─── PHASE 2c: DEEPSEEK — Coverage Risk Classification ────────────────────

    {
      id: 'classify-coverage-risk',
      name: 'Classify Coverage Risk for At-Risk Deals (DeepSeek)',
      tier: 'deepseek',
      dependsOn: ['check-coverage'],
      deepseekPrompt: `You are classifying deal risk due to missing buying roles.

For each deal below, classify:
- coverage_risk: "critical" (no EB AND no champion, amount > $50K), "concerning" (missing EB OR champion, amount > $25K), or "acceptable" (early stage or small deal)
- recommended_action: specific 1-sentence next step (e.g., "Schedule discovery call to identify budget owner before Proposal stage")

Deals with role gaps:

{{{json coverage_findings.findings}}}

Respond ONLY with a JSON array:
[
  {
    "deal_id": "uuid",
    "coverage_risk": "critical|concerning|acceptable",
    "recommended_action": "string"
  }
]`,
      deepseekSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            deal_id: { type: 'string' },
            coverage_risk: { type: 'string', enum: ['critical', 'concerning', 'acceptable'] },
            recommended_action: { type: 'string' },
          },
          required: ['deal_id', 'coverage_risk', 'recommended_action'],
        },
      },
      outputKey: 'coverage_risk_classifications',
      parseAs: 'json',
    },

    // ─── PHASE 3: CLAUDE — Synthesize Slack Output ────────────────────────────

    {
      id: 'synthesize-report',
      name: 'Generate Contact Role Map Report (Claude)',
      tier: 'claude',
      dependsOn: ['persist-roles', 'check-coverage', 'classify-coverage-risk'],
      claudePrompt: `You are a RevOps analyst delivering a Contact Role Map for a revenue team.

## Enrichment Run Results

Contacts processed: {{persistence_result.total_inferred}}
Roles written back to CRM: {{persistence_result.persisted}} (confidence >= 0.5)
Skipped (below threshold): {{persistence_result.below_threshold}}

## Coverage Summary

Total open deals analyzed: {{coverage_findings.summary.total_open_deals_analyzed}}
Deals missing economic buyer: {{coverage_findings.summary.deals_missing_economic_buyer}}
Deals missing champion: {{coverage_findings.summary.deals_missing_champion}}
Deals with no contacts at all: {{coverage_findings.summary.deals_no_contacts}}

## Deals with Role Gaps (top by amount)

{{{json coverage_findings.findings}}}

## Risk Classifications

{{{json coverage_risk_classifications}}}

---

Write a Slack-ready Contact Role Map report with:

1. **Header**: "Contact Role Map — [today's date]"
2. **Enrichment summary**: "Inferred roles for [N] contacts across [M] deals"
3. **Coverage breakdown** (use emoji):
   - ✅ Deals fully covered (EB + Champion identified)
   - ⚠️ Deals missing economic buyer ($[amount] at risk)
   - 🔴 Deals missing champion ($[amount] at risk)
4. **Critical gaps** (top 5 deals by amount with role gaps): deal name, amount, missing roles, recommended action from risk classification
5. **New this week**: notable role assignments from this run (highlight any first-time champion or EB identified)

Keep it concise — 3-4 sentences per section max. Use deal names and dollar amounts from the data.

{{voiceBlock}}`,
      outputKey: 'report',
      parseAs: 'markdown',
    },
  ],

  schedule: {
    cron: '0 6 * * 1',
    trigger: ['on_demand'],
  },

  outputFormat: 'slack',
  estimatedDuration: '60s',

  evidenceSchema: {
    entity_type: 'contact',
    columns: [
      { key: 'contact_name', display: 'Contact Name', format: 'text' },
      { key: 'email', display: 'Email', format: 'text' },
      { key: 'title', display: 'Title', format: 'text' },
      { key: 'deal_name', display: 'Deal', format: 'text' },
      { key: 'inferred_role', display: 'Inferred Role', format: 'text' },
      { key: 'confidence', display: 'Confidence', format: 'percentage' },
      { key: 'missing_roles', display: 'Missing Roles', format: 'text' },
    ],
  },
};
