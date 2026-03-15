/**
 * Monte Carlo All-Else-Equal Analysis
 *
 * Isolates the P50 impact of each individual deal and each individual lever.
 * Sibling to computeVarianceDrivers — but deal-specific rather than system-wide.
 *
 * Also computes portfolio composition (swing variable) and the ranked action menu.
 */

import type { SimulationInputs, SimulationOutputs, OpenDeal } from './monte-carlo-engine.js';
import { runSimulation } from './monte-carlo-engine.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DealSensitivity {
  dealId: string;
  dealName: string;
  dealAmount: number;
  dealStage: string;
  ownerEmail: string | null;
  ownerName: string | null;

  p50IfCloses: number;
  p50IfLost: number;
  p50Impact: number;

  currentCloseProbability: number;
  expectedValue: number;

  quotaGapContribution: number | null;

  riskFlags: string[];
}

export interface LeverSensitivity {
  lever: string;
  label: string;
  p50IfImproved10Pct: number;
  p50Impact10Pct: number;
  p50IfWorsened10Pct: number;
  p50DownsideRisk10Pct: number;
  isHighLeverage: boolean;
  actionableBy: 'sales' | 'marketing' | 'ops' | 'leadership';
}

export interface ActionMenuItem {
  rank: number;
  actionType: 'close_deal' | 're_engage_deal' | 'improve_lever' | 'generate_pipeline';
  label: string;
  expectedValueIfDone: number;
  effort: 'immediate' | 'this_week' | 'this_month';
  dealId?: string;
  lever?: string;
  rationale: string;
}

export interface PortfolioComposition {
  swingVariable: string;
  swingLabel: string;
  swingDescription: string;
  segments: {
    label: string;
    dealCount: number;
    totalValue: number;
    expectedCloses: number;
    expectedARR: number;
    pctOfQuota: number | null;
    isSwingSegment: boolean;
  }[];
  requiredClosesForQuota: {
    segment: string;
    currentExpected: number;
    requiredForQuota: number;
    gap: number;
    probability: number;
  }[];
}

