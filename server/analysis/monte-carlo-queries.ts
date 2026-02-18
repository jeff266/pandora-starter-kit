/**
 * Monte Carlo Query Engine
 *
 * Six typed query handlers that extract answers from stored iteration records.
 * Each handler takes IterationRecord[] and returns a structured result for
 * Claude synthesis.
 */

import type { IterationRecord, SimulationInputs } from './monte-carlo-engine.js';
import { runSimulation } from './monte-carlo-engine.js';

// ─── Query Type Registry ──────────────────────────────────────────────────────

export type QueryType =
  | 'deal_probability'
  | 'must_close'
  | 'what_if_win_rate'
  | 'what_if_deal'
  | 'scenario_decompose'
  | 'component_sensitivity'
  | 'rep_impact'
  | 'unknown';

// ─── Result Types ─────────────────────────────────────────────────────────────

export interface DealProbabilityResult {
  dealId: string;
  dealName: string;
  amount: number;
  appearsInPct: number;
  appearsInWinningPct: number;
  isCorrelated: string[];
}

export interface MustCloseResult {
  mustCloseDeals: {
    dealId: string;
    dealName: string;
    amount: number;
    pctOfIterationsAboveTarget: number;
    pctOfIterationsBelowTarget: number;
    lift: number;
  }[];
  targetRevenue: number;
  iterationsAboveTarget: number;
}

export interface WhatIfWinRateResult {
  currentWinRate: number;
  hypotheticalWinRate: number;
  currentP50: number;
  hypotheticalP50: number;
  currentProbOfTarget: number | null;
  hypotheticalProbOfTarget: number | null;
  p50Delta: number;
  probDelta: number | null;
}

export interface WhatIfDealResult {
  dealId: string;
  dealName: string;
  dealAmount: number;
  baselineP50: number;
  withDealP50: number;
  baselineProb: number | null;
  withDealProb: number | null;
  p50Delta: number;
}

export interface ScenarioDecomposeResult {
  threshold: 'top_quartile' | 'above_target' | 'bottom_quartile' | 'below_target';
  totalIterations: number;
  matchingIterations: number;
  avgExistingRevenue: number;
  avgProjectedRevenue: number;
  avgNewDealsCreated: number;
  topDeals: { dealId: string; appearsInPct: number }[];
  topReps: { repEmail: string; avgRevenue: number }[];
  summary: string;
}

export interface ComponentSensitivityResult {
  existingOnlyP50: number;
  existingOnlyProbOfTarget: number | null;
  baselineP50: number;
  baselineProb: number | null;
  projectedContributionPct: number;
  fragility: 'high' | 'medium' | 'low';
}

export interface RepImpactResult {
  repEmail: string;
  repName: string;
  avgContributionToP50: number;
  baselineP50: number;
  withoutRepP50: number;
  withoutRepProb: number | null;
  p50Delta: number;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.floor(pct * sorted.length)] ?? sorted[sorted.length - 1];
}

function sortedTotals(iterations: IterationRecord[]): number[] {
  return [...iterations.map(r => r.total)].sort((a, b) => a - b);
}

// ─── 1. Deal Probability ──────────────────────────────────────────────────────

export function queryDealProbability(
  iterations: IterationRecord[],
  deals: { id: string; name: string; amount: number }[]
): DealProbabilityResult[] {
  if (iterations.length === 0 || deals.length === 0) return [];

  const sorted = sortedTotals(iterations);
  const topQuartileThreshold = percentile(sorted, 0.75);
  const winningIterations = iterations.filter(r => r.total >= topQuartileThreshold);
  const n = iterations.length;
  const nWinning = winningIterations.length;

  return deals.map(deal => {
    const appearsCount = iterations.filter(r => r.dealsWon.includes(deal.id)).length;
    const appearsInWinningCount = winningIterations.filter(r => r.dealsWon.includes(deal.id)).length;

    // Correlation: find other deals that co-occur more than expected
    const appearsInPct = appearsCount / n;
    const correlated: string[] = [];
    if (nWinning > 0) {
      for (const other of deals) {
        if (other.id === deal.id) continue;
        const otherPct = iterations.filter(r => r.dealsWon.includes(other.id)).length / n;
        const coOccurPct = iterations.filter(
          r => r.dealsWon.includes(deal.id) && r.dealsWon.includes(other.id)
        ).length / n;
        // Lift > 1.3 indicates positive correlation
        if (appearsInPct > 0 && otherPct > 0 && coOccurPct / (appearsInPct * otherPct) > 1.3) {
          correlated.push(other.id);
        }
      }
    }

    return {
      dealId: deal.id,
      dealName: deal.name,
      amount: deal.amount,
      appearsInPct: Math.round(appearsInPct * 1000) / 10,
      appearsInWinningPct: nWinning > 0 ? Math.round((appearsInWinningCount / nWinning) * 1000) / 10 : 0,
      isCorrelated: correlated,
    };
  });
}

