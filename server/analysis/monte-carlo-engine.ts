/**
 * Monte Carlo Simulation Engine
 *
 * Runs 10,000 independent revenue scenarios.
 * Pure JavaScript arithmetic — no LLM calls.
 */

import type { BetaDistribution, LogNormalDistribution, NormalDistribution, PipelineRateDistribution, FittedDistributions } from './monte-carlo-distributions.js';
import { query } from '../db.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OpenDeal {
  id: string;
  name: string;
  amount: number;
  stageNormalized: string;
  closeDate: Date;
  ownerEmail: string | null;
  probability: number | null;
}

export interface DealRiskAdjustment {
  dealId: string;
  multiplier: number;
  signals: string[];
}

export type PipelineType = 'new_business' | 'renewal' | 'expansion';

export interface UpcomingRenewal {
  dealId: string;
  name: string;
  contractValue: number;
  expectedCloseDate: Date;
  owner: string | null;
}

export interface IterationRecord {
  total: number;
  existing: number;
  projected: number;
  dealsWon: string[];
  newDealsCreated: number;
  byRep: Record<string, number>;
}

export interface SimulationInputs {
  openDeals: OpenDeal[];
  distributions: FittedDistributions;
  riskAdjustments: Record<string, DealRiskAdjustment>;
  forecastWindowEnd: Date;
  today: Date;
  iterations: number;
  pipelineType?: PipelineType;
  upcomingRenewals?: UpcomingRenewal[];
  customerBaseARR?: number;
  expansionRate?: { mean: number; sigma: number } | null;
  storeIterations?: boolean;
}

export interface SimulationOutputs {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  mean: number;
  probOfHittingTarget: number | null;
  existingPipelineP50: number;
  projectedPipelineP50: number;
  iterationResults: number[];
  closedDealsUsedForFitting: number;
  iterations?: IterationRecord[];
  dataQuality: {
    reliableDistributions: string[];
    unreliableDistributions: string[];
    warnings: string[];
  };
}

// ─── Sampling Utilities ───────────────────────────────────────────────────────

export function sampleNormal(mu: number, sigma: number): number {
  // Box-Muller transform
  const u1 = Math.max(Math.random(), 1e-10);
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mu + sigma * z;
}

export function sampleLogNormal(mu: number, sigma: number): number {
  return Math.exp(sampleNormal(mu, sigma));
}

export function sampleBeta(alpha: number, beta: number): number {
  // Johnk's method for Beta distribution sampling
  if (alpha <= 0 || beta <= 0) return 0.5;
  if (alpha === 1 && beta === 1) return Math.random();

  // Use Gamma approximation via log-normal for speed
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  const sum = x + y;
  return sum === 0 ? 0.5 : Math.max(0.01, Math.min(0.99, x / sum));
}

function sampleGamma(shape: number): number {
  // Marsaglia and Tsang's method
  if (shape < 1) {
    return sampleGamma(1 + shape) * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let i = 0; i < 1000; i++) {
    const z = sampleNormal(0, 1);
    const v = Math.pow(1 + c * z, 3);
    if (v > 0) {
      const u = Math.random();
      if (u < 1 - 0.0331 * (z * z) * (z * z)) return d * v;
      if (Math.log(u) < 0.5 * z * z + d * (1 - v + Math.log(v))) return d * v;
    }
  }
  return d;
}

export function sampleBernoulli(p: number): boolean {
  return Math.random() < p;
}

function toDate(d: Date | string | number): Date {
  return d instanceof Date ? d : new Date(d);
}

function addDays(date: Date | string, days: number): Date {
  const d = toDate(date);
  return new Date(d.getTime() + days * 86400 * 1000);
}

function daysBetween(a: Date | string, b: Date | string): number {
  return Math.max(0, (toDate(b).getTime() - toDate(a).getTime()) / 86400000);
}

// ─── Risk Adjustments ─────────────────────────────────────────────────────────

