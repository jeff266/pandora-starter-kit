/**
 * Workspace Config Inference Engine
 *
 * Auto-populates workspace configuration by analyzing 12 signal sources:
 * 1. Fiscal year detection (quota records, close date clustering)
 * 2. Stage 0 detection (pre-qualification stage)
 * 3. Parking lot detection (on hold, nurture stages)
 * 4. Documentation mining (Google Drive playbooks, process docs)
 * 5. CRM report mining (Salesforce/HubSpot reports)
 * 6. CRM validation rules & required fields
 * 7. Deal amount distribution (segmentation detection)
 * 8. Field fill rates (required field inference)
 * 9. Connected tool roster (Gong/Fireflies rep identification)
 * 10. Stage transition archaeology (common paths)
 * 11. Loss reason analysis (exclusion rules)
 * 12. Rep pattern analysis (team structure)
 */

import { query } from '../db.js';
import { WorkspaceConfig, PipelineConfig, ConfigMeta } from '../types/workspace-config.js';
import { getDefaultConfig } from './defaults.js';
import { configLoader } from './workspace-config-loader.js';

interface InferenceOptions {
  skipDocMining?: boolean;
  skipReportMining?: boolean;
  skipToolRoster?: boolean;
}

interface InferenceSignal {
  source: string;
  confidence: number;
  evidence: string;
  value: any;
}

interface UserReviewItem {
  section: string;
  question: string;
  suggested_value: any;
  confidence: number;
  evidence: string;
  actions: string[];
}

interface InferenceResult {
  config: WorkspaceConfig;
  signals: Record<string, InferenceSignal[]>;
  user_review_items: UserReviewItem[];
  detection_summary: any;
}

/**
 * Main inference function - analyzes workspace and produces config
 */
export async function inferWorkspaceConfig(
  workspaceId: string,
  options: InferenceOptions = {}
): Promise<InferenceResult> {
  console.log(`[Inference] Starting for workspace ${workspaceId}`);
  const startTime = Date.now();

  // Start with defaults
  const config = getDefaultConfig(workspaceId);
  const signals: Record<string, InferenceSignal[]> = {};
  const reviewItems: UserReviewItem[] = [];

  // Run all inference sources in parallel where possible
  const [
    fiscalYear,
    stage0,
    parkingLot,
    dealDistribution,
    fillRates,
    stageTransitions,
    lossReasons,
    repPatterns,
  ] = await Promise.all([
    detectFiscalYear(workspaceId),
    detectStage0(workspaceId),
    detectParkingLot(workspaceId),
    analyzeDealDistribution(workspaceId),
    analyzeFieldFillRates(workspaceId),
    analyzeStageTransitions(workspaceId),
    analyzeLossReasons(workspaceId),
    analyzeRepPatterns(workspaceId),
  ]);

  signals.fiscal_year = fiscalYear;
  signals.stage_0 = stage0;
  signals.parking_lot = parkingLot;
  signals.deal_distribution = dealDistribution;
  signals.fill_rates = fillRates;
  signals.stage_transitions = stageTransitions;
  signals.loss_reasons = lossReasons;
  signals.rep_patterns = repPatterns;

  // Apply signals to config
  applyFiscalYearSignals(config, fiscalYear, reviewItems);
  applyStage0Signals(config, stage0, reviewItems);
  applyParkingLotSignals(config, parkingLot, reviewItems);
  applyDealDistributionSignals(config, dealDistribution, reviewItems);
  applyFillRateSignals(config, fillRates, reviewItems);
  applyLossReasonSignals(config, lossReasons, reviewItems);
  applyRepPatternSignals(config, repPatterns, reviewItems);

  // Background sources (if not skipped)
  if (!options.skipDocMining) {
    // TODO: Document mining (requires Google Drive integration)
  }

  if (!options.skipReportMining) {
    // TODO: Report mining (requires Salesforce/HubSpot report API)
  }

  // Mark as inferred
  config.confirmed = false;
  config.updated_at = new Date().toISOString();

  // Store the config
  await storeConfig(workspaceId, config, signals);

  const elapsed = Date.now() - startTime;
  console.log(`[Inference] Complete in ${elapsed}ms - ${reviewItems.length} review items`);

  return {
    config,
    signals,
    user_review_items: reviewItems,
    detection_summary: buildDetectionSummary(signals, config),
  };
}

/**
 * Source 1: Fiscal Year Detection
 */
