/**
 * Weight Redistribution Utility
 *
 * Extracted from Composite Score logic in deal-scores.ts.
 * When certain scoring dimensions have no data, this utility redistributes
 * their weights proportionally to available dimensions.
 *
 * DEPRECATION CONTEXT:
 * This was extracted from the deprecated Composite Score implementation
 * to preserve the weight redistribution algorithm for use in the unified
 * scoring system (Account Scorer and Lead Scoring v1).
 *
 * UPDATED FOR PROMPT 3:
 * Added support for 4-pillar weight redistribution (fit/engagement/intent/timing).
 */

import { PillarCategory } from './prospect-score-types.js';

export interface WeightRedistributionInput {
  crm: number;
  findings: number;
  conversations: number;
}

export interface WeightRedistributionResult {
  crm: number;
  findings: number;
  conversations: number;
}

export interface DataAvailability {
  hasCrm: boolean;
  hasFindings: boolean;
  hasConversations: boolean;
  hasConversationScore: boolean; // Whether conversations have an actual score vs just exist
}

/**
 * Redistributes scoring weights when dimensions lack data (legacy 3-pillar system).
 *
 * Algorithm:
 * 1. If conversations exist but have no score, use 50% of conversation weight
 * 2. Calculate remaining weight to distribute between CRM and Findings
 * 3. Redistribute proportionally based on original weights
 * 4. If no data available at all, return zero weights
 *
 * @param weights - Original weight configuration
 * @param availability - Which data dimensions are available
 * @returns Adjusted weights that sum to 1.0
 */
export function redistributeWeightsLegacy(
  weights: WeightRedistributionInput,
  availability: DataAvailability
): WeightRedistributionResult {
  const originalWeights = { ...weights };

  // Calculate effective conversation weight
  let effectiveConvWeight = 0;
  if (availability.hasConversations && availability.hasConversationScore) {
    effectiveConvWeight = originalWeights.conversations;
  } else if (availability.hasConversations && !availability.hasConversationScore) {
    // Conversations exist but no score - use half weight
    effectiveConvWeight = originalWeights.conversations * 0.5;
  }

  // Determine available inputs for CRM and Findings
  const availableInputs: Array<'crm' | 'findings'> = [];
  if (availability.hasCrm) availableInputs.push('crm');
  if (availability.hasFindings) availableInputs.push('findings');

  // If nothing available, return zero weights
  if (availableInputs.length === 0 && effectiveConvWeight === 0) {
    return {
      crm: 0,
      findings: 0,
      conversations: 0,
    };
  }

  // Calculate remaining weight after conversations
  const remainingWeight = 1 - effectiveConvWeight;
  const totalCrmFindings = availableInputs.reduce((sum, key) => sum + originalWeights[key], 0);

  // Redistribute remaining weight proportionally
  const weightsUsed = {
    crm: 0,
    findings: 0,
    conversations: effectiveConvWeight
  };

  if (totalCrmFindings > 0) {
    for (const input of availableInputs) {
      weightsUsed[input] = (originalWeights[input] / totalCrmFindings) * remainingWeight;
    }
  } else if (effectiveConvWeight > 0) {
    // Only conversations available
    weightsUsed.conversations = 1;
  }

  return weightsUsed;
}

/**
 * Redistributes weights for the 4-pillar model when pillars have no data.
 *
 * When a pillar has no data (no factors with maxPossible > 0), its weight
 * is redistributed proportionally to the remaining pillars.
 *
 * Example:
 *   Original: { fit: 0.35, engagement: 0.30, intent: 0.25, timing: 0.10 }
 *   Available: ['fit', 'engagement', 'intent'] (timing missing)
 *   Result: { fit: 0.39, engagement: 0.33, intent: 0.28, timing: 0 }
 *
 * @param weights - Original pillar weights (should sum to ~1.0)
 * @param availablePillars - Which pillars have data
 * @returns Adjusted weights that sum to 1.0
 */
export function redistributeWeights(
  weights: Record<PillarCategory, number>,
  availablePillars: PillarCategory[]
): Record<PillarCategory, number> {
  const result: Record<PillarCategory, number> = {
    fit: 0,
    engagement: 0,
    intent: 0,
    timing: 0,
  };

  // If no pillars available, return zero weights
  if (availablePillars.length === 0) {
    return result;
  }

  // Calculate total weight of available pillars
  const totalAvailableWeight = availablePillars.reduce(
    (sum, pillar) => sum + weights[pillar],
    0
  );

  // If no weight in available pillars, distribute evenly
  if (totalAvailableWeight === 0) {
    const evenWeight = 1.0 / availablePillars.length;
    for (const pillar of availablePillars) {
      result[pillar] = evenWeight;
    }
    return result;
  }

  // Redistribute proportionally
  for (const pillar of availablePillars) {
    result[pillar] = weights[pillar] / totalAvailableWeight;
  }

  return result;
}

/**
 * Determines degradation state based on data availability.
 * Used for diagnostic purposes and UI indicators.
 */
export function getDegradationState(
  availability: DataAvailability
): 'full' | 'no_conversations' | 'no_findings' | 'crm_only' {
  if (availability.hasFindings && availability.hasConversations) {
    return 'full';
  } else if (availability.hasFindings && !availability.hasConversations) {
    return 'no_conversations';
  } else if (!availability.hasFindings && availability.hasConversations) {
    return 'no_findings';
  } else {
    return 'crm_only';
  }
}