export async function computeDealRiskAdjustments(
  workspaceId: string,
  openDeals: OpenDeal[]
): Promise<Record<string, DealRiskAdjustment>> {
  const adjustments: Record<string, DealRiskAdjustment> = {};
  const now = new Date();

  // Initialize all deals with multiplier 1.0
  for (const deal of openDeals) {
    adjustments[deal.id] = { dealId: deal.id, multiplier: 1.0, signals: [] };
  }

  // 1. Close date in the past
  for (const deal of openDeals) {
    if (toDate(deal.closeDate) < now) {
      adjustments[deal.id].multiplier *= 0.80;
      adjustments[deal.id].signals.push('close_date_past');
    }
  }

  // 2. Load recent skill run outputs (last 7 days)
  const skillRunResult = await query<{
    skill_id: string;
    result: any;
    output: any;
    completed_at: string;
  }>(
    `SELECT skill_id, result, output, completed_at
     FROM skill_runs
     WHERE workspace_id = $1
       AND skill_id IN ('single-thread-alert', 'pipeline-hygiene', 'conversation-intelligence')
       AND status = 'completed'
       AND completed_at > NOW() - INTERVAL '7 days'
     ORDER BY skill_id, completed_at DESC`,
    [workspaceId]
  ).catch(() => ({ rows: [] as any[] }));

  // Deduplicate to most recent per skill
  const latestBySkill: Record<string, any> = {};
  for (const row of skillRunResult.rows) {
    if (!latestBySkill[row.skill_id]) {
      latestBySkill[row.skill_id] = row.result || row.output || {};
    }
  }

  // 3. Single-thread alert — × 0.75 for deals flagged as single-threaded
  const singleThreadData = latestBySkill['single-thread-alert'];
  if (singleThreadData) {
    const flaggedDeals: string[] = extractFlaggedDealIds(singleThreadData, 'single_threaded');
    for (const dealId of flaggedDeals) {
      if (adjustments[dealId]) {
        adjustments[dealId].multiplier *= 0.75;
        adjustments[dealId].signals.push('single_threaded');
      }
    }
  }

  // 4. Pipeline hygiene — × 0.70 for deals with no recent activity
  const hygieneData = latestBySkill['pipeline-hygiene'];
  if (hygieneData) {
    const staleDeals: string[] = extractFlaggedDealIds(hygieneData, 'no_activity');
    for (const dealId of staleDeals) {
      if (adjustments[dealId]) {
        adjustments[dealId].multiplier *= 0.70;
        adjustments[dealId].signals.push('no_recent_activity');
      }
    }
  }

  // 5. Conversation intelligence — competitor mentions × 0.85, champion × 1.15
  const convData = latestBySkill['conversation-intelligence'];
  if (convData) {
    const competitorDeals: string[] = extractFlaggedDealIds(convData, 'competitor_mentioned');
    for (const dealId of competitorDeals) {
      if (adjustments[dealId]) {
        adjustments[dealId].multiplier *= 0.85;
        adjustments[dealId].signals.push('competitor_mentioned');
      }
    }
    const championDeals: string[] = extractFlaggedDealIds(convData, 'champion_active');
    for (const dealId of championDeals) {
      if (adjustments[dealId]) {
        adjustments[dealId].multiplier *= 1.15;
        adjustments[dealId].signals.push('champion_active');
      }
    }
  }

  // 6. Large deal vs rep historical average — × 0.90 for deals > 2× rep avg
  const repAvgResult = await query<{ owner: string; avg_amount: string }>(
    `SELECT owner, AVG(amount)::text AS avg_amount
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized = 'closed_won'
       AND updated_at > NOW() - INTERVAL '24 months'
       AND amount > 0
     GROUP BY owner`,
    [workspaceId]
  ).catch(() => ({ rows: [] as any[] }));

  const repAvg: Record<string, number> = {};
  for (const row of repAvgResult.rows) {
    repAvg[row.owner] = parseFloat(row.avg_amount);
  }

  for (const deal of openDeals) {
    if (deal.ownerEmail && repAvg[deal.ownerEmail] && deal.amount > 0) {
      if (deal.amount > 2 * repAvg[deal.ownerEmail]) {
        adjustments[deal.id].multiplier *= 0.90;
        adjustments[deal.id].signals.push('large_deal_vs_rep_avg');
      }
    }
  }

  // Enforce floor/ceiling
  for (const adj of Object.values(adjustments)) {
    adj.multiplier = Math.max(0.05, Math.min(2.0, adj.multiplier));
  }

  return adjustments;
}

function extractFlaggedDealIds(data: any, signalType: string): string[] {
  // Try to find deal IDs in common skill output shapes
  if (!data) return [];
  const ids: string[] = [];

  const checkObj = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (const item of obj) checkObj(item);
      return;
    }
    if (obj.deal_id && typeof obj.deal_id === 'string') {
      const signals = JSON.stringify(obj).toLowerCase();
      if (signals.includes(signalType.replace('_', ' ')) || signals.includes(signalType)) {
        ids.push(obj.deal_id);
      }
    }
    for (const val of Object.values(obj)) checkObj(val);
  };

  checkObj(data);
  return [...new Set(ids)];
}

