/**
 * Unified Weight Loader
 * Part of Prospect Score Consolidation Step 4: Weight Hierarchy
 *
 * Single entry point for loading scoring weights with clear priority chain:
 * 1. ICP-derived weights (from icp_profiles.scoring_weights)
 * 2. Workspace-configured weights (from workspace_score_weights table)
 * 3. Default hardcoded weights
 *
 * This eliminates the weight source chaos documented in PROSPECT_SCORING_AUDIT.md
 */

import { query } from '../db.js';
import {
  PillarCategory,
  DEFAULT_PILLAR_WEIGHTS,
} from './prospect-score-types.js';

export interface WeightLoadResult {
  pillarWeights: Record<PillarCategory, number>;
  featureWeights: Record<string, number>;
  source: 'icp_derived' | 'workspace_config' | 'default';
  icpProfileId: string | null;
  modelAccuracy: number | null;
}

/**
 * Single entry point for loading scoring weights.
 *
 * Priority chain:
 *   1. icp_profiles.scoring_weights (active profile for workspace)
 *   2. workspace_score_weights table (if admin configured custom weights)
 *   3. DEFAULT_PILLAR_WEIGHTS
 *
 * The icp_profiles weights can override individual feature weights.
 * The pillar-level split (fit/engagement/intent/timing) can come
 * from either source but ICP takes priority.
 *
 * @param workspaceId - The workspace to load weights for
 * @returns Weight load result with source tracking
 */
export async function loadScoringWeights(
  workspaceId: string
): Promise<WeightLoadResult> {
  // Tier 1: Check for active ICP profile
  const icpProfile = await query(
    `SELECT id, scoring_weights, mode, model_accuracy
     FROM icp_profiles
     WHERE workspace_id = $1 AND is_active = true
     ORDER BY created_at DESC LIMIT 1`,
    [workspaceId]
  );

  if (icpProfile.rows.length > 0 && icpProfile.rows[0].scoring_weights) {
    const raw = icpProfile.rows[0].scoring_weights;
    const pillarWeights = extractPillarWeights(raw);

    return {
      pillarWeights: pillarWeights || { ...DEFAULT_PILLAR_WEIGHTS },
      featureWeights: raw,
      source: 'icp_derived',
      icpProfileId: icpProfile.rows[0].id,
      modelAccuracy: icpProfile.rows[0].model_accuracy,
    };
  }

  // Tier 2: Check workspace_score_weights table
  const wsWeights = await query(
    `SELECT crm_weight, findings_weight, conversations_weight
     FROM workspace_score_weights
     WHERE workspace_id = $1 AND active = true AND weight_type = 'production'
     LIMIT 1`,
    [workspaceId]
  );

  if (wsWeights.rows.length > 0) {
    const w = wsWeights.rows[0];
    const total =
      (w.crm_weight || 0) + (w.findings_weight || 0) + (w.conversations_weight || 0);

    if (total > 0) {
      // Map the legacy three-weight system to four pillars
      // crm_weight → fit + intent (split evenly)
      // findings_weight → engagement (findings are engagement signals)
      // conversations_weight → timing + engagement bonus
      return {
        pillarWeights: {
          fit: (w.crm_weight / total) * 0.5,
          intent: (w.crm_weight / total) * 0.5,
          engagement:
            (w.findings_weight / total) * 0.8 +
            (w.conversations_weight / total) * 0.3,
          timing: (w.conversations_weight / total) * 0.7,
        },
        featureWeights: {},
        source: 'workspace_config',
        icpProfileId: null,
        modelAccuracy: null,
      };
    }
  }

  // Tier 3: Defaults
  return {
    pillarWeights: { ...DEFAULT_PILLAR_WEIGHTS },
    featureWeights: {},
    source: 'default',
    icpProfileId: null,
    modelAccuracy: null,
  };
}

/**
 * Extracts pillar-level weights from ICP scoring_weights JSONB.
 *
 * If the ICP profile has explicit pillar allocations (fit_weight, engagement_weight, etc.),
 * use them. Otherwise, return null and fall back to DEFAULT_PILLAR_WEIGHTS.
 *
 * @param icpWeights - The scoring_weights JSONB from icp_profiles
 * @returns Pillar weights or null if not explicitly defined
 */
function extractPillarWeights(
  icpWeights: Record<string, any>
): Record<PillarCategory, number> | null {
  // If ICP weights contain explicit pillar allocations, use them
  if (
    icpWeights.fit_weight !== undefined &&
    icpWeights.engagement_weight !== undefined
  ) {
    const total =
      (icpWeights.fit_weight || 0) +
      (icpWeights.engagement_weight || 0) +
      (icpWeights.intent_weight || 0) +
      (icpWeights.timing_weight || 0);

    if (total > 0) {
      return {
        fit: icpWeights.fit_weight / total,
        engagement: icpWeights.engagement_weight / total,
        intent: icpWeights.intent_weight / total,
        timing: icpWeights.timing_weight / total,
      };
    }
  }

  // If ICP has feature weights but not pillar-level allocations,
  // we'll use DEFAULT_PILLAR_WEIGHTS for pillar distribution
  // and the feature weights for fine-grained scoring
  return null;
}

/**
 * Validates that pillar weights sum to approximately 1.0.
 *
 * @param weights - Pillar weights to validate
 * @returns True if valid, false otherwise
 */
export function validatePillarWeights(
  weights: Record<PillarCategory, number>
): boolean {
  const sum = Object.values(weights).reduce((s, w) => s + w, 0);
  return Math.abs(sum - 1.0) < 0.02; // Allow 2% tolerance
}

/**
 * Normalizes pillar weights to sum to exactly 1.0.
 *
 * @param weights - Pillar weights to normalize
 * @returns Normalized weights
 */
export function normalizePillarWeights(
  weights: Record<PillarCategory, number>
): Record<PillarCategory, number> {
  const sum = Object.values(weights).reduce((s, w) => s + w, 0);
  if (sum === 0) return { ...DEFAULT_PILLAR_WEIGHTS };

  return {
    fit: weights.fit / sum,
    engagement: weights.engagement / sum,
    intent: weights.intent / sum,
    timing: weights.timing / sum,
  };
}
