/**
 * Variance Driver Analysis (Tornado Chart)
 *
 * Runs 2,000-iteration mini-simulations with each key variable
 * perturbed ±1 standard deviation. Measures delta in P50.
 */

import type { SimulationInputs, PipelineType } from './monte-carlo-engine.js';
import { runSimulation } from './monte-carlo-engine.js';

export interface TornadoAssumption {
  label: string;
  value: string;
  low: string;
  high: string;
  unit: 'currency' | 'percent' | 'days' | 'count';
  implication: string;
  skew: 'upside_heavy' | 'downside_heavy' | 'balanced';
}

export interface VarianceDriver {
  variable: string;
  label: string;
  upsideImpact: number;
  downsideImpact: number;
  totalVariance: number;
  assumption: TornadoAssumption;
}

const SENSITIVITY_ITERATIONS = 2000;

function cloneInputs(inputs: SimulationInputs): SimulationInputs {
  return JSON.parse(JSON.stringify(inputs)) as SimulationInputs;
}

// ─── Tooltip helpers ──────────────────────────────────────────────────────────

function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function fmtPct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function computeSkew(upside: number, downside: number): TornadoAssumption['skew'] {
  const ratio = upside / Math.max(1, downside);
  if (ratio > 1.15) return 'upside_heavy';
  if (ratio < 0.85) return 'downside_heavy';
  return 'balanced';
}

function computeImplication(
  driver: string,
  upside: number,
  downside: number
): string {
  const skew = computeSkew(upside, downside);
  const templates: Record<string, Record<TornadoAssumption['skew'], string>> = {
    deal_size: {
      upside_heavy:   'Deal size has more room to grow than shrink — larger deals in late-stage pipeline may be pulling the upside up.',
      downside_heavy: 'Deal size risk is asymmetric — a few small deals closing instead of large ones would hurt P50 more than large deals would help.',
      balanced:       'Deal size variability affects the forecast roughly equally in both directions.',
    },
    pipeline_creation_rate: {
      upside_heavy:   'Pipeline creation has more upside than downside — your current rate already exceeds what the model needs.',
      downside_heavy: 'Pipeline creation is the highest-risk lever — a slowdown hurts forecast more than an acceleration helps.',
      balanced:       'Pipeline creation rate is your second-largest variance driver — maintain current prospecting pace.',
    },
    win_rate: {
      upside_heavy:   'Win rate has room to improve — historical variance shows upside scenarios are reachable.',
      downside_heavy: 'Win rate is near the high end of its modeled range — more room to fall than to rise. This is a risk concentration.',
      balanced:       'Win rate variability is balanced — focus on deal quality over velocity.',
    },
    close_date_slippage: {
      upside_heavy:   'Slippage impact is modest — deals are closing relatively close to their stated dates.',
      downside_heavy: 'Close date slippage is asymmetric — deals running late hurt P50 more than early closes help.',
      balanced:       'Slippage has a small but consistent drag on the forecast.',
    },
    cycle_length: {
      upside_heavy:   'Cycle length variability is limited — deal velocity is relatively predictable.',
      downside_heavy: 'Long sales cycles are compressing the effective forecast window.',
      balanced:       'Sales cycle length has minimal impact on this forecast window.',
    },
    renewal_count: {
      upside_heavy:   'More renewals would meaningfully lift the forecast — retention quality is the key lever.',
      downside_heavy: 'Renewal count risk dominates — losing even a few accounts has outsized downside.',
      balanced:       'Renewal count variability is balanced across the account base.',
    },
    expansion_rate: {
      upside_heavy:   'Expansion rate has meaningful upside — accounts with room to grow are driving variability.',
      downside_heavy: 'Expansion rate risk is concentrated — flat or shrinking accounts could significantly miss forecast.',
      balanced:       'Expansion rate variability is balanced across the customer base.',
    },
    customer_base_arr: {
      upside_heavy:   'Customer base ARR variance skews positive — account health is strong.',
      downside_heavy: 'Customer base ARR is at risk — contraction in existing accounts would hurt forecast more than growth would help.',
      balanced:       'Customer base ARR variance is balanced in both directions.',
    },
  };
  return templates[driver]?.[skew] ?? 'This driver affects forecast variance in both directions.';
}

