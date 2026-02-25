import { RawAnnotation, AnnotationType } from './annotation-types';

interface Deal {
  id: string;
  name: string;
  amount: number;
  stage_normalized: string;
  forecast_category: string;
  close_date: string;
  owner: string;
  probability: number;
  days_in_stage: number;
  last_activity_date: string | null;
}

interface ForecastSnapshot {
  stage_weighted: number;
  category_weighted: number;
  mc_p50: number | null;
  closed_won: number;
  commit: number;
  best_case: number;
  pipeline: number;
  by_rep: RepBreakdown[];
}

interface RepBreakdown {
  rep_email: string;
  rep_name: string;
  commit: number;
  best_case: number;
  pipeline: number;
  closed_won: number;
}

interface MonteCarloResult {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  deal_contributions?: Record<string, number>;
}

interface CoverageProjection {
  period: string;
  existing_pipeline: number;
  quota: number;
  current_coverage: number;
}

interface WeeklyPipeGen {
  week: Date;
  amount: number;
}

// ============================================================================
// 1. Forecast Divergence Detection
// ============================================================================

export function detectForecastDivergence(
  snapshot: ForecastSnapshot,
  prevSnapshot: ForecastSnapshot | null
): RawAnnotation | null {
  const methods = {
    stage_weighted: snapshot.stage_weighted,
    category_weighted: snapshot.category_weighted,
    mc_p50: snapshot.mc_p50 || snapshot.category_weighted, // fallback if no MC
  };

  const values = Object.values(methods);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;

  const divergence = max - min;
  const divergence_pct = divergence / avg;

  if (divergence_pct < 0.15) return null; // Not significant

  // Identify outlier method
  const median = values.sort((a, b) => a - b)[1];
  let outlier_method = 'stage_weighted';
  let max_distance = 0;

  for (const [method, value] of Object.entries(methods)) {
    const distance = Math.abs(value - median);
    if (distance > max_distance) {
      max_distance = distance;
      outlier_method = method;
    }
  }

  return {
    type: 'forecast_divergence',
    raw_data: {
      divergence_amount: divergence,
      divergence_pct,
      method_values: methods,
      outlier_method,
      disagreement_deals: [], // Would need deal-level probability spreads
      week_number: 0, // Would need to compute from snapshot date
    },
  };
}

// ============================================================================
// 2. Deal Risk Detection
// ============================================================================

