/**
 * Pillar Aggregation
 * Part of Prospect Score Consolidation Step 3: Factor Emission Refactor
 *
 * Aggregates individual scoring factors into 4 pillars and computes
 * the final composite score with graceful weight redistribution.
 */

import {
  PillarCategory,
  PillarResult,
  ScoreFactor,
  DEFAULT_PILLAR_WEIGHTS,
  assignGrade,
} from './prospect-score-types.js';
import { redistributeWeights } from './weight-redistribution.js';

/**
 * Aggregates factors into pillars and computes composite score.
 *
 * @param allFactors - All scoring factors from all dimensions
 * @param configuredWeights - Pillar weights (ICP-derived or workspace config)
 * @returns Pillar results, effective weights, and available pillars
 */
export function aggregatePillars(
  allFactors: ScoreFactor[],
  configuredWeights?: Record<PillarCategory, number>
): {
  pillars: PillarResult[];
  effectiveWeights: Record<PillarCategory, number>;
  availablePillars: PillarCategory[];
} {
  const weights = configuredWeights || DEFAULT_PILLAR_WEIGHTS;

  // Group factors by pillar
  const grouped: Record<PillarCategory, ScoreFactor[]> = {
    fit: [],
    engagement: [],
    intent: [],
    timing: [],
  };

  for (const factor of allFactors) {
    grouped[factor.category].push(factor);
  }

  // Determine which pillars have data
  const availablePillars: PillarCategory[] = [];
  for (const [cat, factors] of Object.entries(grouped)) {
    // A pillar "has data" if at least one factor has a non-zero maxPossible
    const hasData = factors.some((f) => f.maxPossible > 0);
    if (hasData) {
      availablePillars.push(cat as PillarCategory);
    }
  }

  // Redistribute weights for missing pillars
  const effectiveWeights = redistributeWeights(weights, availablePillars);

  // Compute each pillar score (0-100 scale)
  const pillars: PillarResult[] = (
    ['fit', 'engagement', 'intent', 'timing'] as PillarCategory[]
  ).map((cat) => {
    const factors = grouped[cat];
    const totalContribution = factors.reduce((sum, f) => sum + f.contribution, 0);
    const totalMax = factors.reduce((sum, f) => sum + f.maxPossible, 0);

    // Scale to 0-100
    const score = totalMax > 0 ? Math.round((totalContribution / totalMax) * 100) : 0;

    return {
      category: cat,
      score: Math.max(0, Math.min(100, score)),
      maxPossible: 100,
      weight: weights[cat],
      effectiveWeight: effectiveWeights[cat],
      factors,
      dataAvailable: availablePillars.includes(cat),
    };
  });

  return { pillars, effectiveWeights, availablePillars };
}

/**
 * Computes the weighted composite score from pillars.
 *
 * @param pillars - Pillar results with scores and effective weights
 * @returns Composite score (0-100)
 */
export function computeComposite(pillars: PillarResult[]): number {
  let composite = 0;
  for (const pillar of pillars) {
    composite += pillar.score * pillar.effectiveWeight;
  }
  return Math.round(Math.max(0, Math.min(100, composite)));
}

/**
 * Sorts factors by absolute contribution (most impactful first).
 *
 * @param factors - Array of score factors
 * @returns Sorted array (highest absolute contribution first)
 */
export function sortFactorsByImpact(factors: ScoreFactor[]): ScoreFactor[] {
  return [...factors].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

/**
 * Extracts top positive and negative factors.
 *
 * @param factors - All score factors
 * @returns Top positive and top negative factor
 */
export function getTopFactors(factors: ScoreFactor[]): {
  topPositive: ScoreFactor | null;
  topNegative: ScoreFactor | null;
} {
  const positiveFactors = factors
    .filter((f) => f.direction === 'positive' && f.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution);

  const negativeFactors = factors
    .filter((f) => f.direction === 'negative' || f.contribution < 0)
    .sort((a, b) => a.contribution - b.contribution);

  return {
    topPositive: positiveFactors[0] || null,
    topNegative: negativeFactors[0] || null,
  };
}

export { assignGrade };
