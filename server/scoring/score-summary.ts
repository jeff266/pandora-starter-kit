/**
 * Score Summary Generation
 * Part of Prospect Score Consolidation Step 3: Factor Emission Refactor
 *
 * Generates human-readable summaries and top factor descriptions
 * for prospect scores.
 */

import { ScoreFactor, ProspectScoreResult } from './prospect-score-types.js';

/**
 * Generates top positive and negative factor one-liners.
 *
 * @param factors - All score factors
 * @returns Top positive and negative factor descriptions
 */
export function generateTopFactors(factors: ScoreFactor[]): {
  topPositive: string;
  topNegative: string;
} {
  const sorted = [...factors].sort((a, b) => b.contribution - a.contribution);

  const topPos = sorted.find((f) => f.direction === 'positive' && f.contribution > 0);
  const topNeg = [...factors]
    .sort((a, b) => a.contribution - b.contribution)
    .find((f) => f.direction === 'negative' || f.contribution < 0);

  return {
    topPositive: topPos
      ? `${topPos.label}: ${topPos.value} (+${topPos.contribution} pts)`
      : 'No strong positive signals',
    topNegative: topNeg
      ? `${topNeg.label}: ${topNeg.value} (${topNeg.contribution} pts)`
      : 'No negative signals',
  };
}

/**
 * Generates a concise score summary (< 280 characters).
 *
 * @param result - Partial prospect score result with component scores and factors
 * @param entityContext - Optional entity metadata (name, title, company, stage)
 * @returns Human-readable summary string
 */
export function generateScoreSummary(
  result: Pick<
    ProspectScoreResult,
    'fitScore' | 'engagementScore' | 'intentScore' | 'timingScore' | 'factors' | 'grade'
  >,
  entityContext?: {
    name?: string;
    title?: string;
    company?: string;
    dealStage?: string;
  }
): string {
  const parts: string[] = [];

  // Strongest pillar
  const pillarScores = [
    { name: 'ICP fit', score: result.fitScore },
    { name: 'engagement', score: result.engagementScore },
    { name: 'intent signals', score: result.intentScore },
    { name: 'timing', score: result.timingScore },
  ]
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);

  if (pillarScores.length > 0 && pillarScores[0]) {
    const strength =
      pillarScores[0].score >= 70 ? 'Strong' : pillarScores[0].score >= 50 ? 'Moderate' : 'Weak';
    parts.push(`${strength} ${pillarScores[0].name} (${pillarScores[0].score})`);
  }

  // Top positive factor detail
  const topPos = [...result.factors]
    .filter((f) => f.direction === 'positive' && f.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)[0];

  if (topPos) {
    parts.push(`${topPos.label.toLowerCase()}: ${topPos.value}`);
  }

  // Top risk
  const topNeg = [...result.factors]
    .filter((f) => f.direction === 'negative' || f.contribution < 0)
    .sort((a, b) => a.contribution - b.contribution)[0];

  if (topNeg) {
    parts.push(`risk: ${topNeg.label.toLowerCase()}`);
  }

  // Add entity context if available
  if (entityContext?.name) {
    parts.unshift(entityContext.name);
  } else if (entityContext?.title && entityContext?.company) {
    parts.unshift(`${entityContext.title} at ${entityContext.company}`);
  }

  let summary = parts.join(', ');

  // Truncate if too long
  if (summary.length > 275) {
    summary = summary.substring(0, 272) + '...';
  }

  // Add period if not already there
  if (summary && !summary.endsWith('.') && !summary.endsWith('...')) {
    summary += '.';
  }

  return summary || 'No scoring data available.';
}

/**
 * Generates a recommended action based on score components.
 *
 * @param fitScore - ICP fit score (0-100)
 * @param engagementScore - Engagement score (0-100)
 * @param intentScore - Intent score (0-100)
 * @param timingScore - Timing score (0-100)
 * @returns Recommended action code
 */
export function generateRecommendedAction(
  fitScore: number,
  engagementScore: number,
  intentScore: number,
  timingScore: number
): 'prospect' | 'reengage' | 'multi_thread' | 'nurture' | 'disqualify' {
  // High fit + high intent + high timing = prospect immediately
  if (fitScore >= 60 && intentScore >= 60 && timingScore >= 60) {
    return 'prospect';
  }

  // Good fit but low engagement = reengage
  if (fitScore >= 60 && engagementScore < 40) {
    return 'reengage';
  }

  // Good fit + engaged but low intent = multi-thread (expand deal team)
  if (fitScore >= 60 && engagementScore >= 40 && intentScore < 40) {
    return 'multi_thread';
  }

  // Moderate fit, needs nurturing
  if (fitScore >= 40 && fitScore < 60) {
    return 'nurture';
  }

  // Low fit = disqualify
  if (fitScore < 40) {
    return 'disqualify';
  }

  // Default: nurture
  return 'nurture';
}
