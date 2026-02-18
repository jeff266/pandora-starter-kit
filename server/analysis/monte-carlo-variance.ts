/**
 * Variance Driver Analysis (Tornado Chart)
 *
 * Runs 2,000-iteration mini-simulations with each key variable
 * perturbed ±1 standard deviation. Measures delta in P50.
 */

import type { SimulationInputs, PipelineType } from './monte-carlo-engine.js';
import { runSimulation } from './monte-carlo-engine.js';

export interface VarianceDriver {
  variable: string;
  label: string;
  upsideImpact: number;
  downsideImpact: number;
  totalVariance: number;
}

const SENSITIVITY_ITERATIONS = 2000;

function cloneInputs(inputs: SimulationInputs): SimulationInputs {
  return JSON.parse(JSON.stringify(inputs)) as SimulationInputs;
}

export function computeVarianceDrivers(
  baseInputs: SimulationInputs,
  baseP50: number,
  pipelineType?: PipelineType
): VarianceDriver[] {
  const drivers: VarianceDriver[] = [];
  const miniInputs = { ...baseInputs, iterations: SENSITIVITY_ITERATIONS };
  const pt = pipelineType ?? 'new_business';

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
    drivers.push({
      variable: 'win_rate',
      label: 'Win Rate',
      upsideImpact: Math.max(0, upP50 - baseP50),
      downsideImpact: Math.max(0, baseP50 - downP50),
      totalVariance: Math.abs(upP50 - baseP50) + Math.abs(downP50 - baseP50),
    });
  }

  {
    const upInputs = cloneInputs(miniInputs);
    const downInputs = cloneInputs(miniInputs);
    upInputs.distributions.dealSize = { ...upInputs.distributions.dealSize, mu: upInputs.distributions.dealSize.mu + 0.2 };
    downInputs.distributions.dealSize = { ...downInputs.distributions.dealSize, mu: downInputs.distributions.dealSize.mu - 0.2 };
    const upP50 = runSimulation(upInputs, null).p50;
    const downP50 = runSimulation(downInputs, null).p50;
    drivers.push({
      variable: 'deal_size',
      label: 'Deal Size',
      upsideImpact: Math.max(0, upP50 - baseP50),
      downsideImpact: Math.max(0, baseP50 - downP50),
      totalVariance: Math.abs(upP50 - baseP50) + Math.abs(downP50 - baseP50),
    });
  }

  if (pt !== 'renewal') {
    const upInputs = cloneInputs(miniInputs);
    const downInputs = cloneInputs(miniInputs);
    upInputs.distributions.cycleLength = { ...upInputs.distributions.cycleLength, mu: upInputs.distributions.cycleLength.mu - 0.2 };
    downInputs.distributions.cycleLength = { ...downInputs.distributions.cycleLength, mu: downInputs.distributions.cycleLength.mu + 0.2 };
    const upP50 = runSimulation(upInputs, null).p50;
    const downP50 = runSimulation(downInputs, null).p50;
    drivers.push({
      variable: 'cycle_length',
      label: 'Sales Cycle Length',
      upsideImpact: Math.max(0, upP50 - baseP50),
      downsideImpact: Math.max(0, baseP50 - downP50),
      totalVariance: Math.abs(upP50 - baseP50) + Math.abs(downP50 - baseP50),
    });
  }

  if (pt !== 'expansion') {
    const upInputs = cloneInputs(miniInputs);
    const downInputs = cloneInputs(miniInputs);
    for (const stage of Object.keys(upInputs.distributions.slippage)) {
      upInputs.distributions.slippage[stage] = { ...upInputs.distributions.slippage[stage], mean: upInputs.distributions.slippage[stage].mean - 7 };
      downInputs.distributions.slippage[stage] = { ...downInputs.distributions.slippage[stage], mean: downInputs.distributions.slippage[stage].mean + 7 };
    }
    const upP50 = runSimulation(upInputs, null).p50;
    const downP50 = runSimulation(downInputs, null).p50;
    drivers.push({
      variable: 'close_date_slippage',
      label: 'Close Date Slippage',
      upsideImpact: Math.max(0, upP50 - baseP50),
      downsideImpact: Math.max(0, baseP50 - downP50),
      totalVariance: Math.abs(upP50 - baseP50) + Math.abs(downP50 - baseP50),
    });
  }

  if (pt === 'new_business') {
    const upInputs = cloneInputs(miniInputs);
    const downInputs = cloneInputs(miniInputs);
    for (const rep of Object.keys(upInputs.distributions.pipelineRates)) {
      upInputs.distributions.pipelineRates[rep] = { ...upInputs.distributions.pipelineRates[rep], mean: upInputs.distributions.pipelineRates[rep].mean * 1.20 };
      downInputs.distributions.pipelineRates[rep] = { ...downInputs.distributions.pipelineRates[rep], mean: downInputs.distributions.pipelineRates[rep].mean * 0.80 };
    }
    const upP50 = runSimulation(upInputs, null).p50;
    const downP50 = runSimulation(downInputs, null).p50;
    drivers.push({
      variable: 'pipeline_creation_rate',
      label: 'Pipeline Creation Rate',
      upsideImpact: Math.max(0, upP50 - baseP50),
      downsideImpact: Math.max(0, baseP50 - downP50),
      totalVariance: Math.abs(upP50 - baseP50) + Math.abs(downP50 - baseP50),
    });
  }

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
    drivers.push({
      variable: 'renewal_count',
      label: 'Renewal Count',
      upsideImpact: Math.max(0, upP50 - baseP50),
      downsideImpact: Math.max(0, baseP50 - downP50),
      totalVariance: Math.abs(upP50 - baseP50) + Math.abs(downP50 - baseP50),
    });
  }

  if (pt === 'expansion') {
    {
      const upInputs = cloneInputs(miniInputs);
      const downInputs = cloneInputs(miniInputs);
      const sigma = upInputs.expansionRate?.sigma ?? 0.08;
      upInputs.expansionRate = { mean: (upInputs.expansionRate?.mean ?? 0.15) + sigma, sigma };
      downInputs.expansionRate = { mean: Math.max(0, (downInputs.expansionRate?.mean ?? 0.15) - sigma), sigma };
      const upP50 = runSimulation(upInputs, null).p50;
      const downP50 = runSimulation(downInputs, null).p50;
      drivers.push({
        variable: 'expansion_rate',
        label: 'Expansion Rate',
        upsideImpact: Math.max(0, upP50 - baseP50),
        downsideImpact: Math.max(0, baseP50 - downP50),
        totalVariance: Math.abs(upP50 - baseP50) + Math.abs(downP50 - baseP50),
      });
    }
    {
      const upInputs = cloneInputs(miniInputs);
      const downInputs = cloneInputs(miniInputs);
      upInputs.customerBaseARR = (upInputs.customerBaseARR ?? 0) * 1.20;
      downInputs.customerBaseARR = (downInputs.customerBaseARR ?? 0) * 0.80;
      const upP50 = runSimulation(upInputs, null).p50;
      const downP50 = runSimulation(downInputs, null).p50;
      drivers.push({
        variable: 'customer_base_arr',
        label: 'Customer Base ARR',
        upsideImpact: Math.max(0, upP50 - baseP50),
        downsideImpact: Math.max(0, baseP50 - downP50),
        totalVariance: Math.abs(upP50 - baseP50) + Math.abs(downP50 - baseP50),
      });
    }
  }

  return drivers.sort((a, b) => b.totalVariance - a.totalVariance).slice(0, 5);
}