async function detectFiscalYear(workspaceId: string): Promise<InferenceSignal[]> {
  const signals: InferenceSignal[] = [];

  // 1a. Check quota records
  const quotaResult = await query<{ period_start: Date; period_type: string }>(
    `SELECT period_start, period_type
     FROM quota_periods
     WHERE workspace_id = $1
     ORDER BY period_start ASC
     LIMIT 10`,
    [workspaceId]
  );

  if (quotaResult.rows.length >= 2) {
    const firstPeriod = quotaResult.rows[0];
    const fiscalMonth = new Date(firstPeriod.period_start).getMonth() + 1; // 1-12
    const periodType = firstPeriod.period_type;

    signals.push({
      source: 'quota_records',
      confidence: 0.95,
      evidence: `Found ${quotaResult.rows.length} quota periods starting with ${firstPeriod.period_start}`,
      value: { fiscal_year_start_month: fiscalMonth, quota_period: periodType },
    });
  }

  // 1b. Close date clustering
  const closeDateResult = await query<{ month: number; deal_count: number }>(
    `SELECT EXTRACT(MONTH FROM close_date)::int as month, COUNT(*) as deal_count
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized = 'closed_won'
       AND close_date >= NOW() - INTERVAL '24 months'
     GROUP BY 1
     ORDER BY 2 DESC`,
    [workspaceId]
  );

  if (closeDateResult.rows.length >= 4) {
    const avgCount = closeDateResult.rows.reduce((sum, r) => sum + r.deal_count, 0) / closeDateResult.rows.length;
    const spikes = closeDateResult.rows.filter(r => r.deal_count > avgCount * 1.4);

    if (spikes.length >= 4) {
      // Check if spikes are quarterly (3 months apart)
      const months = spikes.map(s => s.month).sort((a, b) => a - b);
      const isQuarterly = months.every((m, i) => i === 0 || (m - months[i - 1]) % 3 === 0);

      if (isQuarterly) {
        const fyStart = (months[0] % 12) + 1;
        signals.push({
          source: 'close_date_clustering',
          confidence: 0.65,
          evidence: `Quarter-end spikes detected in months ${months.join(', ')}`,
          value: { fiscal_year_start_month: fyStart, quota_period: 'quarterly' },
        });
      }
    }
  }

  return signals;
}

/**
 * Source 2: Stage 0 Detection (pre-qualification stage)
 */
async function detectStage0(workspaceId: string): Promise<InferenceSignal[]> {
  const signals: InferenceSignal[] = [];

  // Get all non-closed stages ordered by volume
  const stageResult = await query<{
    stage: string;
    stage_normalized: string;
    deal_count: number;
    lost_without_advancing: number;
    null_amount_count: number;
  }>(
    `SELECT
      stage,
      stage_normalized,
      COUNT(*) as deal_count,
      COUNT(*) FILTER (WHERE stage_normalized = 'closed_lost' AND deal_id NOT IN (
        SELECT DISTINCT deal_id FROM deal_stage_history WHERE workspace_id = $1
      )) as lost_without_advancing,
      COUNT(*) FILTER (WHERE amount IS NULL OR amount = 0) as null_amount_count
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized NOT IN ('closed_won', 'closed_lost')
     GROUP BY stage, stage_normalized
     ORDER BY deal_count DESC`,
    [workspaceId]
  );

  for (const row of stageResult.rows) {
    let score = 0;
    const evidence: string[] = [];

    // Name match
    const stageLower = row.stage.toLowerCase();
    const stage0Keywords = ['meeting', 'prospect', 'lead', 'unqualified', 'appointment', 'intro',
                            'new', 'inquiry', 'pre-qual', 'initial', 'inbound', 'outbound',
                            'set', 'scheduled', 'booked', 'scoping'];
    if (stage0Keywords.some(kw => stageLower.includes(kw))) {
      score += 0.3;
      evidence.push('Stage name suggests pre-qualification');
    }

    // High loss rate
    const lossRate = row.lost_without_advancing / row.deal_count;
    if (lossRate > 0.5) {
      score += 0.3;
      evidence.push(`${(lossRate * 100).toFixed(0)}% of deals lost without advancing`);
    }

    // Null/zero amounts
    const nullRate = row.null_amount_count / row.deal_count;
    if (nullRate > 0.5) {
      score += 0.2;
      evidence.push(`${(nullRate * 100).toFixed(0)}% have no deal value`);
    }

    if (score >= 0.5) {
      // Calculate win rate impact
      const [rawWinRate, qualifiedWinRate] = await calculateWinRateImpact(workspaceId, row.stage_normalized);

      signals.push({
        source: 'stage_0_detection',
        confidence: Math.min(score, 0.95),
        evidence: evidence.join('; '),
        value: {
          stage: row.stage,
          stage_normalized: row.stage_normalized,
          score,
          raw_win_rate: rawWinRate,
          qualified_win_rate: qualifiedWinRate,
          improvement: qualifiedWinRate - rawWinRate,
        },
      });

      // Only detect ONE Stage 0 - the first one
      break;
    }
  }

  return signals;
}

