/**
 * Deal RFM + TTE Scoring Skill
 *
 * v2.0.0: Added Claude narrative synthesis layer. Top and bottom scored deals
 *   are now surfaced with actionable deal-level prescriptions. Output includes
 *   a Slack-compatible scorecard narrative.
 * v1.1.0: Stage-relative recency thresholds (enterprise procurement gaps no longer
 *   flagged as cold). Threading multiplier on frequency (multi-stakeholder deals
 *   score higher than single-threaded deals with the same raw touchpoint count).
 * v1.0.0: Initial RFM + TTE scoring.
 *
 * Runs the RFM (Recency, Frequency, Monetary) scoring pipeline and
 * Time-to-Event (TTE) survival-model probability computation for all
 * open deals in the workspace.
 *
 * RFM grades deals A–F based on:
 *   - Recency:    days since last meaningful activity, measured against
 *                 stage-specific thresholds derived from your closed-won history.
 *                 A 30-day gap in Legal/Review is normal. The same gap in Proposal
 *                 is a crisis. The model knows the difference.
 *   - Frequency:  weighted touchpoint count (meeting×10, call×5, email×2),
 *                 adjusted by a threading multiplier:
 *                   1 contact engaged  → ×0.6 (single-threaded penalty)
 *                   2 contacts         → ×0.8
 *                   3+ contacts        → ×1.0
 *                   3+ with economic buyer/executive → ×1.2 (bonus)
 *                 Threading multiplier applies only when contact data covers
 *                 ≥30% of open deals; otherwise defaults to ×1.0 with a caveat.
 *   - Monetary:   normalized deal amount quintile
 *
 * TTE computes a close-probability for each open deal using a
 * Kaplan–Meier survival curve fitted to historical closed deals.
 *
 * Results are written to:
 *   deals.rfm_grade, rfm_label, rfm_segment, rfm_recency_days,
 *   rfm_recency_stage, rfm_recency_stage_threshold,
 *   rfm_frequency_count, rfm_threading_factor, rfm_scored_at,
 *   deals.tte_conditional_prob, tte_computed_at
 *
 * These fields power:
 *   - Account pipeline "Quality Pipeline" (TTE-weighted)
 *   - Findings behavioral signal badges (Beh: A/B/C/D/F)
 *   - Action Items deal prioritization
 *   - Account RFM breakdown in the Account list
 *   - Score card narrative ("34 days — normal for awareness stage (threshold: 45d)")
 *
 * Runs automatically after every CRM sync. Use this skill to run
 * on-demand after bulk imports or to refresh stale scores.
 *
 * Schedule: On-demand (also runs automatically post-CRM-sync)
 */

import type { SkillDefinition } from '../types.js';