// ─── 2. Must-Close ────────────────────────────────────────────────────────────

export function queryMustClose(
  iterations: IterationRecord[],
  targetRevenue: number,
  topN = 5
): MustCloseResult {
  const above = iterations.filter(r => r.total >= targetRevenue);
  const below = iterations.filter(r => r.total < targetRevenue);
  const nAbove = above.length;
  const nBelow = below.length;

  // Collect all deal IDs across all iterations
  const allDealIds = new Set<string>();
  for (const r of iterations) r.dealsWon.forEach(id => allDealIds.add(id));

  const dealLifts = Array.from(allDealIds).map(dealId => {
    const aboveCount = above.filter(r => r.dealsWon.includes(dealId)).length;
    const belowCount = below.filter(r => r.dealsWon.includes(dealId)).length;
    const abovePct = nAbove > 0 ? aboveCount / nAbove : 0;
    const belowPct = nBelow > 0 ? belowCount / nBelow : 0;
    return { dealId, abovePct, belowPct, lift: abovePct - belowPct };
  });

  dealLifts.sort((a, b) => b.lift - a.lift);

  return {
    mustCloseDeals: dealLifts.slice(0, topN).map(d => ({
      dealId: d.dealId,
      dealName: d.dealId, // caller resolves name from openDeals
      amount: 0,           // caller resolves from openDeals
      pctOfIterationsAboveTarget: Math.round(d.abovePct * 1000) / 10,
      pctOfIterationsBelowTarget: Math.round(d.belowPct * 1000) / 10,
      lift: Math.round(d.lift * 1000) / 10,
    })),
    targetRevenue,
    iterationsAboveTarget: nAbove,
  };
}

// ─── 3. What-If Win Rate ──────────────────────────────────────────────────────

export async function queryWhatIfWinRate(
  storedInputs: {
    distributions: any;
    openDeals: any[];
    forecastWindowEnd: string;
    today: string;
    pipelineType: string;
    quota: number | null;
  },
  currentP50: number,
  currentProbOfTarget: number | null,
  hypotheticalWinRateMultiplier: number,
  miniIterations = 2000
): Promise<WhatIfWinRateResult> {
  // Build scaled distributions — multiply all Beta alphas by the win rate multiplier
  const scaledDistributions = JSON.parse(JSON.stringify(storedInputs.distributions));
  for (const key of Object.keys(scaledDistributions.stageWinRates ?? {})) {
    if (scaledDistributions.stageWinRates[key]?.alpha !== undefined) {
      scaledDistributions.stageWinRates[key].alpha *= hypotheticalWinRateMultiplier;
    }
  }

  const openDeals = (storedInputs.openDeals ?? []).map((d: any) => ({
    ...d,
    closeDate: new Date(d.closeDate),
  }));

  const simInputs: SimulationInputs = {
    openDeals,
    distributions: scaledDistributions,
    riskAdjustments: {},
    forecastWindowEnd: new Date(storedInputs.forecastWindowEnd),
    today: new Date(storedInputs.today),
    iterations: miniIterations,
    pipelineType: (storedInputs.pipelineType as any) ?? 'new_business',
    storeIterations: false,
  };

  const result = runSimulation(simInputs, storedInputs.quota);

  // Compute average current win rate from distributions
  const stages = Object.values((storedInputs.distributions?.stageWinRates ?? {}) as Record<string, { alpha: number; beta: number }>);
  const currentAvgWinRate = stages.length > 0
    ? stages.reduce((sum, d) => sum + (d.alpha / (d.alpha + d.beta)), 0) / stages.length
    : 0.2;

  return {
    currentWinRate: Math.round(currentAvgWinRate * 1000) / 10,
    hypotheticalWinRate: Math.round(currentAvgWinRate * hypotheticalWinRateMultiplier * 1000) / 10,
    currentP50,
    hypotheticalP50: result.p50,
    currentProbOfTarget,
    hypotheticalProbOfTarget: result.probOfHittingTarget,
    p50Delta: result.p50 - currentP50,
    probDelta: currentProbOfTarget !== null && result.probOfHittingTarget !== null
      ? Math.round((result.probOfHittingTarget - currentProbOfTarget) * 1000) / 10
      : null,
  };
}