async function calculateWinRateImpact(workspaceId: string, stage0: string): Promise<[number, number]> {
  const result = await query<{
    raw_won: number;
    raw_lost: number;
    qualified_won: number;
    qualified_lost: number;
  }>(
    `SELECT
      COUNT(*) FILTER (WHERE stage_normalized = 'closed_won') as raw_won,
      COUNT(*) FILTER (WHERE stage_normalized = 'closed_lost') as raw_lost,
      COUNT(*) FILTER (WHERE stage_normalized = 'closed_won' AND deal_id IN (
        SELECT deal_id FROM deal_stage_history
        WHERE workspace_id = $1 AND to_stage_normalized != $2
      )) as qualified_won,
      COUNT(*) FILTER (WHERE stage_normalized = 'closed_lost' AND deal_id IN (
        SELECT deal_id FROM deal_stage_history
        WHERE workspace_id = $1 AND to_stage_normalized != $2
      )) as qualified_lost
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized IN ('closed_won', 'closed_lost')
       AND close_date >= NOW() - INTERVAL '6 months'`,
    [workspaceId, stage0]
  );

  const row = result.rows[0];
  if (!row) return [0, 0];

  const rawWinRate = row.raw_won / (row.raw_won + row.raw_lost) || 0;
  const qualifiedWinRate = row.qualified_won / (row.qualified_won + row.qualified_lost) || 0;

  return [rawWinRate, qualifiedWinRate];
}

/**
 * Source 3: Parking Lot Detection
 */
async function detectParkingLot(workspaceId: string): Promise<InferenceSignal[]> {
  const signals: InferenceSignal[] = [];

  const stageResult = await query<{
    stage: string;
    stage_normalized: string;
    deal_count: number;
    avg_days_in_stage: number;
    no_activity_count: number;
  }>(
    `SELECT
      d.stage,
      d.stage_normalized,
      COUNT(*) as deal_count,
      AVG(d.days_in_stage) as avg_days_in_stage,
      COUNT(*) FILTER (WHERE d.last_activity_date < NOW() - INTERVAL '30 days') as no_activity_count
     FROM deals d
     WHERE d.workspace_id = $1
       AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
     GROUP BY d.stage, d.stage_normalized
     HAVING COUNT(*) >= 3`,
    [workspaceId]
  );

  for (const row of stageResult.rows) {
    let score = 0;
    const evidence: string[] = [];

    // Name match
    const stageLower = row.stage.toLowerCase();
    const parkingKeywords = ['review', 'hold', 'paused', 'nurture', 'future', 'pending',
                              'waiting', 'deferred', 'backburner', 'long-term', 'next quarter',
                              'budget hold', 'timing', 'not now', 'revisit', 'dormant',
                              'shelved', 'parked', 'ice', 'stalled'];
    if (parkingKeywords.some(kw => stageLower.includes(kw))) {
      score += 0.4;
      evidence.push('Stage name indicates holding pattern');
    }

    // Long dwell time
    if (row.avg_days_in_stage > 90) {
      score += 0.3;
      evidence.push(`Average ${Math.round(row.avg_days_in_stage)} days in stage`);
    }

    // No recent activity
    const noActivityRate = row.no_activity_count / row.deal_count;
    if (noActivityRate > 0.7) {
      score += 0.3;
      evidence.push(`${(noActivityRate * 100).toFixed(0)}% have no activity in 30+ days`);
    }

    if (score >= 0.4) {
      signals.push({
        source: 'parking_lot_detection',
        confidence: Math.min(score, 0.95),
        evidence: evidence.join('; '),
        value: {
          stage: row.stage,
          stage_normalized: row.stage_normalized,
          deal_count: row.deal_count,
          avg_days: Math.round(row.avg_days_in_stage),
        },
      });
    }
  }

  return signals;
}

