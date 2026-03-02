/**
 * Deal RFM + TTE Scoring Skill
 *
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
  description: 'Scores all deals with behavioral grades (A–F) using stage-relative Recency (enterprise procurement gaps aren\'t flagged as cold), threading-adjusted Frequency (multi-stakeholder deals outscore single-threaded ones), and Monetary signals. Also computes Time-to-Event close probabilities via a survival model. Powers quality pipeline, findings badges, and action item prioritization.',
  version: '1.1.0',
  category: 'scoring',
  tier: 'compute',

  requiredTools: ['computeRFMScores'],
  requiredContext: [],

  steps: [
    {
      id: 'compute-rfm-tte',
      name: 'Compute RFM Grades and TTE Close Probabilities',
      tier: 'compute',
      computeFn: 'computeRFMScores',
      computeArgs: {},
      outputKey: 'rfm_result',
    },
  ],
};