// ─── Simulation ───────────────────────────────────────────────────────────────

function runIterationWithDetail(
  inputs: SimulationInputs
): { existing: number; projected: number; record: IterationRecord } {
  let existingRevenue = 0;
  let projectedRevenue = 0;
  const dealsWon: string[] = [];
  const byRep: Record<string, number> = {};
  let newDealsCreated = 0;

  const today = toDate(inputs.today);
  const forecastEnd = toDate(inputs.forecastWindowEnd);
  const daysRemaining = daysBetween(today, forecastEnd);

  // ── Component A: Existing pipeline ──
  for (const deal of inputs.openDeals) {
    const stageDist = inputs.distributions.stageWinRates[deal.stageNormalized];
    const alpha = stageDist?.alpha ?? 2;
    const betaVal = stageDist?.beta ?? 6;
    const baseWinRate = sampleBeta(alpha, betaVal);
    const adjustment = inputs.riskAdjustments[deal.id]?.multiplier ?? 1.0;
    const adjustedWinRate = Math.max(0.05, Math.min(0.95, baseWinRate * adjustment));

    if (!sampleBernoulli(adjustedWinRate)) continue;

    // Sample close date slippage
    const slippageDist = inputs.distributions.slippage[deal.stageNormalized];
    const slippageDays = sampleNormal(slippageDist?.mean ?? 14, slippageDist?.sigma ?? 21);
    const simulatedCloseDate = addDays(deal.closeDate, slippageDays);

    if (simulatedCloseDate > forecastEnd) continue;

    // Sample amount variation (clip to 0.5x–2x CRM value)
    const amountMultiplier = sampleLogNormal(0, inputs.distributions.dealSize.sigma * 0.3);
    const simulatedAmount = Math.max(
      deal.amount * 0.5,
      Math.min(deal.amount * 2.0, deal.amount * amountMultiplier)
    );

    existingRevenue += simulatedAmount;
    dealsWon.push(deal.id);
  }

  const monthsRemaining = daysRemaining / 30;
  const pipelineType = inputs.pipelineType ?? 'new_business';

  if (pipelineType === 'renewal') {
    for (const renewal of (inputs.upcomingRenewals ?? [])) {
      const renewalClose = toDate(renewal.expectedCloseDate);
      if (renewalClose > forecastEnd) continue;

      const renewalDist = inputs.distributions.stageWinRates['renewal'];
      const renewalWinRate = renewalDist
        ? sampleBeta(renewalDist.alpha, renewalDist.beta)
        : sampleBeta(7, 3);

      if (!sampleBernoulli(renewalWinRate)) continue;

      const logMu = Math.log(renewal.contractValue);
      const amount = sampleLogNormal(logMu, inputs.distributions.dealSize.sigma * 0.15);
      projectedRevenue += amount;
      newDealsCreated++;
      if (renewal.owner) {
        byRep[renewal.owner] = (byRep[renewal.owner] ?? 0) + amount;
      }
    }
  } else if (pipelineType === 'expansion') {
    if ((inputs.customerBaseARR ?? 0) > 0) {
      const expRate = Math.max(0, sampleNormal(
        inputs.expansionRate?.mean ?? 0.15,
        inputs.expansionRate?.sigma ?? 0.08
      ));

      const cycleMonths = (Math.max(14, sampleLogNormal(
        inputs.distributions.cycleLength.mu,
        inputs.distributions.cycleLength.sigma
      )) * 0.7) / 30;

      const windowFraction = Math.min(1, monthsRemaining / cycleMonths);

      const expansionDist = inputs.distributions.stageWinRates['expansion'];
      const expansionWinRate = expansionDist
        ? sampleBeta(expansionDist.alpha, expansionDist.beta)
        : sampleBeta(6, 4);

      const expansionRevenue = inputs.customerBaseARR! * expRate * windowFraction * expansionWinRate;
      projectedRevenue += expansionRevenue;
    }
  } else {
    for (const [repKey, rateDist] of Object.entries(inputs.distributions.pipelineRates)) {
      let repRevenue = 0;
      for (let month = 0; month < Math.ceil(monthsRemaining); month++) {
        const monthFraction = Math.min(1, monthsRemaining - month);
        const dealsThisMonth = Math.max(0, Math.round(
          sampleNormal(rateDist.mean * rateDist.rampFactor * monthFraction, rateDist.sigma * 0.5)
        ));

        for (let d = 0; d < dealsThisMonth; d++) {
          const cycleDays = Math.max(14, sampleLogNormal(
            inputs.distributions.cycleLength.mu,
            inputs.distributions.cycleLength.sigma
          ));
          const dealCreatedDaysFromNow = month * 30 + Math.random() * 30;
          const projectedCloseDaysFromNow = dealCreatedDaysFromNow + cycleDays;

          if (projectedCloseDaysFromNow > daysRemaining) continue;

          if (!sampleBernoulli(sampleBeta(2, 6))) continue;

          const amount = Math.max(1000, sampleLogNormal(
            inputs.distributions.dealSize.mu,
            inputs.distributions.dealSize.sigma
          ));
          repRevenue += amount;
          projectedRevenue += amount;
          newDealsCreated++;
        }
      }
      if (repRevenue > 0) byRep[repKey] = repRevenue;
    }
  }

  const record: IterationRecord = {
    total: existingRevenue + projectedRevenue,
    existing: existingRevenue,
    projected: projectedRevenue,
    dealsWon,
    newDealsCreated,
    byRep,
  };

  return { existing: existingRevenue, projected: projectedRevenue, record };
}