/**
 * Source 7: Deal Amount Distribution
 */
async function analyzeDealDistribution(workspaceId: string): Promise<InferenceSignal[]> {
  const signals: InferenceSignal[] = [];

  const result = await query<{
    total: number;
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    p95: number;
  }>(
    `SELECT
      COUNT(*) as total,
      PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY amount) as p10,
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY amount) as p25,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY amount) as p50,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY amount) as p75,
      PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY amount) as p90,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY amount) as p95
     FROM deals
     WHERE workspace_id = $1 AND amount > 0`,
    [workspaceId]
  );

  const row = result.rows[0];
  if (!row || row.total < 20) return signals;

  const spreadRatio = row.p95 / row.p25;

  if (spreadRatio > 20) {
    const confidence = spreadRatio > 50 ? 0.9 : 0.7;
    signals.push({
      source: 'deal_distribution',
      confidence,
      evidence: `P95/P25 ratio is ${spreadRatio.toFixed(1)}x - wide deal size variance`,
      value: {
        needs_segmentation: true,
        spread_ratio: spreadRatio,
        suggested_buckets: [
          { label: 'Small', min: 0, max: row.p25 },
          { label: 'Mid-Market', min: row.p25, max: row.p75 },
          { label: 'Enterprise', min: row.p75, max: null },
        ],
        percentiles: row,
      },
    });
  }

  return signals;
}

/**
 * Source 8: Field Fill Rates
 */
async function analyzeFieldFillRates(workspaceId: string): Promise<InferenceSignal[]> {
  const signals: InferenceSignal[] = [];

  const result = await query<{
    key: string;
    total: number;
    filled: number;
    fill_rate: number;
  }>(
    `SELECT
      key,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE value IS NOT NULL AND value::text NOT IN ('', 'null')) as filled,
      (COUNT(*) FILTER (WHERE value IS NOT NULL AND value::text NOT IN ('', 'null')))::float / NULLIF(COUNT(*), 0) as fill_rate
     FROM deals, jsonb_each(custom_fields)
     WHERE workspace_id = $1
     GROUP BY 1
     HAVING COUNT(*) > 10
     ORDER BY fill_rate DESC`,
    [workspaceId]
  );

  const requiredFields = result.rows.filter(r => r.fill_rate > 0.8);

  if (requiredFields.length > 0) {
    signals.push({
      source: 'field_fill_rates',
      confidence: 0.7,
      evidence: `${requiredFields.length} fields have >80% fill rate`,
      value: {
        required_fields: requiredFields.map(f => ({
          field: f.key,
          fill_rate: f.fill_rate,
          object: 'deals',
        })),
      },
    });
  }

  return signals;
}

/**
 * Source 10: Stage Transition Analysis
 */
async function analyzeStageTransitions(workspaceId: string): Promise<InferenceSignal[]> {
  const signals: InferenceSignal[] = [];

  // Most common stage paths
  const pathResult = await query<{ path: string; frequency: number }>(
    `WITH paths AS (
      SELECT deal_id,
        STRING_AGG(to_stage_normalized, ' → ' ORDER BY changed_at) as path
      FROM deal_stage_history
      WHERE workspace_id = $1
      GROUP BY deal_id
    )
    SELECT path, COUNT(*) as frequency
    FROM paths
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 10`,
    [workspaceId]
  );

  if (pathResult.rows.length > 0) {
    const topPath = pathResult.rows[0];
    signals.push({
      source: 'stage_transitions',
      confidence: 0.75,
      evidence: `Most common path (${topPath.frequency} deals): ${topPath.path}`,
      value: {
        top_paths: pathResult.rows,
        happy_path: topPath.path,
      },
    });
  }

  return signals;
}

/**
 * Source 11: Loss Reason Analysis
 */