export function computeVarianceDrivers(
  baseInputs: SimulationInputs,
  baseP50: number,
  pipelineType?: PipelineType
): VarianceDriver[] {
  const drivers: VarianceDriver[] = [];
  const miniInputs = { ...baseInputs, iterations: SENSITIVITY_ITERATIONS };
  const pt = pipelineType ?? 'new_business';

  // ── Win Rate ────────────────────────────────────────────────────────────────
  {
    const upInputs = cloneInputs(miniInputs);
    const downInputs = cloneInputs(miniInputs);
    for (const stage of Object.keys(upInputs.distributions.stageWinRates)) {
      const d = upInputs.distributions.stageWinRates[stage];
      upInputs.distributions.stageWinRates[stage] = { ...d, alpha: d.alpha * 1.20 };
      const dd = downInputs.distributions.stageWinRates[stage];
      downInputs.distributions.stageWinRates[stage] = { ...dd, alpha: Math.max(1.1, dd.alpha * 0.80) };
    }
    const upP50 = runSimulation(upInputs, null).p50;
    const downP50 = runSimulation(downInputs, null).p50;
    const upsideImpact = Math.max(0, upP50 - baseP50);
    const downsideImpact = Math.max(0, baseP50 - downP50);

    // Compute win rate P50/P10/P90 from Beta distributions (weighted average across stages)
    const stages = Object.values(baseInputs.distributions.stageWinRates);
    const entryStage = stages.length > 0
      ? stages.reduce((min, s) => ((s.alpha + s.beta) < (min.alpha + min.beta)) ? s : min)
      : { alpha: 2, beta: 8 };
    const wrP50 = entryStage.alpha / (entryStage.alpha + entryStage.beta);
    const wrVariance = (entryStage.alpha * entryStage.beta) /
      (Math.pow(entryStage.alpha + entryStage.beta, 2) * (entryStage.alpha + entryStage.beta + 1));
    const wrSd = Math.sqrt(wrVariance);
    const wrP10 = Math.max(0.01, wrP50 - 1.28 * wrSd);
    const wrP90 = Math.min(0.99, wrP50 + 1.28 * wrSd);

    drivers.push({
      variable: 'win_rate',
      label: 'Win Rate',
      upsideImpact,
      downsideImpact,
      totalVariance: Math.abs(upP50 - baseP50) + Math.abs(downP50 - baseP50),
      assumption: {
        label: 'Win rate (Beta distribution fitted per stage, weighted average)',
        value: fmtPct(wrP50),
        low: fmtPct(wrP10),
        high: fmtPct(wrP90),
        unit: 'percent',
        skew: computeSkew(upsideImpact, downsideImpact),
        implication: computeImplication('win_rate', upsideImpact, downsideImpact),
      },
    });
  }

  // ── Deal Size ────────────────────────────────────────────────────────────────
  {
    const upInputs = cloneInputs(miniInputs);
    const downInputs = cloneInputs(miniInputs);
    upInputs.distributions.dealSize = { ...upInputs.distributions.dealSize, mu: upInputs.distributions.dealSize.mu + 0.2 };
    downInputs.distributions.dealSize = { ...downInputs.distributions.dealSize, mu: downInputs.distributions.dealSize.mu - 0.2 };
    const upP50 = runSimulation(upInputs, null).p50;
    const downP50 = runSimulation(downInputs, null).p50;
    const upsideImpact = Math.max(0, upP50 - baseP50);
    const downsideImpact = Math.max(0, baseP50 - downP50);

    const dsP50 = Math.exp(baseInputs.distributions.dealSize.mu);
    const dsLow = dsP50 * 0.6;
    const dsHigh = dsP50 * 1.67;

    drivers.push({
      variable: 'deal_size',
      label: 'Deal Size',
      upsideImpact,
      downsideImpact,
      totalVariance: Math.abs(upP50 - baseP50) + Math.abs(downP50 - baseP50),
      assumption: {
        label: 'Median deal size (log-normal distribution fitted to closed-won deals)',
        value: fmt$(dsP50),
        low: fmt$(dsLow),
        high: fmt$(dsHigh),
        unit: 'currency',
        skew: computeSkew(upsideImpact, downsideImpact),
        implication: computeImplication('deal_size', upsideImpact, downsideImpact),
      },
    });
  }

  // ── Sales Cycle Length ────────────────────────────────────────────────────────
  if (pt !== 'renewal') {
    const upInputs = cloneInputs(miniInputs);
    const downInputs = cloneInputs(miniInputs);
    upInputs.distributions.cycleLength = { ...upInputs.distributions.cycleLength, mu: upInputs.distributions.cycleLength.mu - 0.2 };
    downInputs.distributions.cycleLength = { ...downInputs.distributions.cycleLength, mu: downInputs.distributions.cycleLength.mu + 0.2 };
    const upP50 = runSimulation(upInputs, null).p50;
    const downP50 = runSimulation(downInputs, null).p50;
    const upsideImpact = Math.max(0, upP50 - baseP50);
    const downsideImpact = Math.max(0, baseP50 - downP50);

    const clMu = baseInputs.distributions.cycleLength.mu;
    const clSigma = baseInputs.distributions.cycleLength.sigma;
    const clP50 = Math.round(Math.exp(clMu));
    const clP10 = Math.round(Math.exp(clMu - 1.28 * clSigma));
    const clP90 = Math.round(Math.exp(clMu + 1.28 * clSigma));

    drivers.push({
      variable: 'cycle_length',
      label: 'Sales Cycle Length',
      upsideImpact,
      downsideImpact,
      totalVariance: Math.abs(upP50 - baseP50) + Math.abs(downP50 - baseP50),
      assumption: {
        label: 'Days from deal creation to close (log-normal, fitted to closed deals)',
        value: `${clP50} days`,
        low: `${clP10} days`,
        high: `${clP90} days`,
        unit: 'days',
        skew: computeSkew(upsideImpact, downsideImpact),
        implication: computeImplication('cycle_length', upsideImpact, downsideImpact),
      },
    });
  }

  // ── Close Date Slippage ───────────────────────────────────────────────────────
  if (pt !== 'expansion') {
    const upInputs = cloneInputs(miniInputs);
    const downInputs = cloneInputs(miniInputs);
    for (const stage of Object.keys(upInputs.distributions.slippage)) {
      upInputs.distributions.slippage[stage] = { ...upInputs.distributions.slippage[stage], mean: upInputs.distributions.slippage[stage].mean - 7 };
      downInputs.distributions.slippage[stage] = { ...downInputs.distributions.slippage[stage], mean: downInputs.distributions.slippage[stage].mean + 7 };
    }
    const upP50 = runSimulation(upInputs, null).p50;
    const downP50 = runSimulation(downInputs, null).p50;
    const upsideImpact = Math.max(0, upP50 - baseP50);
    const downsideImpact = Math.max(0, baseP50 - downP50);

    const slippageValues = Object.values(baseInputs.distributions.slippage);
    const slippageMean = slippageValues.length > 0
      ? slippageValues.reduce((s, d) => s + d.mean, 0) / slippageValues.length
      : 14;
    const slippageSigma = slippageValues.length > 0
      ? slippageValues.reduce((s, d) => s + d.sigma, 0) / slippageValues.length
      : 10;
    const slipP50 = Math.round(slippageMean);
    const slipP10 = Math.round(Math.max(0, slippageMean - 1.28 * slippageSigma));
    const slipP90 = Math.round(slippageMean + 1.28 * slippageSigma);

    drivers.push({
      variable: 'close_date_slippage',
      label: 'Close Date Slippage',
      upsideImpact,
      downsideImpact,
      totalVariance: Math.abs(upP50 - baseP50) + Math.abs(downP50 - baseP50),
      assumption: {
        label: 'Expected slippage beyond stated close date (Weibull distribution)',
        value: `${slipP50} days average`,
        low: `${slipP10} days`,
        high: `${slipP90} days`,
        unit: 'days',
        skew: computeSkew(upsideImpact, downsideImpact),
        implication: computeImplication('close_date_slippage', upsideImpact, downsideImpact),
      },
    });
  }

  // ── Pipeline Creation Rate ────────────────────────────────────────────────────
  if (pt === 'new_business') {
    const upInputs = cloneInputs(miniInputs);
    const downInputs = cloneInputs(miniInputs);
    for (const rep of Object.keys(upInputs.distributions.pipelineRates)) {
      upInputs.distributions.pipelineRates[rep] = { ...upInputs.distributions.pipelineRates[rep], mean: upInputs.distributions.pipelineRates[rep].mean * 1.20 };
      downInputs.distributions.pipelineRates[rep] = { ...downInputs.distributions.pipelineRates[rep], mean: downInputs.distributions.pipelineRates[rep].mean * 0.80 };
    }
    const upP50 = runSimulation(upInputs, null).p50;
    const downP50 = runSimulation(downInputs, null).p50;
    const upsideImpact = Math.max(0, upP50 - baseP50);
    const downsideImpact = Math.max(0, baseP50 - downP50);

    // Current creation rate = sum of per-rep monthly deal rate × median deal size
    const dealSizeP50 = Math.exp(baseInputs.distributions.dealSize.mu);
    const repRates = Object.values(baseInputs.distributions.pipelineRates);
    const totalDealsPerMonth = repRates.reduce((s, r) => s + r.mean, 0);
    const currentCreationRate = totalDealsPerMonth * dealSizeP50;

    drivers.push({
      variable: 'pipeline_creation_rate',
      label: 'Pipeline Creation Rate',
      upsideImpact,
      downsideImpact,
      totalVariance: Math.abs(upP50 - baseP50) + Math.abs(downP50 - baseP50),
      assumption: {
        label: 'Monthly pipeline creation rate (deals × avg size, last 90 days)',
        value: `${fmt$(currentCreationRate)}/mo`,
        low: `${fmt$(currentCreationRate * 0.5)}/mo`,
        high: `${fmt$(currentCreationRate * 1.5)}/mo`,
        unit: 'currency',
        skew: computeSkew(upsideImpact, downsideImpact),
        implication: computeImplication('pipeline_creation_rate', upsideImpact, downsideImpact),
      },
    });
  }

  // ── Renewal Count ─────────────────────────────────────────────────────────────
  if (pt === 'renewal') {
    const upInputs = cloneInputs(miniInputs);
    const downInputs = cloneInputs(miniInputs);
    const renewals = upInputs.upcomingRenewals ?? [];
    const extraCount = Math.max(1, Math.round(renewals.length * 0.2));
    for (let i = 0; i < extraCount && renewals.length > 0; i++) {
      upInputs.upcomingRenewals!.push({ ...renewals[i % renewals.length] });
    }
    const downRenewals = downInputs.upcomingRenewals ?? [];
    const removeCount = Math.max(1, Math.round(downRenewals.length * 0.2));
    downInputs.upcomingRenewals = downRenewals.slice(0, Math.max(0, downRenewals.length - removeCount));
    const upP50 = runSimulation(upInputs, null).p50;
    const downP50 = runSimulation(downInputs, null).p50;
    const upsideImpact = Math.max(0, upP50 - baseP50);
    const downsideImpact = Math.max(0, baseP50 - downP50);
    const renewalCount = (baseInputs.upcomingRenewals ?? []).length;

    drivers.push({
      variable: 'renewal_count',
      label: 'Renewal Count',
      upsideImpact,
      downsideImpact,
      totalVariance: Math.abs(upP50 - baseP50) + Math.abs(downP50 - baseP50),
      assumption: {
        label: 'Upcoming renewals in forecast window',
        value: `${renewalCount} accounts`,
        low: `${Math.max(0, renewalCount - removeCount)} accounts`,
        high: `${renewalCount + extraCount} accounts`,
        unit: 'count',
        skew: computeSkew(upsideImpact, downsideImpact),
        implication: computeImplication('renewal_count', upsideImpact, downsideImpact),
      },
    });
  }

  // ── Expansion Rate / Customer Base ARR ────────────────────────────────────────
  if (pt === 'expansion') {
    {
      const upInputs = cloneInputs(miniInputs);
      const downInputs = cloneInputs(miniInputs);
      const sigma = upInputs.expansionRate?.sigma ?? 0.08;
      const baseMean = upInputs.expansionRate?.mean ?? 0.15;
      upInputs.expansionRate = { mean: baseMean + sigma, sigma };
      downInputs.expansionRate = { mean: Math.max(0, baseMean - sigma), sigma };
      const upP50 = runSimulation(upInputs, null).p50;
      const downP50 = runSimulation(downInputs, null).p50;
      const upsideImpact = Math.max(0, upP50 - baseP50);
      const downsideImpact = Math.max(0, baseP50 - downP50);

      drivers.push({
        variable: 'expansion_rate',
        label: 'Expansion Rate',
        upsideImpact,
        downsideImpact,
        totalVariance: Math.abs(upP50 - baseP50) + Math.abs(downP50 - baseP50),
        assumption: {
          label: 'Net expansion rate across customer base',
          value: fmtPct(baseMean),
          low: fmtPct(Math.max(0, baseMean - sigma)),
          high: fmtPct(baseMean + sigma),
          unit: 'percent',
          skew: computeSkew(upsideImpact, downsideImpact),
          implication: computeImplication('expansion_rate', upsideImpact, downsideImpact),
        },
      });
    }
    {
      const upInputs = cloneInputs(miniInputs);
      const downInputs = cloneInputs(miniInputs);
      const baseARR = baseInputs.customerBaseARR ?? 0;
      upInputs.customerBaseARR = baseARR * 1.20;
      downInputs.customerBaseARR = baseARR * 0.80;
      const upP50 = runSimulation(upInputs, null).p50;
      const downP50 = runSimulation(downInputs, null).p50;
      const upsideImpact = Math.max(0, upP50 - baseP50);
      const downsideImpact = Math.max(0, baseP50 - downP50);

      drivers.push({
        variable: 'customer_base_arr',
        label: 'Customer Base ARR',
        upsideImpact,
        downsideImpact,
        totalVariance: Math.abs(upP50 - baseP50) + Math.abs(downP50 - baseP50),
        assumption: {
          label: 'Current ARR across active customer base',
          value: fmt$(baseARR),
          low: fmt$(baseARR * 0.80),
          high: fmt$(baseARR * 1.20),
          unit: 'currency',
          skew: computeSkew(upsideImpact, downsideImpact),
          implication: computeImplication('customer_base_arr', upsideImpact, downsideImpact),
        },
      });
    }
  }

  return drivers.sort((a, b) => b.totalVariance - a.totalVariance).slice(0, 5);
}