export function detectDealRisks(
  deals: Deal[],
  snapshot: ForecastSnapshot,
  mcResults?: MonteCarloResult[] | null
): RawAnnotation[] {
  const risks: RawAnnotation[] = [];
  const now = new Date();

  // Average days in stage per stage (for aging detection)
  const stageStats: Record<string, { sum: number; count: number }> = {};
  for (const deal of deals) {
    if (!stageStats[deal.stage_normalized]) {
      stageStats[deal.stage_normalized] = { sum: 0, count: 0 };
    }
    stageStats[deal.stage_normalized].sum += deal.days_in_stage;
    stageStats[deal.stage_normalized].count += 1;
  }

  const avgDaysInStage: Record<string, number> = {};
  for (const [stage, stats] of Object.entries(stageStats)) {
    avgDaysInStage[stage] = stats.count > 0 ? stats.sum / stats.count : 30;
  }

  for (const deal of deals) {
    // Skip closed deals
    if (deal.stage_normalized === 'closed_won' || deal.stage_normalized === 'closed_lost') {
      continue;
    }

    const mc_contribution = mcResults?.[0]?.deal_contributions?.[deal.id] || 0;
    const mc_p50 = mcResults?.[0]?.p50 || snapshot.mc_p50 || snapshot.category_weighted;

    // Stalled commit
    if (deal.forecast_category === 'commit') {
      const daysSinceActivity = deal.last_activity_date
        ? (now.getTime() - new Date(deal.last_activity_date).getTime()) / (1000 * 60 * 60 * 24)
        : 999;

      if (daysSinceActivity > 14) {
        risks.push({
          type: 'stalled_commit',
          raw_data: {
            deal_id: deal.id,
            deal_name: deal.name,
            amount: deal.amount,
            days_in_stage: deal.days_in_stage,
            days_since_activity: Math.floor(daysSinceActivity),
            mc_contribution,
            impact_amount: mc_contribution,
            comparison_basis: `>14 days since last activity`,
          },
        });
        continue;
      }
    }

    // Aging in stage
    const avgDays = avgDaysInStage[deal.stage_normalized] || 30;
    if (deal.days_in_stage > avgDays * 2) {
      risks.push({
        type: 'deal_risk',
        raw_data: {
          deal_id: deal.id,
          deal_name: deal.name,
          amount: deal.amount,
          days_in_stage: deal.days_in_stage,
          stage: deal.stage_normalized,
          avg_days_in_stage: Math.floor(avgDays),
          impact_amount: deal.amount * 0.3, // Estimated risk
          comparison_basis: `>2× avg days in ${deal.stage_normalized}`,
        },
      });
      continue;
    }

    // Concentration risk
    if (mc_p50 > 0 && mc_contribution / mc_p50 > 0.10) {
      risks.push({
        type: 'concentration_risk',
        raw_data: {
          deal_id: deal.id,
          deal_name: deal.name,
          amount: deal.amount,
          mc_contribution,
          pct_of_forecast: (mc_contribution / mc_p50) * 100,
          impact_amount: mc_contribution,
          comparison_basis: `${Math.floor((mc_contribution / mc_p50) * 100)}% of forecast`,
        },
      });
    }
  }

  // Close date clusters
  const closesByWeek: Record<string, Deal[]> = {};
  for (const deal of deals) {
    if (deal.stage_normalized === 'closed_won' || deal.stage_normalized === 'closed_lost') {
      continue;
    }
    const weekKey = getWeekKey(new Date(deal.close_date));
    if (!closesByWeek[weekKey]) closesByWeek[weekKey] = [];
    closesByWeek[weekKey].push(deal);
  }

  const avgDealSize = deals.length > 0
    ? deals.reduce((sum, d) => sum + d.amount, 0) / deals.length
    : 0;

  for (const [week, weekDeals] of Object.entries(closesByWeek)) {
    const largeDeals = weekDeals.filter(d => d.amount > avgDealSize);
    if (largeDeals.length >= 3) {
      const totalAmount = largeDeals.reduce((sum, d) => sum + d.amount, 0);
      const avgProbability = largeDeals.reduce((sum, d) => sum + d.probability, 0) / largeDeals.length;
      risks.push({
        type: 'close_date_cluster',
        raw_data: {
          week,
          deal_count: largeDeals.length,
          total_amount: totalAmount,
          avg_probability: avgProbability,
          impact_amount: totalAmount * avgProbability,
          comparison_basis: `${largeDeals.length} deals closing same week`,
          deal_ids: largeDeals.map(d => d.id),
          deal_names: largeDeals.map(d => d.name),
        },
      });
    }
  }

  // Return top 5 by impact
  return risks
    .sort((a, b) => (b.raw_data.impact_amount || 0) - (a.raw_data.impact_amount || 0))
    .slice(0, 5);
}

function getWeekKey(date: Date): string {
  const year = date.getFullYear();
  const week = Math.ceil(((date.getTime() - new Date(year, 0, 1).getTime()) / 86400000) / 7);
  return `${year}-W${week}`;
}

// ============================================================================
// 3. Attainment Pace Check
// ============================================================================

export function checkAttainmentPace(
  currentSnapshot: ForecastSnapshot,
  historicalSnapshots: ForecastSnapshot[]
): RawAnnotation | null {
  // Need at least 1 quarter of history
  if (historicalSnapshots.length < 8) return null;

  // TODO: Would need week_number and quarter metadata in snapshot
  // For now, return null until we have proper historical tracking
  return null;
}

// ============================================================================
// 4. Confidence Band Analysis
// ============================================================================

export function analyzeConfidenceBand(
  snapshots: ForecastSnapshot[]
): RawAnnotation | null {
  if (snapshots.length < 2) return null;

  const first = snapshots[0];
  const latest = snapshots[snapshots.length - 1];

  // Need MC data
  if (!first.mc_p50 || !latest.mc_p50) return null;

  // Assume P25 and P75 are stored somewhere accessible
  // For now, approximate with ±20% of P50
  const first_p25 = first.mc_p50 * 0.8;
  const first_p75 = first.mc_p50 * 1.2;
  const latest_p25 = latest.mc_p50 * 0.8;
  const latest_p75 = latest.mc_p50 * 1.2;

  const initial_spread = first_p75 - first_p25;
  const current_spread = latest_p75 - latest_p25;
  const spread_change_pct = (current_spread - initial_spread) / initial_spread;

  if (Math.abs(spread_change_pct) < 0.10) return null; // Not significant

  const direction = latest.mc_p50 > snapshots[snapshots.length - 2]?.mc_p50 ? 'up' : 'down';

  return {
    type: 'confidence_band_shift',
    raw_data: {
      initial_spread,
      current_spread,
      spread_change_pct,
      p25: latest_p25,
      p50: latest.mc_p50,
      p75: latest_p75,
      direction,
      weeks_of_data: snapshots.length,
      comparison_basis: `${snapshots.length} weeks of tracking`,
    },
  };
}