async function analyzeLossReasons(workspaceId: string): Promise<InferenceSignal[]> {
  const signals: InferenceSignal[] = [];

  const result = await query<{
    reason: string;
    count: number;
    lost_value: number;
  }>(
    `SELECT
      COALESCE(
        custom_fields->>'closed_lost_reason',
        custom_fields->>'loss_reason',
        custom_fields->>'hs_closed_lost_reason',
        'Not specified'
      ) as reason,
      COUNT(*) as count,
      SUM(amount) as lost_value
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized = 'closed_lost'
       AND close_date >= NOW() - INTERVAL '12 months'
     GROUP BY 1
     ORDER BY 2 DESC
     LIMIT 15`,
    [workspaceId]
  );

  const total = result.rows.reduce((sum, r) => sum + r.count, 0);
  const timingLosses = result.rows.filter(r =>
    /timing|not now|budget|later|not ready|next quarter/i.test(r.reason)
  );
  const disqualifiedLosses = result.rows.filter(r =>
    /disqualified|duplicate|junk|spam/i.test(r.reason)
  );

  if (timingLosses.length > 0) {
    const timingCount = timingLosses.reduce((sum, r) => sum + r.count, 0);
    const timingPct = timingCount / total;

    if (timingPct > 0.15) {
      signals.push({
        source: 'loss_reasons',
        confidence: 0.85,
        evidence: `${(timingPct * 100).toFixed(0)}% of losses are timing/budget related`,
        value: {
          suggest_parking_lot: true,
          timing_losses: timingCount,
        },
      });
    }
  }

  if (disqualifiedLosses.length > 0) {
    signals.push({
      source: 'loss_reasons',
      confidence: 0.85,
      evidence: `${disqualifiedLosses.length} disqualified/junk loss reasons found`,
      value: {
        excluded_values: disqualifiedLosses.map(r => r.reason),
      },
    });
  }

  return signals;
}

/**
 * Source 12: Rep Pattern Analysis
 */
async function analyzeRepPatterns(workspaceId: string): Promise<InferenceSignal[]> {
  const signals: InferenceSignal[] = [];

  const result = await query<{
    owner_email: string;
    owner_name: string;
    total_deals: number;
    open_deals: number;
    won: number;
    avg_deal_size: number;
    last_deal_created: Date;
  }>(
    `SELECT
      owner_email,
      owner_name,
      COUNT(*) as total_deals,
      COUNT(*) FILTER (WHERE stage_normalized NOT IN ('closed_won', 'closed_lost')) as open_deals,
      COUNT(*) FILTER (WHERE stage_normalized = 'closed_won') as won,
      AVG(amount) FILTER (WHERE amount > 0) as avg_deal_size,
      MAX(created_date) as last_deal_created
     FROM deals
     WHERE workspace_id = $1 AND owner_email IS NOT NULL
     GROUP BY 1, 2
     ORDER BY 3 DESC`,
    [workspaceId]
  );

  const reps: string[] = [];
  const excluded: string[] = [];

  for (const row of result.rows) {
    const email = row.owner_email.toLowerCase();
    const daysSinceLastDeal = row.last_deal_created
      ? Math.floor((Date.now() - new Date(row.last_deal_created).getTime()) / (24 * 60 * 60 * 1000))
      : 999;

    // Exclusion rules
    if (row.total_deals < 5 && row.open_deals <= 1) {
      excluded.push(email);
      continue;
    }
    if (/admin|ops|system|integration|test/i.test(email)) {
      excluded.push(email);
      continue;
    }
    if (daysSinceLastDeal > 90 && row.open_deals === 0) {
      excluded.push(email);
      continue;
    }

    // Active rep
    if (row.open_deals >= 3 || row.total_deals >= 10) {
      reps.push(email);
    }
  }

  signals.push({
    source: 'rep_patterns',
    confidence: 0.8,
    evidence: `Identified ${reps.length} active reps, ${excluded.length} excluded`,
    value: {
      reps,
      excluded,
    },
  });

  return signals;
}

/**
 * Apply signals to config and generate review items
 */
function applyFiscalYearSignals(
  config: WorkspaceConfig,
  signals: InferenceSignal[],
  reviewItems: UserReviewItem[]
) {
  const topSignal = signals.sort((a, b) => b.confidence - a.confidence)[0];
  if (!topSignal) return;

  config.cadence.fiscal_year_start_month = topSignal.value.fiscal_year_start_month;
  if (topSignal.value.quota_period) {
    config.cadence.quota_period = topSignal.value.quota_period;
  }

  config._meta['cadence.fiscal_year_start_month'] = {
    source: 'inferred',
    confidence: topSignal.confidence,
    evidence: topSignal.evidence,
    last_validated: new Date().toISOString(),
  };

  if (topSignal.confidence < 0.9) {
    reviewItems.push({
      section: 'cadence',
      question: `Pandora detected your fiscal year starts in month ${topSignal.value.fiscal_year_start_month} (${getMonthName(topSignal.value.fiscal_year_start_month)}). Is this correct?`,
      suggested_value: topSignal.value.fiscal_year_start_month,
      confidence: topSignal.confidence,
      evidence: topSignal.evidence,
      actions: ['confirm', 'adjust'],
    });
  }
}