function buildDataQualityReport(
  distributions: FittedDistributions
): SimulationOutputs['dataQuality'] {
  const reliable: string[] = [];
  const unreliable: string[] = [];
  const warnings: string[] = [];

  if (distributions.dealSize.isReliable) reliable.push('deal_size');
  else { unreliable.push('deal_size'); warnings.push('Deal size based on <20 closed-won deals'); }

  if (distributions.cycleLength.isReliable) reliable.push('cycle_length');
  else { unreliable.push('cycle_length'); warnings.push('Cycle length based on <20 closed deals'); }

  const reliableStages = Object.values(distributions.stageWinRates).filter(d => d.isReliable).length;
  if (reliableStages >= 2) reliable.push('stage_win_rates');
  else { unreliable.push('stage_win_rates'); warnings.push('Fewer than 2 stages have reliable win rate data'); }

  return { reliableDistributions: reliable, unreliableDistributions: unreliable, warnings };
}

export function runSimulation(
  inputs: SimulationInputs,
  quota: number | null
): SimulationOutputs {
  const results: number[] = [];
  const existingResults: number[] = [];
  const iterationRecords: IterationRecord[] = [];

  for (let i = 0; i < inputs.iterations; i++) {
    const { existing, projected, record } = runIterationWithDetail(inputs);
    results.push(existing + projected);
    existingResults.push(existing);
    if (inputs.storeIterations) iterationRecords.push(record);
  }

  results.sort((a, b) => a - b);
  existingResults.sort((a, b) => a - b);

  const n = results.length;
  const p50idx = Math.floor(0.50 * n);

  return {
    p10: results[Math.floor(0.10 * n)],
    p25: results[Math.floor(0.25 * n)],
    p50: results[p50idx],
    p75: results[Math.floor(0.75 * n)],
    p90: results[Math.floor(0.90 * n)],
    mean: results.reduce((a, b) => a + b, 0) / n,
    probOfHittingTarget: quota !== null ? results.filter(r => r >= quota).length / n : null,
    existingPipelineP50: existingResults[p50idx],
    projectedPipelineP50: results[p50idx] - existingResults[p50idx],
    iterationResults: results,
    closedDealsUsedForFitting: 0,  // set by caller
    iterations: inputs.storeIterations ? iterationRecords : undefined,
    dataQuality: buildDataQualityReport(inputs.distributions),
  };
}

// ─── Histogram Downsampler ────────────────────────────────────────────────────

export function buildHistogram(
  sortedResults: number[],
  buckets = 100
): { bucketMin: number; bucketMax: number; count: number }[] {
  if (sortedResults.length === 0) return [];
  const min = sortedResults[0];
  const max = sortedResults[sortedResults.length - 1];
  const bucketWidth = (max - min) / buckets || 1;

  const histogram = Array.from({ length: buckets }, (_, i) => ({
    bucketMin: min + i * bucketWidth,
    bucketMax: min + (i + 1) * bucketWidth,
    count: 0,
  }));

  for (const v of sortedResults) {
    const idx = Math.min(buckets - 1, Math.floor((v - min) / bucketWidth));
    histogram[idx].count++;
  }

  return histogram;
}