// ============================================================================
// 5. Rep Forecast Bias Detection
// ============================================================================

export function detectRepForecastBias(
  snapshots: ForecastSnapshot[],
  reps: RepBreakdown[]
): RawAnnotation[] {
  // Need 2+ quarters of data (16+ weeks)
  if (snapshots.length < 16) return [];

  // TODO: Would need quarter-start forecast vs quarter-end actual tracking
  // This requires historical commit amounts per rep at quarter boundaries
  // For now, return empty until we have proper rep accuracy tracking
  return [];
}

// ============================================================================
// 6. Coverage & Pipe Gen Trend Analysis
// ============================================================================

export function analyzeCoverageAndPipeGen(
  coverageProjections: CoverageProjection[],
  weeklyPipeGen: WeeklyPipeGen[]
): RawAnnotation[] {
  const annotations: RawAnnotation[] = [];

  // Pipe gen trend (linear regression on last 8 weeks)
  if (weeklyPipeGen.length >= 4) {
    const recent = weeklyPipeGen.slice(-8);
    const slope = linearRegression(recent.map((w, i) => [i, w.amount])).slope;
    const trend = slope > 10000 ? 'accelerating' : slope < -10000 ? 'declining' : 'steady';

    const avg_pipe_gen = recent.reduce((sum, w) => sum + w.amount, 0) / recent.length;

    // Flag declining trends
    if (trend === 'declining') {
      annotations.push({
        type: 'pipegen_trend',
        raw_data: {
          trend,
          slope,
          avg_pipe_gen,
          weeks_analyzed: recent.length,
          comparison_basis: `${recent.length}-week trend`,
        },
      });
    }
  }

  // Coverage gaps
  for (const projection of coverageProjections) {
    if (projection.current_coverage < 1.0) {
      annotations.push({
        type: 'coverage_gap',
        raw_data: {
          period: projection.period,
          current_coverage: projection.current_coverage,
          existing_pipeline: projection.existing_pipeline,
          quota: projection.quota,
          gap_amount: projection.quota - projection.existing_pipeline,
          comparison_basis: `<1.0x coverage`,
        },
      });
    }
  }

  return annotations;
}

function linearRegression(points: number[][]): { slope: number; intercept: number } {
  const n = points.length;
  let sum_x = 0, sum_y = 0, sum_xy = 0, sum_xx = 0;

  for (const [x, y] of points) {
    sum_x += x;
    sum_y += y;
    sum_xy += x * y;
    sum_xx += x * x;
  }

  const slope = (n * sum_xy - sum_x * sum_y) / (n * sum_xx - sum_x * sum_x);
  const intercept = (sum_y - slope * sum_x) / n;

  return { slope, intercept };
}

// ============================================================================
// Compute Orchestrator
// ============================================================================

export async function computeForecastAnnotations(
  workspaceId: string,
  currentSnapshot: ForecastSnapshot,
  previousSnapshots: ForecastSnapshot[],
  deals: Deal[],
  mcResults: MonteCarloResult[] | null,
  coverageProjections: CoverageProjection[],
  weeklyPipeGen: WeeklyPipeGen[],
  db: any
): Promise<RawAnnotation[]> {
  const raw: RawAnnotation[] = [];

  // Run all detectors
  const prevSnapshot = previousSnapshots.length > 0
    ? previousSnapshots[previousSnapshots.length - 1]
    : null;

  const divergence = detectForecastDivergence(currentSnapshot, prevSnapshot);
  if (divergence) raw.push(divergence);

  const dealRisks = detectDealRisks(deals, currentSnapshot, mcResults);
  raw.push(...dealRisks);

  const pace = checkAttainmentPace(currentSnapshot, previousSnapshots);
  if (pace) raw.push(pace);

  const band = analyzeConfidenceBand([...previousSnapshots, currentSnapshot]);
  if (band) raw.push(band);

  const repBias = detectRepForecastBias(previousSnapshots, currentSnapshot.by_rep);
  raw.push(...repBias);

  const coverage = analyzeCoverageAndPipeGen(coverageProjections, weeklyPipeGen);
  raw.push(...coverage);

  // Normalize evidence for all annotations
  const normalized = raw.map(a => ({
    ...a,
    raw_data: {
      ...a.raw_data,
      evidence: normalizeEvidence(a),
    },
  }));

  // Rank and cap at 8
  return rankAndCap(normalized, 8);
}

