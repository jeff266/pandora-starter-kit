/**
 * Monte Carlo Distribution Fitting
 *
 * Fits probability distributions to historical CRM data.
 * Called once per skill run; outputs are cached in the compute step.
 */

import { query } from '../db.js';

export interface BetaDistribution {
  alpha: number;
  beta: number;
  mean: number;
  sampleSize: number;
  isReliable: boolean;
}

export interface LogNormalDistribution {
  mu: number;
  sigma: number;
  median: number;
  sampleSize: number;
  isReliable: boolean;
}

export interface NormalDistribution {
  mean: number;
  sigma: number;
  sampleSize: number;
  isReliable: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// ─── 2a. Stage Win Rates ─────────────────────────────────────────────────────

export async function fitStageWinRates(
  workspaceId: string,
  pipelineFilter?: string | null,
  lookbackMonths: number = 24,
  filterClause: string = ''
): Promise<Record<string, BetaDistribution>> {
  const pClause = filterClause || (pipelineFilter ? `AND d.pipeline = $3` : '');
  const pClauseNoAlias = filterClause ? filterClause.replace(/\bd\./g, '') : (pipelineFilter ? `AND pipeline = $3` : '');
  const params = [workspaceId, lookbackMonths, ...(pipelineFilter && !filterClause ? [pipelineFilter] : [])];

  const histResult = await query<{
    stage_normalized: string;
    wins: string;
    losses: string;
  }>(
    `SELECT
       dsh.stage_normalized,
       COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_won')::text AS wins,
       COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_lost')::text AS losses
     FROM deal_stage_history dsh
     JOIN deals d ON dsh.deal_id = d.id AND d.workspace_id = dsh.workspace_id
     WHERE d.workspace_id = $1
       AND d.stage_normalized IN ('closed_won', 'closed_lost')
       AND d.updated_at > NOW() - ($2 || ' months')::interval
       ${pClause}
     GROUP BY dsh.stage_normalized
     HAVING dsh.stage_normalized IS NOT NULL`,
    params
  );

  const result: Record<string, BetaDistribution> = {};

  let rows = histResult.rows;
  if (rows.length < 2) {
    const fallback = await query<{
      stage_normalized: string;
      wins: string;
      losses: string;
    }>(
      `SELECT
         stage_normalized,
         COUNT(*) FILTER (WHERE stage_normalized = 'closed_won')::text AS wins,
         COUNT(*) FILTER (WHERE stage_normalized = 'closed_lost')::text AS losses
       FROM deals
       WHERE workspace_id = $1
         AND stage_normalized IN ('closed_won', 'closed_lost')
         AND updated_at > NOW() - ($2 || ' months')::interval
         AND stage_normalized IS NOT NULL
         ${pClauseNoAlias}
       GROUP BY stage_normalized`,
      params
    );
    rows = fallback.rows;
  }

  for (const row of rows) {
    const wins = parseInt(row.wins, 10);
    const losses = parseInt(row.losses, 10);
    const alpha = wins + 1;  // Laplace smoothing
    const beta = losses + 1;
    const sampleSize = wins + losses;
    result[row.stage_normalized] = {
      alpha,
      beta,
      mean: alpha / (alpha + beta),
      sampleSize,
      isReliable: sampleSize >= 10,
    };
  }

  return result;
}

// ─── 2b. Deal Size ───────────────────────────────────────────────────────────

export async function fitDealSizeDistribution(
  workspaceId: string,
  pipelineFilter?: string | null,
  lookbackMonths: number = 24,
  filterClause: string = ''
): Promise<LogNormalDistribution> {
  const pClause = filterClause ? filterClause.replace(/\bd\./g, '') : (pipelineFilter ? `AND pipeline = $3` : '');
  const params = [workspaceId, lookbackMonths, ...(pipelineFilter && !filterClause ? [pipelineFilter] : [])];
  const result = await query<{ amount: string }>(
    `SELECT amount::text
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized = 'closed_won'
       AND updated_at > NOW() - ($2 || ' months')::interval
       AND amount > 0
       ${pClause}`,
    params
  );

  const amounts = result.rows.map(r => parseFloat(r.amount)).filter(a => a > 0);

  if (amounts.length < 5) {
    // Minimal fallback: use overall deal amounts
    const all = await query<{ amount: string }>(
      `SELECT COALESCE(amount, 50000)::text as amount FROM deals
       WHERE workspace_id = $1 AND amount > 0 LIMIT 100`,
      [workspaceId]
    );
    const allAmounts = all.rows.map(r => parseFloat(r.amount));
    if (allAmounts.length > 0) amounts.push(...allAmounts);
  }

  if (amounts.length === 0) {
    // Last resort defaults
    return { mu: Math.log(75000), sigma: 0.8, median: 75000, sampleSize: 0, isReliable: false };
  }

  const logAmounts = amounts.map(a => Math.log(a));
  const mu = mean(logAmounts);
  const sigma = Math.max(stdev(logAmounts), 0.1);

  return {
    mu,
    sigma,
    median: Math.exp(mu),
    sampleSize: amounts.length,
    isReliable: amounts.length >= 20,
  };
}

// ─── 2c. Sales Cycle Length ───────────────────────────────────────────────────

export async function fitCycleLengthDistribution(
  workspaceId: string,
  pipelineFilter?: string | null,
  lookbackMonths: number = 24,
  filterClause: string = ''
): Promise<LogNormalDistribution> {
  const pClause = filterClause ? filterClause.replace(/\bd\./g, '') : (pipelineFilter ? `AND pipeline = $3` : '');
  const params = [workspaceId, lookbackMonths, ...(pipelineFilter && !filterClause ? [pipelineFilter] : [])];
  const result = await query<{ cycle_days: string }>(
    `SELECT
       (EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400)::text AS cycle_days
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized IN ('closed_won', 'closed_lost')
       AND updated_at > NOW() - ($2 || ' months')::interval
       AND updated_at > created_at
       ${pClause}`,
    params
  );

  const days = result.rows
    .map(r => parseFloat(r.cycle_days))
    .filter(d => d > 0 && d <= 730);  // exclude outliers > 2 years

  if (days.length === 0) {
    return { mu: Math.log(90), sigma: 0.6, median: 90, sampleSize: 0, isReliable: false };
  }

  const logDays = days.map(d => Math.log(d));
  const mu = mean(logDays);
  const sigma = Math.max(stdev(logDays), 0.1);

  return {
    mu,
    sigma,
    median: Math.exp(mu),
    sampleSize: days.length,
    isReliable: days.length >= 20,
  };
}

// ─── 2d. Close Date Slippage ──────────────────────────────────────────────────

export async function fitCloseSlippageDistribution(
  workspaceId: string,
  pipelineFilter?: string | null,
  lookbackMonths: number = 24,
  filterClause: string = ''
): Promise<Record<string, NormalDistribution>> {
  const pClause = filterClause || (pipelineFilter ? `AND d.pipeline = $3` : '');
  const params = [workspaceId, lookbackMonths, ...(pipelineFilter && !filterClause ? [pipelineFilter] : [])];
  const result = await query<{
    stage_normalized: string;
    mean_slippage: string | null;
    sigma_slippage: string | null;
    sample_size: string;
  }>(
    `SELECT
       stage_normalized,
       AVG(slippage_days)::text AS mean_slippage,
       STDDEV(slippage_days)::text AS sigma_slippage,
       COUNT(*)::text AS sample_size
     FROM (
       SELECT
         d.stage_normalized,
         EXTRACT(EPOCH FROM (d.updated_at - COALESCE(d.close_date, d.created_at::date))) / 86400 AS slippage_days
       FROM deals d
       WHERE d.workspace_id = $1
         AND d.stage_normalized IN ('closed_won', 'closed_lost')
         AND d.updated_at > NOW() - ($2 || ' months')::interval
         AND d.close_date IS NOT NULL
         AND d.updated_at IS NOT NULL
         AND d.stage_normalized IS NOT NULL
         ${pClause}
     ) subq
     WHERE slippage_days BETWEEN -365 AND 365
     GROUP BY stage_normalized`,
    params
  );

  const slippage: Record<string, NormalDistribution> = {};

  for (const row of result.rows) {
    const n = parseInt(row.sample_size, 10);
    slippage[row.stage_normalized] = {
      mean: row.mean_slippage ? parseFloat(row.mean_slippage) : 14,
      sigma: row.sigma_slippage ? Math.max(parseFloat(row.sigma_slippage), 7) : 21,
      sampleSize: n,
      isReliable: n >= 10,
    };
  }

  return slippage;
}

// ─── 2e. Pipeline Creation Rates ─────────────────────────────────────────────

export interface PipelineRateDistribution extends NormalDistribution {
  rampFactor: number;
}

export async function fitPipelineCreationRates(
  workspaceId: string,
  pipelineFilter?: string | null,
  lookbackMonths: number = 12,
  filterClause: string = ''
): Promise<Record<string, PipelineRateDistribution>> {
  const pClause = filterClause ? filterClause.replace(/\bd\./g, '') : (pipelineFilter ? `AND pipeline = $3` : '');
  const params = [workspaceId, lookbackMonths, ...(pipelineFilter && !filterClause ? [pipelineFilter] : [])];
  const result = await query<{
    owner: string;
    month: string;
    deals_created: string;
    first_deal_at: string;
  }>(
    `SELECT
       owner,
       DATE_TRUNC('month', created_at)::text AS month,
       COUNT(*)::text AS deals_created,
       MIN(created_at)::text AS first_deal_at
     FROM deals
     WHERE workspace_id = $1
       AND created_at > NOW() - ($2 || ' months')::interval
       AND owner IS NOT NULL
       ${pClause}
     GROUP BY owner, DATE_TRUNC('month', created_at)`,
    params
  );

  // Group by rep
  const repData: Record<string, { counts: number[]; firstDealAt: Date }> = {};
  for (const row of result.rows) {
    if (!repData[row.owner]) {
      repData[row.owner] = { counts: [], firstDealAt: new Date(row.first_deal_at) };
    }
    repData[row.owner].counts.push(parseInt(row.deals_created, 10));
  }

  // Compute team average for new hire fallback
  const allCounts = Object.values(repData).flatMap(d => d.counts);
  const teamMean = allCounts.length > 0 ? mean(allCounts) : 2;

  const rates: Record<string, PipelineRateDistribution> = {};
  const now = new Date();

  for (const [email, data] of Object.entries(repData)) {
    const monthsActive = data.counts.length;
    const repMean = mean(data.counts);
    const repSigma = stdev(data.counts);

    // Ramp factor based on months since first deal
    const monthsSinceHire = Math.floor(
      (now.getTime() - data.firstDealAt.getTime()) / (30 * 24 * 3600 * 1000)
    );
    let rampFactor = 1.0;
    if (monthsSinceHire <= 2) rampFactor = 0.25;
    else if (monthsSinceHire <= 4) rampFactor = 0.50;
    else if (monthsSinceHire <= 5) rampFactor = 0.75;

    if (monthsActive < 3) {
      // New hire — use team average × ramp
      rates[email] = {
        mean: teamMean,
        sigma: Math.max(teamMean * 0.5, 0.5),
        sampleSize: monthsActive,
        isReliable: false,
        rampFactor,
      };
    } else {
      rates[email] = {
        mean: repMean,
        sigma: Math.max(repSigma, 0.5),
        sampleSize: monthsActive,
        isReliable: monthsActive >= 6,
        rampFactor,
      };
    }
  }

  return rates;
}

// ─── 2f. Expansion Rate ──────────────────────────────────────────────────────

export async function fitExpansionRateDistribution(
  workspaceId: string,
  pipelineFilter?: string | null,
  lookbackMonths: number = 24,
  filterClause: string = ''
): Promise<{ mean: number; sigma: number; customerBaseARR: number; sampleSize: number; isReliable: boolean } | null> {
  const pClause = filterClause || (pipelineFilter ? `AND d.pipeline = $3` : '');
  const params: (string | number)[] = [workspaceId, lookbackMonths];
  if (pipelineFilter && !filterClause) params.push(pipelineFilter);

  const rateResult = await query<{
    mean_expansion_rate: string | null;
    sigma_expansion_rate: string | null;
    sample_size: string;
  }>(
    `SELECT
       AVG(d.amount / NULLIF(a.annual_revenue, 0))::text AS mean_expansion_rate,
       STDDEV(d.amount / NULLIF(a.annual_revenue, 0))::text AS sigma_expansion_rate,
       COUNT(*)::text AS sample_size
     FROM deals d
     JOIN accounts a ON d.account_id = a.id AND a.workspace_id = d.workspace_id
     WHERE d.workspace_id = $1
       AND d.stage_normalized = 'closed_won'
       AND d.updated_at > NOW() - ($2 || ' months')::interval
       AND a.annual_revenue > 0
       ${pClause}`,
    params
  );

  const row = rateResult.rows[0];
  const sampleSize = row ? parseInt(row.sample_size, 10) : 0;

  let customerBaseARR = 0;
  const arrResult = await query<{ customer_base_arr: string }>(
    `SELECT COALESCE(SUM(annual_revenue), 0)::text AS customer_base_arr
     FROM accounts
     WHERE workspace_id = $1
       AND annual_revenue > 0`,
    [workspaceId]
  );
  customerBaseARR = parseFloat(arrResult.rows[0]?.customer_base_arr || '0');

  if (customerBaseARR === 0) {
    const fallbackArr = await query<{ total_amount: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total_amount
       FROM deals
       WHERE workspace_id = $1
         AND stage_normalized = 'closed_won'
         AND updated_at > NOW() - ('12 months')::interval
         AND amount > 0`,
      [workspaceId]
    );
    customerBaseARR = parseFloat(fallbackArr.rows[0]?.total_amount || '0');
  }

  if (sampleSize < 5) {
    return {
      mean: 0.15,
      sigma: 0.08,
      customerBaseARR,
      sampleSize,
      isReliable: false,
    };
  }

  return {
    mean: row.mean_expansion_rate ? parseFloat(row.mean_expansion_rate) : 0.15,
    sigma: row.sigma_expansion_rate ? Math.max(parseFloat(row.sigma_expansion_rate), 0.01) : 0.08,
    customerBaseARR,
    sampleSize,
    isReliable: sampleSize >= 10,
  };
}

// ─── Data Quality Report ─────────────────────────────────────────────────────

export interface FittedDistributions {
  stageWinRates: Record<string, BetaDistribution>;
  dealSize: LogNormalDistribution;
  cycleLength: LogNormalDistribution;
  slippage: Record<string, NormalDistribution>;
  pipelineRates: Record<string, PipelineRateDistribution>;
  expansionRate?: { mean: number; sigma: number; customerBaseARR: number; sampleSize: number; isReliable: boolean } | null;
}

export function assessDataQuality(
  distributions: FittedDistributions,
  closedDealCount: number
): { tier: 1 | 2 | 3; reliable: string[]; unreliable: string[]; warnings: string[]; canRun: boolean } {
  const reliable: string[] = [];
  const unreliable: string[] = [];
  const warnings: string[] = [];

  if (distributions.dealSize.isReliable) reliable.push('deal_size');
  else { unreliable.push('deal_size'); warnings.push('Deal size distribution based on fewer than 20 closed-won deals.'); }

  if (distributions.cycleLength.isReliable) reliable.push('cycle_length');
  else { unreliable.push('cycle_length'); warnings.push('Sales cycle distribution based on fewer than 20 closed deals.'); }

  const reliableStages = Object.entries(distributions.stageWinRates).filter(([, d]) => d.isReliable);
  if (reliableStages.length >= 2) reliable.push('stage_win_rates');
  else { unreliable.push('stage_win_rates'); warnings.push('Fewer than 2 stages have reliable win rate data (>= 10 observations).'); }

  const slippageCount = Object.values(distributions.slippage).filter(d => d.isReliable).length;
  if (slippageCount >= 2) reliable.push('slippage');
  else warnings.push('Using default close date slippage (14 days mean, 21 days sigma) — insufficient history.');

  const tier: 1 | 2 | 3 = closedDealCount < 20 ? 1 : 2;

  return {
    tier,
    reliable,
    unreliable,
    warnings,
    canRun: true,  // always run — just adjust confidence
  };
}
