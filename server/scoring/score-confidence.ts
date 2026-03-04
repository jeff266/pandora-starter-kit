/**
 * Score Confidence Computation
 * Part of Prospect Score Consolidation Step 3: Factor Emission Refactor
 *
 * Computes confidence scores (0.0-1.0) based on data completeness,
 * factor richness, and scoring method sophistication.
 */

import { PillarCategory } from './prospect-score-types.js';

/**
 * Computes a confidence score (0.0-1.0) for a prospect score.
 *
 * Confidence is based on:
 * - Data completeness (how many of 4 pillars have data)
 * - Factor richness (how many individual factors contributed)
 * - Scoring method sophistication (point-based < ICP < regression < tree)
 * - Model accuracy (if using regression/tree models)
 *
 * @param availablePillars - Which of the 4 pillars had data
 * @param scoringMethod - Scoring method used
 * @param factorCount - Number of factors that contributed
 * @param modelAccuracy - Optional model accuracy (for regression/tree methods)
 * @returns Confidence score (0.0-1.0)
 */
export function computeConfidence(
  availablePillars: PillarCategory[],
  scoringMethod: string,
  factorCount: number,
  modelAccuracy?: number | null
): number {
  let confidence = 0;

  // Base: data completeness (how many pillars have data)
  // 4 pillars = 0.4, 3 pillars = 0.3, etc.
  const pillarCoverage = availablePillars.length / 4;
  confidence += pillarCoverage * 0.4; // max 0.4

  // Factor richness (more factors = more signal)
  // 12+ factors = max contribution
  const factorRichness = Math.min(factorCount / 12, 1);
  confidence += factorRichness * 0.2; // max 0.2

  // Method bonus (more sophisticated = higher confidence)
  switch (scoringMethod) {
    case 'recursive_tree':
      confidence += 0.3;
      break;
    case 'regression':
      confidence += 0.25;
      break;
    case 'icp_point_based':
      confidence += 0.15;
      break;
    case 'point_based':
      confidence += 0.1;
      break;
    default:
      confidence += 0.1;
  }

  // Model accuracy bonus (only for regression/tree)
  if (modelAccuracy && modelAccuracy > 0) {
    confidence += modelAccuracy * 0.1; // max 0.1
  }

  // Clamp to [0.0, 1.0] and round to 2 decimal places
  return Math.round(Math.min(1.0, Math.max(0.0, confidence)) * 100) / 100;
}

/**
 * Determines the scoring method name based on available data and ICP profile.
 *
 * @param hasICPProfile - Whether an active ICP profile exists
 * @param hasTreeModel - Whether a trained tree model exists
 * @param hasRegressionModel - Whether a regression model exists
 * @returns Scoring method identifier
 */
export function determineScoringMethod(
  hasICPProfile: boolean,
  hasTreeModel: boolean = false,
  hasRegressionModel: boolean = false
): 'point_based' | 'icp_point_based' | 'regression' | 'recursive_tree' {
  if (hasTreeModel) {
    return 'recursive_tree';
  }
  if (hasRegressionModel) {
    return 'regression';
  }
  if (hasICPProfile) {
    return 'icp_point_based';
  }
  return 'point_based';
}

/**
 * Computes data completeness percentage across all pillars.
 *
 * @param availablePillars - Which pillars have data
 * @returns Completeness percentage (0-100)
 */
export function computeDataCompleteness(availablePillars: PillarCategory[]): number {
  return Math.round((availablePillars.length / 4) * 100);
}