// ============================================================================
// Evidence Normalization
// ============================================================================

function normalizeEvidence(annotation: RawAnnotation): {
  deal_ids: string[];
  deal_names: string[];
  metric_values: Record<string, number>;
  comparison_basis: string | null;
} {
  switch (annotation.type) {
    case 'forecast_divergence':
      return {
        deal_ids: annotation.raw_data.disagreement_deals?.map((d: any) => d.id) || [],
        deal_names: annotation.raw_data.disagreement_deals?.map((d: any) => d.name) || [],
        metric_values: annotation.raw_data.method_values || {},
        comparison_basis: 'stage vs category vs MC',
      };

    case 'deal_risk':
    case 'stalled_commit':
    case 'concentration_risk':
      return {
        deal_ids: [annotation.raw_data.deal_id],
        deal_names: [annotation.raw_data.deal_name],
        metric_values: {
          amount: annotation.raw_data.amount,
          days_in_stage: annotation.raw_data.days_in_stage || 0,
        },
        comparison_basis: annotation.raw_data.comparison_basis || null,
      };

    case 'close_date_cluster':
      return {
        deal_ids: annotation.raw_data.deal_ids || [],
        deal_names: annotation.raw_data.deal_names || [],
        metric_values: {
          total_amount: annotation.raw_data.total_amount,
          deal_count: annotation.raw_data.deal_count,
        },
        comparison_basis: annotation.raw_data.comparison_basis || null,
      };

    case 'rep_forecast_bias':
    case 'rep_upside_signal':
      return {
        deal_ids: [],
        deal_names: [],
        metric_values: {
          avg_accuracy: annotation.raw_data.avg_accuracy || 0,
          commit_close_rate: annotation.raw_data.commit_close_rate || 0,
        },
        comparison_basis: 'vs team avg',
      };

    case 'attainment_pace':
      return {
        deal_ids: [],
        deal_names: [],
        metric_values: {
          current_attainment: annotation.raw_data.current_attainment || 0,
          projected_finish: annotation.raw_data.projected_finish || 0,
        },
        comparison_basis: annotation.raw_data.comparison_basis || null,
      };

    case 'confidence_band_shift':
      return {
        deal_ids: [],
        deal_names: [],
        metric_values: {
          p50: annotation.raw_data.p50 || 0,
          spread_change_pct: annotation.raw_data.spread_change_pct || 0,
        },
        comparison_basis: annotation.raw_data.comparison_basis || null,
      };

    case 'coverage_gap':
    case 'pipegen_trend':
      return {
        deal_ids: [],
        deal_names: [],
        metric_values: {
          current_coverage: annotation.raw_data.current_coverage || 0,
          gap_amount: annotation.raw_data.gap_amount || 0,
        },
        comparison_basis: annotation.raw_data.comparison_basis || null,
      };

    case 'category_migration':
      return {
        deal_ids: annotation.raw_data.deal_ids || [],
        deal_names: annotation.raw_data.deal_names || [],
        metric_values: {},
        comparison_basis: 'week-over-week category changes',
      };

    default:
      return {
        deal_ids: [],
        deal_names: [],
        metric_values: {},
        comparison_basis: null,
      };
  }
}

// ============================================================================
// Ranking and Capping
// ============================================================================

function rankAndCap(annotations: RawAnnotation[], maxCount: number): RawAnnotation[] {
  // Severity order: critical > warning > positive > info
  const severityOrder: Record<string, number> = {
    critical: 4,
    warning: 3,
    positive: 2,
    info: 1,
  };

  // Assign preliminary severity based on type
  const withSeverity = annotations.map(a => {
    let severity = 'info';
    if (['stalled_commit', 'concentration_risk'].includes(a.type)) {
      severity = 'critical';
    } else if (['deal_risk', 'forecast_divergence', 'coverage_gap', 'pipegen_trend'].includes(a.type)) {
      severity = 'warning';
    } else if (['rep_upside_signal'].includes(a.type)) {
      severity = 'positive';
    }
    return { ...a, preliminary_severity: severity };
  });

  // Sort by severity then impact amount
  withSeverity.sort((a, b) => {
    const sevA = severityOrder[a.preliminary_severity] || 0;
    const sevB = severityOrder[b.preliminary_severity] || 0;
    if (sevA !== sevB) return sevB - sevA;

    const impactA = a.raw_data.impact_amount || 0;
    const impactB = b.raw_data.impact_amount || 0;
    return impactB - impactA;
  });

  return withSeverity.slice(0, maxCount);
}