export const dealRfmScoringSkill: SkillDefinition = {
  id: 'deal-rfm-scoring',
  name: 'Deal RFM + TTE Scoring',
  description: 'Scores all deals with behavioral grades (A–F) using stage-relative Recency (enterprise procurement gaps aren\'t flagged as cold), threading-adjusted Frequency (multi-stakeholder deals outscore single-threaded ones), and Monetary signals. Also computes Time-to-Event close probabilities via a survival model. Synthesizes a narrative scorecard highlighting at-risk and healthy deals. Powers quality pipeline, findings badges, and action item prioritization.',
  version: '2.0.0',
  category: 'scoring',
  tier: 'mixed',

  requiredTools: ['computeRFMScores', 'gatherScoredDealNarratives'],
  requiredContext: ['business_model'],

  steps: [
    {
      id: 'compute-rfm-tte',
      name: 'Compute RFM Grades and TTE Close Probabilities',
      tier: 'compute',
      computeFn: 'computeRFMScores',
      computeArgs: {},
      outputKey: 'rfm_result',
    },

    {
      id: 'gather-narratables',
      name: 'Gather Scored Deals for Narrative',
      tier: 'compute',
      dependsOn: ['compute-rfm-tte'],
      computeFn: 'gatherScoredDealNarratives',
      computeArgs: {},
      outputKey: 'scored_deals',
    },

    {
      id: 'synthesize-rfm-report',
      name: 'Synthesize RFM Scorecard Narrative',
      tier: 'claude',
      dependsOn: ['compute-rfm-tte', 'gather-narratables'],
      claudePrompt: `You are a RevOps analyst delivering a deal health scorecard to a sales leader at {{business_model.company_name}}. Be direct, use deal names, and prescribe specific actions. No generic advice.

SCORING RUN SUMMARY:
- Deals scored: {{rfm_result.rfm_scored}}
- Scoring mode: {{rfm_result.rfm_mode}} (full_rfm = rich activity data, rm_only = partial, r_only = recency only)
- TTE computed: {{rfm_result.tte_computed}}

GRADE DISTRIBUTION:
{{#each scored_deals.gradeDistribution}}
- {{@key}}: {{this}} deals
{{/each}}

AT-RISK DEALS (Grade D/F — need immediate attention):
{{#each scored_deals.atRisk}}
- **{{this.deal_name}}** ({{this.account_name}}) — Grade {{this.rfm_grade}} | {{this.rfm_label}}
  Owner: {{this.owner_name}} | Stage: {{this.stage}} | Amount: \${{this.amount}}
  Recency: {{this.rfm_recency_days}} days since last activity (threshold for {{this.rfm_recency_stage}}: {{this.rfm_recency_stage_threshold}} days)
  Activity score: {{this.rfm_frequency_count}} weighted touches | Threading: ×{{this.rfm_threading_factor}}
  TTE close probability: {{this.tte_pct}}%
{{/each}}

HEALTHY DEALS (Grade A/B — reinforce momentum):
{{#each scored_deals.healthy}}
- **{{this.deal_name}}** ({{this.account_name}}) — Grade {{this.rfm_grade}} | {{this.rfm_label}}
  Owner: {{this.owner_name}} | Stage: {{this.stage}} | Amount: \${{this.amount}} | TTE: {{this.tte_pct}}%
{{/each}}

Write a deal health scorecard covering:

1. **HEADLINE** (one sentence): How many deals are at risk vs healthy? What's the total dollar value at stake?

2. **CRITICAL ACTIONS — At-Risk Deals**: For each D/F deal, write one specific prescription:
   - What the problem is (recency gap vs activity gap vs single-threaded vs all three)
   - What to do this week (multi-thread with a specific contact type, restart the conversation, escalate)
   - What happens if nothing changes (TTE probability declining)

3. **BRIGHT SPOTS — Healthy Deals**: For the top 3 A/B deals, one sentence on what's working. Keep momentum going.

4. **PATTERN**: Is there a theme across the at-risk deals? (Same owner, same stage, same root cause?)

5. **ONE ACTION TODAY**: The single most impactful thing the team can do right now.

Keep it under 500 words. This is the Monday pipeline review, not a report.

{{voiceBlock}}`,
      maxTokens: 2500,
      outputKey: 'report',
    },
  ],

  outputFormat: 'markdown',
  slackTemplate: 'rfm-scorecard',
  estimatedDuration: '60s',

  answers_questions: ['rfm', 'behavioral score', 'deal grade', 'deal health', 'engagement score', 'at risk', 'stale deals', 'tte', 'close probability'],

  evidenceSchema: {
    entity_type: 'deal',
    columns: [
      { key: 'deal_name', display: 'Deal', format: 'text' },
      { key: 'account_name', display: 'Account', format: 'text' },
      { key: 'rfm_grade', display: 'Grade', format: 'text' },
      { key: 'rfm_label', display: 'Label', format: 'text' },
      { key: 'rfm_recency_days', display: 'Days Since Activity', format: 'number' },
      { key: 'rfm_frequency_count', display: 'Activity Score', format: 'number' },
      { key: 'rfm_threading_factor', display: 'Threading Multiplier', format: 'number' },
      { key: 'tte_pct', display: 'Close Probability %', format: 'number' },
      { key: 'amount', display: 'Amount', format: 'currency' },
      { key: 'owner_name', display: 'Owner', format: 'text' },
    ],
  },
};