// ─── 4. What-If Single Deal ───────────────────────────────────────────────────

export function queryWhatIfDeal(
  iterations: IterationRecord[],
  dealId: string,
  dealName: string,
  dealAmount: number,
  targetRevenue: number | null
): WhatIfDealResult {
  const sorted = sortedTotals(iterations);
  const baselineP50 = percentile(sorted, 0.5);
  const n = iterations.length;
  const baselineProb = targetRevenue !== null
    ? iterations.filter(r => r.total >= targetRevenue).length / n
    : null;

  // Force-win: for iterations where deal did NOT win, add dealAmount
  const adjusted = iterations.map(r =>
    r.dealsWon.includes(dealId) ? r.total : r.total + dealAmount
  ).sort((a, b) => a - b);

  const withDealP50 = percentile(adjusted, 0.5);
  const withDealProb = targetRevenue !== null
    ? adjusted.filter(v => v >= targetRevenue).length / n
    : null;

  return {
    dealId,
    dealName,
    dealAmount,
    baselineP50,
    withDealP50,
    baselineProb: baselineProb !== null ? Math.round(baselineProb * 1000) / 10 : null,
    withDealProb: withDealProb !== null ? Math.round(withDealProb * 1000) / 10 : null,
    p50Delta: withDealP50 - baselineP50,
  };
}

// ─── 5. Scenario Decomposition ────────────────────────────────────────────────

export function queryScenarioDecompose(
  iterations: IterationRecord[],
  threshold: ScenarioDecomposeResult['threshold'],
  targetRevenue: number | null
): ScenarioDecomposeResult {
  const sorted = sortedTotals(iterations);
  const n = iterations.length;

  let matching: IterationRecord[];
  if (threshold === 'top_quartile') {
    const cut = percentile(sorted, 0.75);
    matching = iterations.filter(r => r.total >= cut);
  } else if (threshold === 'bottom_quartile') {
    const cut = percentile(sorted, 0.25);
    matching = iterations.filter(r => r.total <= cut);
  } else if (threshold === 'above_target' && targetRevenue !== null) {
    matching = iterations.filter(r => r.total >= targetRevenue);
  } else if (threshold === 'below_target' && targetRevenue !== null) {
    matching = iterations.filter(r => r.total < targetRevenue);
  } else {
    matching = iterations.filter(r => r.total >= percentile(sorted, 0.75));
  }

  const m = matching.length;
  if (m === 0) {
    return {
      threshold,
      totalIterations: n,
      matchingIterations: 0,
      avgExistingRevenue: 0,
      avgProjectedRevenue: 0,
      avgNewDealsCreated: 0,
      topDeals: [],
      topReps: [],
      summary: 'No matching iterations found.',
    };
  }

  const avgExisting = matching.reduce((s, r) => s + r.existing, 0) / m;
  const avgProjected = matching.reduce((s, r) => s + r.projected, 0) / m;
  const avgNewDeals = matching.reduce((s, r) => s + r.newDealsCreated, 0) / m;

  // Top deals by appearance in matching set
  const dealCounts: Record<string, number> = {};
  for (const r of matching) r.dealsWon.forEach(id => { dealCounts[id] = (dealCounts[id] ?? 0) + 1; });
  const topDeals = Object.entries(dealCounts)
    .map(([dealId, count]) => ({ dealId, appearsInPct: Math.round((count / m) * 1000) / 10 }))
    .sort((a, b) => b.appearsInPct - a.appearsInPct)
    .slice(0, 5);

  // Top reps by average revenue in matching set
  const repRevenue: Record<string, number[]> = {};
  for (const r of matching) {
    for (const [rep, rev] of Object.entries(r.byRep)) {
      if (!repRevenue[rep]) repRevenue[rep] = [];
      repRevenue[rep].push(rev);
    }
  }
  const topReps = Object.entries(repRevenue)
    .map(([repEmail, revs]) => ({
      repEmail,
      avgRevenue: revs.reduce((s, v) => s + v, 0) / revs.length,
    }))
    .sort((a, b) => b.avgRevenue - a.avgRevenue)
    .slice(0, 5);

  // Contrast with non-matching for summary
  const nonMatching = iterations.filter(r => !matching.includes(r));
  const nonMatchingAvgNewDeals = nonMatching.length > 0
    ? nonMatching.reduce((s, r) => s + r.newDealsCreated, 0) / nonMatching.length
    : 0;

  const label = threshold === 'top_quartile' ? 'winning' : threshold === 'bottom_quartile' ? 'losing' : threshold.replace('_', '-');
  const summary = `${label.charAt(0).toUpperCase() + label.slice(1)} scenarios average ${avgNewDeals.toFixed(1)} new deals vs ${nonMatchingAvgNewDeals.toFixed(1)} in the rest. Existing pipeline contributes $${Math.round(avgExisting).toLocaleString()} and projected pipeline $${Math.round(avgProjected).toLocaleString()} on average.`;

  return {
    threshold,
    totalIterations: n,
    matchingIterations: m,
    avgExistingRevenue: Math.round(avgExisting),
    avgProjectedRevenue: Math.round(avgProjected),
    avgNewDealsCreated: Math.round(avgNewDeals * 10) / 10,
    topDeals,
    topReps,
    summary,
  };
}

