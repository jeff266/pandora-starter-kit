/**
 * Deal RFM + TTE Scoring Skill
 *
 * Runs the RFM (Recency, Frequency, Monetary) scoring pipeline and
 * Time-to-Event (TTE) survival-model probability computation for all
 * open deals in the workspace.
 *
 * RFM grades deals A–F based on:
 *   - Recency:   days since last meaningful activity
 *   - Frequency: conversation / touchpoint count
 *   - Monetary:  normalized deal amount quintile
 *
 * TTE computes a close-probability for each open deal using a
 * Kaplan–Meier survival curve fitted to historical closed deals.
 * Results are written to:
 *   deals.rfm_grade, rfm_label, rfm_segment, rfm_recency_days,
 *   rfm_frequency_count, rfm_scored_at,
 *   deals.tte_conditional_prob, tte_computed_at
 *
 * These fields power:
 *   - Account pipeline "Quality Pipeline" (TTE-weighted)
 *   - Findings behavioral signal badges (Beh: A/B/C/D/F)
 *   - Action Items deal prioritization
 *   - Account RFM breakdown in the Account list
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
  description: 'Scores all deals with behavioral grades (A–F) using Recency, Frequency, and Monetary signals, then computes Time-to-Event close probabilities using a survival model fitted to historical closed deals. Powers quality pipeline, findings badges, and action item prioritization.',
  version: '1.0.0',
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