function applyStage0Signals(
  config: WorkspaceConfig,
  signals: InferenceSignal[],
  reviewItems: UserReviewItem[]
) {
  const topSignal = signals[0];
  if (!topSignal) return;

  const value = topSignal.value;

  // Set minimum stage to the stage AFTER Stage 0
  // For now, we'll use the detected stage itself as the threshold
  config.win_rate.minimum_stage = value.stage_normalized;
  config.win_rate.minimum_stage_field = 'stage_normalized';

  // Add to pipeline config as stage_0_stages
  config.pipelines[0].stage_0_stages = [value.stage];

  config._meta['win_rate.minimum_stage'] = {
    source: 'inferred',
    confidence: topSignal.confidence,
    evidence: topSignal.evidence,
    last_validated: new Date().toISOString(),
  };

  const improvement = ((value.qualified_win_rate - value.raw_win_rate) * 100).toFixed(0);
  reviewItems.push({
    section: 'win_rate',
    question: `'${value.stage}' looks like a pre-qualification stage. ${Math.round(value.raw_win_rate * 100)}% of deals that enter this stage are lost without advancing. Should Pandora exclude these from win rate calculation? This would increase your win rate from ${Math.round(value.raw_win_rate * 100)}% to ${Math.round(value.qualified_win_rate * 100)}% (+${improvement}pp).`,
    suggested_value: value.stage_normalized,
    confidence: topSignal.confidence,
    evidence: topSignal.evidence,
    actions: ['confirm', 'dismiss'],
  });
}

function applyParkingLotSignals(
  config: WorkspaceConfig,
  signals: InferenceSignal[],
  reviewItems: UserReviewItem[]
) {
  if (signals.length === 0) return;

  const parkingStages = signals.map(s => s.value.stage);
  config.pipelines[0].parking_lot_stages = parkingStages;

  const totalDeals = signals.reduce((sum, s) => sum + s.value.deal_count, 0);

  reviewItems.push({
    section: 'pipelines',
    question: `Pandora detected ${signals.length} parking lot stage(s): ${parkingStages.join(', ')}. These ${totalDeals} deals should be excluded from stale alerts and coverage calculations. Correct?`,
    suggested_value: parkingStages,
    confidence: signals[0].confidence,
    evidence: signals.map(s => s.evidence).join('; '),
    actions: ['confirm', 'adjust', 'dismiss'],
  });

  for (const signal of signals) {
    config._meta[`pipelines.0.parking_lot_stages.${signal.value.stage}`] = {
      source: 'inferred',
      confidence: signal.confidence,
      evidence: signal.evidence,
      last_validated: new Date().toISOString(),
    };
  }
}

function applyDealDistributionSignals(
  config: WorkspaceConfig,
  signals: InferenceSignal[],
  reviewItems: UserReviewItem[]
) {
  const signal = signals[0];
  if (!signal || !signal.value.needs_segmentation) return;

  config.win_rate.deal_size_buckets = signal.value.suggested_buckets;

  config._meta['win_rate.deal_size_buckets'] = {
    source: 'inferred',
    confidence: signal.confidence,
    evidence: signal.evidence,
    last_validated: new Date().toISOString(),
  };

  reviewItems.push({
    section: 'win_rate',
    question: `Your deal sizes vary dramatically (smallest: $${Math.round(signal.value.percentiles.p10)}, largest: $${Math.round(signal.value.percentiles.p95)}, ${signal.value.spread_ratio.toFixed(0)}x spread). Should Pandora segment analysis by deal size?`,
    suggested_value: signal.value.suggested_buckets,
    confidence: signal.confidence,
    evidence: signal.evidence,
    actions: ['confirm', 'adjust', 'dismiss'],
  });
}

function applyFillRateSignals(
  config: WorkspaceConfig,
  signals: InferenceSignal[],
  reviewItems: UserReviewItem[]
) {
  const signal = signals[0];
  if (!signal) return;

  config.thresholds.required_fields = signal.value.required_fields.map((f: any) => ({
    field: f.field,
    object: f.object,
    label: f.field,
  }));

  config._meta['thresholds.required_fields'] = {
    source: 'inferred',
    confidence: signal.confidence,
    evidence: signal.evidence,
    last_validated: new Date().toISOString(),
  };
}