// ─── 6. Component Sensitivity ─────────────────────────────────────────────────

export function queryComponentSensitivity(
  iterations: IterationRecord[],
  targetRevenue: number | null
): ComponentSensitivityResult {
  const n = iterations.length;
  const sorted = sortedTotals(iterations);
  const baselineP50 = percentile(sorted, 0.5);
  const baselineProb = targetRevenue !== null
    ? iterations.filter(r => r.total >= targetRevenue).length / n
    : null;

  // Zero out projected (Component B) revenue
  const existingOnly = iterations.map(r => r.existing).sort((a, b) => a - b);
  const existingOnlyP50 = percentile(existingOnly, 0.5);
  const existingOnlyProb = targetRevenue !== null
    ? existingOnly.filter(v => v >= targetRevenue).length / n
    : null;

  const projectedContributionPct = baselineP50 > 0
    ? Math.round(((baselineP50 - existingOnlyP50) / baselineP50) * 100)
    : 0;

  const fragility: 'high' | 'medium' | 'low' =
    projectedContributionPct > 50 ? 'high'
    : projectedContributionPct > 25 ? 'medium'
    : 'low';

  return {
    existingOnlyP50: Math.round(existingOnlyP50),
    existingOnlyProbOfTarget: existingOnlyProb !== null ? Math.round(existingOnlyProb * 1000) / 10 : null,
    baselineP50: Math.round(baselineP50),
    baselineProb: baselineProb !== null ? Math.round(baselineProb * 1000) / 10 : null,
    projectedContributionPct,
    fragility,
  };
}

// ─── 7. Rep Impact ────────────────────────────────────────────────────────────

export function queryRepImpact(
  iterations: IterationRecord[],
  repEmail: string,
  repName: string,
  targetRevenue: number | null
): RepImpactResult {
  const n = iterations.length;
  const sorted = sortedTotals(iterations);
  const baselineP50 = percentile(sorted, 0.5);

  const avgContribution = iterations.reduce((s, r) => s + (r.byRep[repEmail] ?? 0), 0) / n;

  // Remove rep's projected contribution from each iteration
  const withoutRep = iterations
    .map(r => r.total - (r.byRep[repEmail] ?? 0))
    .sort((a, b) => a - b);

  const withoutRepP50 = percentile(withoutRep, 0.5);
  const withoutRepProb = targetRevenue !== null
    ? withoutRep.filter(v => v >= targetRevenue).length / n
    : null;

  return {
    repEmail,
    repName,
    avgContributionToP50: Math.round(avgContribution),
    baselineP50: Math.round(baselineP50),
    withoutRepP50: Math.round(withoutRepP50),
    withoutRepProb: withoutRepProb !== null ? Math.round(withoutRepProb * 1000) / 10 : null,
    p50Delta: withoutRepP50 - baselineP50,
  };
}
