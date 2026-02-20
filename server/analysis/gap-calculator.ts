/**
 * Gap Calculator - pure TypeScript logic for computing target gaps
 * No LLM calls. Reads closed deals, Monte Carlo results, and workspace metrics.
 */

import { query } from '../db.js';

export interface GapCalculation {
  // Target
  target_amount: number;
  target_metric: string;
  period_label: string;
  period_start: string;
  period_end: string;
  days_remaining: number;

  // Actuals
  closed_amount: number;
  closed_deal_count: number;
  attainment_pct: number;

  // Projection (from Monte Carlo if available)
  monte_carlo_p50: number | null;
  monte_carlo_p10: number | null;
  monte_carlo_p90: number | null;
  hit_probability: number | null;

  // Gap
  gap_to_target: number;
  gap_status: 'on_track' | 'at_risk' | 'critical' | 'achieved';

  // Required pipeline
  workspace_win_rate: number;
  avg_deal_size: number;
  avg_sales_cycle_days: number;
  required_pipeline: number;
  required_deals: number;
  pipeline_deadline: string;
  days_to_pipeline_deadline: number;

  // Current pipeline
  current_open_pipeline: number;
  current_open_deal_count: number;
  pipeline_vs_required: number;

  // Velocity
  current_deals_per_week: number;
  required_deals_per_week: number;

  // Rep breakdown (if quotas configured)
  rep_attainment?: {
    rep_email: string;
    rep_name: string;
    quota: number;
    closed: number;
    attainment_pct: number;
    gap: number;
    status: 'on_track' | 'at_risk' | 'critical';
  }[];
}

interface Target {
  id: string;
  workspace_id: string;
  metric: string;
  period_type: string;
  period_start: string;
  period_end: string;
  period_label: string;
  amount: number;
  set_by: string | null;
  set_at: string;
  notes: string | null;
  is_active: boolean;
  supersedes_id: string | null;
  created_at: string;
}