function applyLossReasonSignals(
  config: WorkspaceConfig,
  signals: InferenceSignal[],
  reviewItems: UserReviewItem[]
) {
  for (const signal of signals) {
    if (signal.value.excluded_values) {
      config.win_rate.excluded_values.push(...signal.value.excluded_values);

      config._meta['win_rate.excluded_values'] = {
        source: 'inferred',
        confidence: signal.confidence,
        evidence: signal.evidence,
        last_validated: new Date().toISOString(),
      };
    }
  }
}

function applyRepPatternSignals(
  config: WorkspaceConfig,
  signals: InferenceSignal[],
  reviewItems: UserReviewItem[]
) {
  const signal = signals[0];
  if (!signal) return;

  config.teams.excluded_owners = signal.value.excluded;

  config._meta['teams.excluded_owners'] = {
    source: 'inferred',
    confidence: signal.confidence,
    evidence: signal.evidence,
    last_validated: new Date().toISOString(),
  };

  if (signal.value.excluded.length > 0) {
    reviewItems.push({
      section: 'teams',
      question: `Pandora excluded ${signal.value.excluded.length} deal owners from rep analysis (admins, former reps, low activity). Identified ${signal.value.reps.length} active reps. Look correct?`,
      suggested_value: { reps: signal.value.reps, excluded: signal.value.excluded },
      confidence: signal.confidence,
      evidence: signal.evidence,
      actions: ['confirm', 'adjust'],
    });
  }
}

/**
 * Store config in database
 */
async function storeConfig(
  workspaceId: string,
  config: WorkspaceConfig,
  signals: Record<string, InferenceSignal[]>
) {
  await query(
    `INSERT INTO context_layer (workspace_id, category, key, value, updated_at)
     VALUES ($1, 'settings', 'workspace_config', $2::jsonb, NOW())
     ON CONFLICT (workspace_id, category, key)
     DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
    [workspaceId, JSON.stringify(config)]
  );

  // Store raw signals for audit trail
  await query(
    `INSERT INTO context_layer (workspace_id, category, key, value, updated_at)
     VALUES ($1, 'settings', 'config_inference_signals', $2::jsonb, NOW())
     ON CONFLICT (workspace_id, category, key)
     DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
    [workspaceId, JSON.stringify(signals)]
  );

  // Clear cache
  configLoader.clearCache(workspaceId);
}

/**
 * Build detection summary for API response
 */
function buildDetectionSummary(signals: Record<string, InferenceSignal[]>, config: WorkspaceConfig) {
  const stage0Signal = signals.stage_0?.[0];
  const parkingSignals = signals.parking_lot || [];
  const repSignal = signals.rep_patterns?.[0];
  const distSignal = signals.deal_distribution?.[0];

  return {
    pipelines: {
      count: config.pipelines.length,
      names: config.pipelines.map(p => p.name),
    },
    stage_0: stage0Signal ? {
      detected: true,
      stage: stage0Signal.value.stage,
      raw_win_rate: stage0Signal.value.raw_win_rate,
      qualified_win_rate: stage0Signal.value.qualified_win_rate,
    } : { detected: false },
    parking_lot: parkingSignals.length > 0 ? {
      detected: true,
      stages: parkingSignals.map(s => s.value.stage),
      deal_count: parkingSignals.reduce((sum, s) => sum + s.value.deal_count, 0),
    } : { detected: false },
    fiscal_year: {
      start_month: config.cadence.fiscal_year_start_month,
      source: config._meta['cadence.fiscal_year_start_month']?.source || 'default',
    },
    quota_period: config.cadence.quota_period,
    reps: repSignal ? {
      count: repSignal.value.reps.length,
      excluded: repSignal.value.excluded.length,
    } : { count: 0, excluded: 0 },
    deal_segments: distSignal ? {
      needs_segmentation: true,
      spread_ratio: distSignal.value.spread_ratio,
      suggested_buckets: distSignal.value.suggested_buckets,
    } : { needs_segmentation: false },
  };
}

/**
 * Helper: Get month name from number
 */
function getMonthName(month: number): string {
  const names = ['January', 'February', 'March', 'April', 'May', 'June',
                 'July', 'August', 'September', 'October', 'November', 'December'];
  return names[month - 1] || 'Unknown';
}