export interface AllElseEqualOutput {
  baseP50: number;
  quota: number | null;
  dealSensitivities: DealSensitivity[];
  leverSensitivities: LeverSensitivity[];
  actionMenu: ActionMenuItem[];
  portfolioComposition: PortfolioComposition;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

const MINI_ITERATIONS = 2000;

// ─── Lever Perturbation ───────────────────────────────────────────────────────

function applyLeverShift(inputs: SimulationInputs, lever: string, pctShift: number): void {
  switch (lever) {
    case 'win_rate':
      if (inputs.distributions.survivalCurve) {
        inputs.distributions.survivalCurve = {
          ...inputs.distributions.survivalCurve,
          terminalWinRate: Math.min(0.99, Math.max(0.01,
            (inputs.distributions.survivalCurve.terminalWinRate ?? 0.25) * (1 + pctShift)
          )),
        };
      }
      break;
    case 'deal_size':
      inputs.distributions.dealSize.mu += pctShift * 0.5;
      break;
    case 'pipeline_generation':
      for (const key of Object.keys(inputs.distributions.pipelineRates)) {
        inputs.distributions.pipelineRates[key].mean *= (1 + pctShift);
      }
      break;
    case 'cycle_length':
      inputs.distributions.cycleLength.mu += (-pctShift) * 0.3;
      break;
    case 'slippage':
      for (const key of Object.keys(inputs.distributions.slippage)) {
        inputs.distributions.slippage[key].mean *= (1 + pctShift);
      }
      break;
  }
}

// ─── Portfolio Composition ────────────────────────────────────────────────────

export function computePortfolioComposition(
  openDeals: OpenDeal[],
  dealSensitivities: DealSensitivity[],
  inputs: SimulationInputs,
  baseP50: number,
  quota: number | null
): PortfolioComposition {
  if (openDeals.length === 0) {
    return {
      swingVariable: 'conversion_rate',
      swingLabel: 'Your pipeline conversion rate',
      swingDescription: 'The quarter is determined by pipeline conversion — you need to convert at or above your historical rate.',
      segments: [],
      requiredClosesForQuota: [],
    };
  }

  const sortedByAmount = [...openDeals].sort((a, b) => b.amount - a.amount);
  const totalPipeline = openDeals.reduce((s, d) => s + d.amount, 0);

  let largeThreshold = 0;
  let runningTotal = 0;
  for (const deal of sortedByAmount) {
    runningTotal += deal.amount;
    if (runningTotal >= totalPipeline * 0.6) {
      largeThreshold = deal.amount;
      break;
    }
  }

  if (largeThreshold === 0) {
    const amounts = openDeals.map(d => d.amount).sort((a, b) => a - b);
    largeThreshold = amounts[Math.floor(amounts.length * 0.75)] ?? 0;
  }

  const largeDeals = openDeals.filter(d => d.amount >= largeThreshold);
  const midDeals = openDeals.filter(d => d.amount < largeThreshold);

  const terminalWinRate = inputs.distributions.survivalCurve?.terminalWinRate ?? 0.25;

  const largeWinRate = average(
    largeDeals.map(d => {
      const stageWinRates = (inputs.distributions as any).stageWinRates;
      return stageWinRates?.[d.stageNormalized]?.mean ?? terminalWinRate;
    })
  ) || terminalWinRate;

  const midWinRate = average(
    midDeals.map(d => {
      const stageWinRates = (inputs.distributions as any).stageWinRates;
      return stageWinRates?.[d.stageNormalized]?.mean ?? terminalWinRate;
    })
  ) || terminalWinRate;

  const largeExpectedARR = largeDeals.reduce((s, d) => s + d.amount * largeWinRate, 0);
  const midExpectedARR = midDeals.reduce((s, d) => s + d.amount * midWinRate, 0);

  const largeVarianceContribution = dealSensitivities
    .filter(d => d.dealAmount >= largeThreshold)
    .reduce((s, d) => s + Math.abs(d.p50Impact), 0);

  const totalVariance = dealSensitivities.reduce((s, d) => s + Math.abs(d.p50Impact), 0);
  const largeIsSwing = totalVariance > 0
    ? largeVarianceContribution / totalVariance > 0.50
    : largeDeals.length > 0;

  const requiredClosesForQuota: PortfolioComposition['requiredClosesForQuota'] = [];
  if (quota && largeIsSwing && largeDeals.length > 0) {
    const quotaGap = Math.max(0, quota - midExpectedARR);
    const avgLargeDealSize = average(largeDeals.map(d => d.amount));
    const requiredLargeCloses = avgLargeDealSize > 0 ? quotaGap / avgLargeDealSize : 0;
    const expectedLargeCloses = largeDeals.length * largeWinRate;

    requiredClosesForQuota.push({
      segment: 'large_deals',
      currentExpected: Math.round(expectedLargeCloses * 10) / 10,
      requiredForQuota: Math.round(requiredLargeCloses * 10) / 10,
      gap: Math.round((requiredLargeCloses - expectedLargeCloses) * 10) / 10,
      probability: expectedLargeCloses >= requiredLargeCloses ? 0.52 : 0.34,
    });
  }

  const swingLabel = largeIsSwing
    ? `Your ${largeDeals.length} large deals (>${fmt$(largeThreshold)})`
    : 'Your pipeline conversion rate';

  const swingDescription = largeIsSwing
    ? `The quarter is determined by your large deal cohort — ${largeDeals.length} opportunities totaling ${fmt$(largeDeals.reduce((s, d) => s + d.amount, 0))}.`
    : `The quarter is determined by pipeline conversion — you need to convert at or above your historical rate.`;

  return {
    swingVariable: largeIsSwing ? 'large_deal_cohort' : 'conversion_rate',
    swingLabel,
    swingDescription,
    segments: [
      {
        label: `Large deals (>${fmt$(largeThreshold)})`,
        dealCount: largeDeals.length,
        totalValue: largeDeals.reduce((s, d) => s + d.amount, 0),
        expectedCloses: largeDeals.length * largeWinRate,
        expectedARR: largeExpectedARR,
        pctOfQuota: quota ? (largeExpectedARR / quota) * 100 : null,
        isSwingSegment: largeIsSwing,
      },
      {
        label: `Mid-market (<${fmt$(largeThreshold)})`,
        dealCount: midDeals.length,
        totalValue: midDeals.reduce((s, d) => s + d.amount, 0),
        expectedCloses: midDeals.length * midWinRate,
        expectedARR: midExpectedARR,
        pctOfQuota: quota ? (midExpectedARR / quota) * 100 : null,
        isSwingSegment: !largeIsSwing,
      },
    ],
    requiredClosesForQuota,
  };
}

// ─── Main Computation ─────────────────────────────────────────────────────────

export function computeAllElseEqual(
  inputs: SimulationInputs,
  baseSimulation: SimulationOutputs,
  quota: number | null,
  openDeals: OpenDeal[],
  riskSignals: Record<string, string[]>
): AllElseEqualOutput {
  const baseP50 = baseSimulation.p50;

  // ── DEAL SENSITIVITIES ──────────────────────────────────────────────────────
  const dealSensitivities: DealSensitivity[] = [];

  for (const deal of openDeals) {
    // Simulation A: force deal to close (multiplier >> 1.0 forces Bernoulli win)
    const inputsForceClose = deepClone(inputs);
    inputsForceClose.iterations = MINI_ITERATIONS;
    inputsForceClose.riskAdjustments[deal.id] = { dealId: deal.id, multiplier: 999, signals: [] };
    const simClose = runSimulation(inputsForceClose, quota);

    // Simulation B: remove deal (force loss)
    const inputsForceLose = deepClone(inputs);
    inputsForceLose.iterations = MINI_ITERATIONS;
    inputsForceLose.openDeals = inputsForceLose.openDeals.filter((d: any) => d.id !== deal.id);
    const simLose = runSimulation(inputsForceLose, quota);

    const stageWinRates = (inputs.distributions as any).stageWinRates;
    const stageWinRate = stageWinRates?.[deal.stageNormalized]?.mean
      ?? inputs.distributions.survivalCurve?.terminalWinRate
      ?? 0.25;
    const riskMultiplier = inputs.riskAdjustments[deal.id]?.multiplier ?? 1.0;
    const closeProbability = Math.min(0.95, Math.max(0.05, stageWinRate * riskMultiplier));

    dealSensitivities.push({
      dealId: deal.id,
      dealName: deal.name,
      dealAmount: deal.amount,
      dealStage: deal.stageNormalized,
      ownerEmail: deal.ownerEmail,
      ownerName: deal.ownerEmail,
      p50IfCloses: simClose.p50,
      p50IfLost: simLose.p50,
      p50Impact: simClose.p50 - simLose.p50,
      currentCloseProbability: closeProbability,
      expectedValue: deal.amount * closeProbability,
      quotaGapContribution: quota && (quota - baseP50) !== 0
        ? ((simClose.p50 - simLose.p50) / Math.abs(quota - baseP50)) * 100
        : null,
      riskFlags: riskSignals[deal.id] ?? [],
    });
  }

  dealSensitivities.sort((a, b) => b.p50Impact - a.p50Impact);

  // ── LEVER SENSITIVITIES ─────────────────────────────────────────────────────
  const levers: { key: string; label: string; actionableBy: LeverSensitivity['actionableBy'] }[] = [
    { key: 'win_rate', label: 'Win rate', actionableBy: 'sales' },
    { key: 'deal_size', label: 'Average deal size', actionableBy: 'sales' },
    { key: 'pipeline_generation', label: 'Pipeline generation rate', actionableBy: 'marketing' },
    { key: 'cycle_length', label: 'Sales cycle length', actionableBy: 'ops' },
    { key: 'slippage', label: 'Close date slippage', actionableBy: 'sales' },
  ];

  const leverSensitivities: LeverSensitivity[] = [];

  for (const lever of levers) {
    const inputsImproved = deepClone(inputs);
    inputsImproved.iterations = MINI_ITERATIONS;
    applyLeverShift(inputsImproved, lever.key, +0.10);
    const simImproved = runSimulation(inputsImproved, quota);

    const inputsWorsened = deepClone(inputs);
    inputsWorsened.iterations = MINI_ITERATIONS;
    applyLeverShift(inputsWorsened, lever.key, -0.10);
    const simWorsened = runSimulation(inputsWorsened, quota);

    const impact = simImproved.p50 - baseP50;
    const downside = baseP50 - simWorsened.p50;

    leverSensitivities.push({
      lever: lever.key,
      label: lever.label,
      p50IfImproved10Pct: simImproved.p50,
      p50Impact10Pct: impact,
      p50IfWorsened10Pct: simWorsened.p50,
      p50DownsideRisk10Pct: downside,
      isHighLeverage: quota ? Math.abs(impact) > quota * 0.05 : impact > baseP50 * 0.05,
      actionableBy: lever.actionableBy,
    });
  }

  leverSensitivities.sort((a, b) => Math.abs(b.p50Impact10Pct) - Math.abs(a.p50Impact10Pct));

  // ── ACTION MENU ─────────────────────────────────────────────────────────────
  const actionMenu: ActionMenuItem[] = [];

  const atRiskHighValue = dealSensitivities
    .slice(0, 10)
    .filter(d => d.riskFlags.length > 0 || d.currentCloseProbability < 0.35)
    .slice(0, 3);

  for (const deal of atRiskHighValue) {
    actionMenu.push({
      rank: 0,
      actionType: 're_engage_deal',
      label: `Re-engage ${deal.dealName}`,
      expectedValueIfDone: deal.p50Impact * 0.3,
      effort: 'this_week',
      dealId: deal.dealId,
      rationale: `${fmt$(deal.p50Impact)} swing deal with ${deal.riskFlags[0] ?? 'low close probability'}`,
    });
  }

  if (dealSensitivities.length > 0) {
    const topDeal = dealSensitivities[0];
    if (!atRiskHighValue.find(d => d.dealId === topDeal.dealId)) {
      actionMenu.push({
        rank: 0,
        actionType: 'close_deal',
        label: `Advance ${topDeal.dealName} to next stage`,
        expectedValueIfDone: topDeal.p50Impact * 0.15,
        effort: 'this_week',
        dealId: topDeal.dealId,
        rationale: `Highest P50 impact deal — ${fmt$(topDeal.p50Impact)} swing`,
      });
    }
  }

  const topLever = leverSensitivities[0];
  if (topLever && topLever.isHighLeverage) {
    actionMenu.push({
      rank: 0,
      actionType: 'improve_lever',
      label: `Focus on ${topLever.label.toLowerCase()} improvement`,
      expectedValueIfDone: topLever.p50Impact10Pct,
      effort: 'this_month',
      lever: topLever.lever,
      rationale: `10% improvement = +${fmt$(topLever.p50Impact10Pct)} to P50`,
    });
  }

  const coverageRatio = quota && quota > 0
    ? baseSimulation.existingPipelineP50 / quota
    : 0;
  if (quota && coverageRatio < 2.5) {
    const coverageGap = quota * 2.5 - baseSimulation.existingPipelineP50;
    actionMenu.push({
      rank: 0,
      actionType: 'generate_pipeline',
      label: `Generate ${fmt$(coverageGap)} in new pipeline`,
      expectedValueIfDone: coverageGap * 0.31,
      effort: 'this_month',
      rationale: `Pipeline coverage is ${coverageRatio.toFixed(1)}x — below 2.5x target`,
    });
  }

  actionMenu.sort((a, b) => b.expectedValueIfDone - a.expectedValueIfDone);
  actionMenu.forEach((item, i) => { item.rank = i + 1; });

  // ── PORTFOLIO COMPOSITION ───────────────────────────────────────────────────
  const portfolioComposition = computePortfolioComposition(
    openDeals,
    dealSensitivities,
    inputs,
    baseP50,
    quota
  );

  return {
    baseP50,
    quota,
    dealSensitivities: dealSensitivities.slice(0, 10),
    leverSensitivities,
    actionMenu,
    portfolioComposition,
  };
}