export async function computeGap(
  workspaceId: string,
  target: Target
): Promise<GapCalculation> {
  const periodStart = new Date(target.period_start);
  const periodEnd = new Date(target.period_end);
  const now = new Date();
  const daysRemaining = Math.max(0, Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  // 1. Closed deals for the period
  const closedResult = await query<{ closed_amount: string; closed_deal_count: string }>(
    `SELECT
      COALESCE(SUM(amount), 0) AS closed_amount,
      COUNT(*) AS closed_deal_count
    FROM deals
    WHERE workspace_id = $1
      AND stage_normalized = 'closed_won'
      AND close_date >= $2
      AND close_date <= LEAST($3::DATE, CURRENT_DATE)`,
    [workspaceId, target.period_start, target.period_end]
  );
  const closedAmount = Number(closedResult.rows[0]?.closed_amount || 0);
  const closedDealCount = Number(closedResult.rows[0]?.closed_deal_count || 0);
  const attainmentPct = target.amount > 0 ? closedAmount / target.amount : 0;

  // 2. Monte Carlo latest run (if available)
  const mcResult = await query<{ result: any }>(
    `SELECT result
    FROM skill_runs
    WHERE workspace_id = $1
      AND skill_id = 'monte-carlo-forecast'
      AND status = 'completed'
    ORDER BY created_at DESC
    LIMIT 1`,
    [workspaceId]
  );
  const mcData = mcResult.rows[0]?.result;
  const monteCarloP50 = mcData?.commandCenter?.p50 ?? null;
  const monteCarloP10 = mcData?.commandCenter?.p10 ?? null;
  const monteCarloP90 = mcData?.commandCenter?.p90 ?? null;
  const hitProbability = mcData?.commandCenter?.probOfHittingTarget ?? null;

  // 3. Gap calculation
  const projectedTotal = closedAmount + (monteCarloP50 ?? 0);
  const gapToTarget = target.amount - projectedTotal;

  let gapStatus: 'on_track' | 'at_risk' | 'critical' | 'achieved';
  if (closedAmount >= target.amount) {
    gapStatus = 'achieved';
  } else if (projectedTotal >= target.amount * 0.95) {
    gapStatus = 'on_track';
  } else if (projectedTotal >= target.amount * 0.80) {
    gapStatus = 'at_risk';
  } else {
    gapStatus = 'critical';
  }

  // 4. Workspace metrics (trailing 90 days)
  const metricsResult = await query<{
    total_deals: string;
    closed_won: string;
    avg_amount: string;
    avg_cycle_days: string;
  }>(
    `SELECT
      COUNT(*) AS total_deals,
      COUNT(*) FILTER (WHERE stage_normalized = 'closed_won') AS closed_won,
      AVG(amount) FILTER (WHERE stage_normalized = 'closed_won') AS avg_amount,
      AVG(close_date - created_at::DATE)
        FILTER (WHERE stage_normalized = 'closed_won') AS avg_cycle_days
    FROM deals
    WHERE workspace_id = $1
      AND created_at >= NOW() - INTERVAL '90 days'`,
    [workspaceId]
  );
  const totalDeals = Number(metricsResult.rows[0]?.total_deals || 0);
  const closedWon = Number(metricsResult.rows[0]?.closed_won || 0);
  const avgDealSize = Number(metricsResult.rows[0]?.avg_amount || 0);
  const avgSalesCycleDays = Number(metricsResult.rows[0]?.avg_cycle_days || 30);
  const workspaceWinRate = totalDeals > 0 ? closedWon / totalDeals : 0.15; // default 15%

  // 5. Required pipeline
  const requiredPipeline = workspaceWinRate > 0 ? Math.abs(gapToTarget) / workspaceWinRate : 0;
  const requiredDeals = avgDealSize > 0 ? Math.ceil(requiredPipeline / avgDealSize) : 0;

  // Pipeline deadline = period_end - avg_sales_cycle_days
  const pipelineDeadlineDate = new Date(periodEnd);
  pipelineDeadlineDate.setDate(pipelineDeadlineDate.getDate() - avgSalesCycleDays);
  const pipelineDeadline = pipelineDeadlineDate.toISOString().split('T')[0];
  const daysToPipelineDeadline = Math.max(
    0,
    Math.ceil((pipelineDeadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  );

  // 6. Current open pipeline
  const openResult = await query<{ open_pipeline: string; open_deal_count: string }>(
    `SELECT
      COALESCE(SUM(amount), 0) AS open_pipeline,
      COUNT(*) AS open_deal_count
    FROM deals
    WHERE workspace_id = $1
      AND stage_normalized = 'open'`,
    [workspaceId]
  );
  const currentOpenPipeline = Number(openResult.rows[0]?.open_pipeline || 0);
  const currentOpenDealCount = Number(openResult.rows[0]?.open_deal_count || 0);
  const pipelineVsRequired = currentOpenPipeline - requiredPipeline;

  // 7. Velocity (trailing 4 weeks)
  const velocityResult = await query<{ deals_created: string }>(
    `SELECT COUNT(*) AS deals_created
    FROM deals
    WHERE workspace_id = $1
      AND created_at >= NOW() - INTERVAL '28 days'`,
    [workspaceId]
  );
  const dealsCreated4Weeks = Number(velocityResult.rows[0]?.deals_created || 0);
  const currentDealsPerWeek = dealsCreated4Weeks / 4;
  const weeksToDeadline = daysToPipelineDeadline / 7;
  const requiredDealsPerWeek = weeksToDeadline > 0 ? requiredDeals / weeksToDeadline : 0;

  // 8. Rep attainment (if quotas exist for this period)
  const quotasResult = await query<{
    rep_email: string;
    rep_name: string | null;
    amount: string;
  }>(
    `SELECT rep_email, rep_name, amount
    FROM quotas
    WHERE workspace_id = $1
      AND period_start = $2
      AND period_end = $3
      AND is_active = true`,
    [workspaceId, target.period_start, target.period_end]
  );

  let repAttainment: GapCalculation['rep_attainment'] | undefined;
  if (quotasResult.rows.length > 0) {
    repAttainment = [];
    for (const quota of quotasResult.rows) {
      const repClosedResult = await query<{ rep_closed: string }>(
        `SELECT COALESCE(SUM(amount), 0) AS rep_closed
        FROM deals
        WHERE workspace_id = $1
          AND owner_email = $2
          AND stage_normalized = 'closed_won'
          AND close_date >= $3
          AND close_date <= LEAST($4::DATE, CURRENT_DATE)`,
        [workspaceId, quota.rep_email, target.period_start, target.period_end]
      );
      const repClosed = Number(repClosedResult.rows[0]?.rep_closed || 0);
      const quotaAmount = Number(quota.amount);
      const repAttainmentPct = quotaAmount > 0 ? repClosed / quotaAmount : 0;
      const repGap = quotaAmount - repClosed;

      let repStatus: 'on_track' | 'at_risk' | 'critical';
      if (repAttainmentPct >= 0.85) {
        repStatus = 'on_track';
      } else if (repAttainmentPct >= 0.70) {
        repStatus = 'at_risk';
      } else {
        repStatus = 'critical';
      }

      repAttainment.push({
        rep_email: quota.rep_email,
        rep_name: quota.rep_name || quota.rep_email,
        quota: quotaAmount,
        closed: repClosed,
        attainment_pct: repAttainmentPct,
        gap: repGap,
        status: repStatus,
      });
    }
  }

  return {
    target_amount: target.amount,
    target_metric: target.metric,
    period_label: target.period_label,
    period_start: target.period_start,
    period_end: target.period_end,
    days_remaining: daysRemaining,

    closed_amount: closedAmount,
    closed_deal_count: closedDealCount,
    attainment_pct: attainmentPct,

    monte_carlo_p50: monteCarloP50,
    monte_carlo_p10: monteCarloP10,
    monte_carlo_p90: monteCarloP90,
    hit_probability: hitProbability,

    gap_to_target: gapToTarget,
    gap_status: gapStatus,

    workspace_win_rate: workspaceWinRate,
    avg_deal_size: avgDealSize,
    avg_sales_cycle_days: avgSalesCycleDays,
    required_pipeline: requiredPipeline,
    required_deals: requiredDeals,
    pipeline_deadline: pipelineDeadline,
    days_to_pipeline_deadline: daysToPipelineDeadline,

    current_open_pipeline: currentOpenPipeline,
    current_open_deal_count: currentOpenDealCount,
    pipeline_vs_required: pipelineVsRequired,

    current_deals_per_week: currentDealsPerWeek,
    required_deals_per_week: requiredDealsPerWeek,

    rep_attainment: repAttainment,
  };
}

export async function getActiveTarget(workspaceId: string, periodStart?: string, periodEnd?: string): Promise<Target | null> {
  let sql = `SELECT * FROM targets WHERE workspace_id = $1 AND is_active = true`;
  const params: any[] = [workspaceId];

  if (periodStart && periodEnd) {
    sql += ` AND period_start = $2 AND period_end = $3`;
    params.push(periodStart, periodEnd);
  }

  sql += ` ORDER BY period_start DESC LIMIT 1`;

  const result = await query<Target>(sql, params);
  return result.rows[0] || null;
}
