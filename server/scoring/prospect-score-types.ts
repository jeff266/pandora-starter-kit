/**
 * Prospect Score Type Definitions
 * Part of Prospect Score Consolidation Step 3: Factor Emission Refactor
 *
 * Defines the unified type system for the 4-pillar prospect scoring model:
 * - Fit (35%): ICP match, firmographic alignment
 * - Engagement (30%): Activity signals, email/meeting frequency
 * - Intent (25%): Deal signals, buying committee engagement
 * - Timing (10%): Readiness signals, urgency indicators
 */

export type PillarCategory = 'fit' | 'engagement' | 'intent' | 'timing';

/**
 * A single contributing factor to a prospect score.
 * Each factor represents one field/signal that influenced the score.
 */
export interface ScoreFactor {
  field: string;           // e.g., "industry", "days_since_activity"
  label: string;           // e.g., "Industry Match", "Activity Recency"
  value: string;           // e.g., "SaaS", "3 days"
  contribution: number;    // actual points contributed (can be negative)
  maxPossible: number;     // maximum this factor could contribute
  direction: 'positive' | 'negative';
  category: PillarCategory;
  benchmark?: {
    populationAvg: number;   // average contribution across all scored entities
    percentile: number;      // this entity's percentile (0-100)
    wonDealAvg?: number;     // average contribution for closed-won deals
  };
  explanation?: string;    // human-readable why this matters (only for top factors)
}

/**
 * A scoring pillar with its component factors.
 * Each pillar aggregates multiple factors into a 0-100 score.
 */
export interface PillarResult {
  category: PillarCategory;
  score: number;           // 0-100 for this pillar
  maxPossible: number;     // always 100
  weight: number;          // configured weight (e.g., 0.35)
  effectiveWeight: number; // after redistribution (e.g., 0.39 if timing=0)
  factors: ScoreFactor[];  // individual contributing factors
  dataAvailable: boolean;  // false if this pillar had no data at all
}

/**
 * Complete prospect score result with all metadata.
 * This is the top-level output from the unified scoring engine.
 */
export interface ProspectScoreResult {
  entityType: 'deal' | 'contact' | 'account';
  entityId: string;

  // Composite
  totalScore: number;      // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';

  // Components
  fitScore: number;
  engagementScore: number;
  intentScore: number;
  timingScore: number;

  // Pillars with detail
  pillars: PillarResult[];

  // Show your math
  factors: ScoreFactor[];           // all factors, sorted by |contribution|
  topPositiveFactor: string;        // one-liner: "Industry match: SaaS (+12 pts)"
  topNegativeFactor: string;        // one-liner: "No activity 23 days (−10 pts)"
  scoreSummary: string;             // < 280 chars

  // Metadata
  scoreMethod: 'point_based' | 'icp_point_based' | 'regression' | 'recursive_tree';
  scoreConfidence: number;          // 0.0-1.0
  availablePillars: PillarCategory[];
  effectiveWeights: Record<PillarCategory, number>;

  // History
  previousScore: number | null;
  scoreChange: number | null;

  // Action
  recommendedAction?: string;

  // Source tracking
  icpProfileId?: string | null;
  sourceObject?: 'lead' | 'contact' | 'deal';
}

/**
 * Default weights for the 4-pillar model.
 * These are used when no ICP-derived or workspace-configured weights exist.
 */
export const DEFAULT_PILLAR_WEIGHTS: Record<PillarCategory, number> = {
  fit: 0.35,
  engagement: 0.30,
  intent: 0.25,
  timing: 0.10,
};

/**
 * Maps existing Lead Scoring dimensions to the 4-pillar model.
 * This allows backward compatibility while migrating to the new structure.
 */
export const DIMENSION_TO_PILLAR: Record<string, PillarCategory> = {
  // Deal dimensions (from Lead Scoring v1)
  'engagement': 'engagement',
  'threading': 'intent',
  'deal_quality': 'intent',
  'velocity': 'timing',
  'conversations': 'engagement',
  'enrichment': 'fit',
  'enrichment_firmographic': 'fit',
  'enrichment_signals': 'timing',

  // Contact dimensions (from Lead Scoring v1)
  'role_weight': 'fit',
  'deal_score_inheritance': 'intent',
  'activity_engagement': 'engagement',

  // Account Scorer dimensions (for future account absorption)
  'firmographic_fit': 'fit',
  'signal_score': 'timing',
  'account_engagement': 'engagement',
  'deal_history': 'intent',
};

/**
 * Helper function to assign letter grade based on score.
 */
export function assignGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  if (score >= 20) return 'D';
  return 'F';
}

/**
 * Helper function to determine factor direction.
 */
export function determineDirection(
  contribution: number,
  maxPossible: number
): 'positive' | 'negative' {
  if (maxPossible === 0) return 'positive';
  const ratio = contribution / maxPossible;
  return ratio >= 0.5 ? 'positive' : 'negative';
}
