/**
 * Custom Field Discovery Engine
 *
 * Automatically identifies which customer-specific CRM fields are meaningful
 * for ICP analysis by analyzing variance, win/loss correlation, and segmentation power.
 *
 * This runs as Step 1.5 in ICP Discovery, between data readiness check and feature matrix.
 */

import { query } from '../../db.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('CustomFieldDiscovery');

// ============================================================================
// Types
// ============================================================================

interface RawFieldStats {
  entityType: 'deal' | 'account' | 'contact';
  fieldKey: string;
  totalRecords: number;
  filledRecords: number;
  fillRate: number;
  distinctValues: number;
}

interface RawLeadFieldStats {
  entityType: 'lead';
  fieldKey: string;
  totalRecords: number;
  filledRecords: number;
  fillRate: number;
  distinctValues: number;
  // Cohort-specific stats
  convertedTotal: number;
  convertedFilled: number;
  convertedFillRate: number;
  unconvertedTotal: number;
  unconvertedFilled: number;
  unconvertedFillRate: number;
  fillRateGap: number; // converted - unconverted
}

interface ValueStats {
  winRate: number;
  dealCount: number;
  avgWonAmount: number;
  avgLostAmount: number;
}

interface LeadConversionStats {
  conversionRate: number;
  leadCount: number;
  convertedCount: number;
  unconvertedCount: number;
}

interface LeadWonDealStats {
  wonRate: number; // % of converted leads that led to won deals
  convertedLeadCount: number;
  wonDeals: number;
  lostDeals: number;
  openDeals: number;
  avgWonAmount: number;
}

interface LeadDisqualificationStats {
  disqualificationRate: number;
  unconvertedLeadCount: number;
  disqualifiedCount: number;
  recycledCount: number;
}

export interface FieldAnalysis {
  fieldKey: string;
  entityType: 'deal' | 'account' | 'contact';
  fillRate: number;
  cardinality: number;

  // Win/loss analysis (deals only)
  winRateByValue: Record<string, ValueStats>;
  winRateVariance: number;
  maxWinRate: number;
  minWinRate: number;
  winRateSpread: number;

  // Amount analysis
  amountByValue: Record<string, number>;
  amountVariance: number;

  // Scoring
  icpRelevanceScore: number;
  discoveryReason: string;

  // Optional DeepSeek classification
  classification?: FieldClassification;
}

export interface LeadFieldAnalysis {
  fieldKey: string;
  entityType: 'lead';

  // Cohort-specific fill rates
  overallFillRate: number;
  convertedFillRate: number;
  unconvertedFillRate: number;
  fillRateGap: number;
  cardinality: number;

  // Cohort counts
  convertedCount: number;
  unconvertedCount: number;

  // Conversion correlation
  conversionRateByValue: Record<string, LeadConversionStats>;
  conversionRateSpread: number;
  maxConversionRate: number;
  minConversionRate: number;

  // Won-deal correlation (for converted leads only)
  wonDealRateByValue: Record<string, LeadWonDealStats>;
  wonDealRateSpread: number;

  // Disqualification correlation (for unconverted leads only)
  disqualificationByValue: Record<string, LeadDisqualificationStats>;

  // Scoring
  icpRelevanceScore: number;
  discoveryReason: string;

  // Optional DeepSeek classification
  classification?: FieldClassification;
}

export interface FieldClassification {
  category: string;
  icpDimension: string;
  segmentationRecommendation: string;
  nameNormalized: string;
}

export interface CustomFieldDiscoveryResult {
  discoveredFields: Array<FieldAnalysis | LeadFieldAnalysis>;
  topFields: Array<FieldAnalysis | LeadFieldAnalysis>;
  entityBreakdown: {
    deals: { total: number; candidates: number; relevant: number };
    accounts: { total: number; candidates: number; relevant: number };
    contacts: { total: number; candidates: number; relevant: number };
    leads: { total: number; candidates: number; relevant: number; convertedTotal: number; unconvertedTotal: number };
  };
  metadata: {
    totalFieldsScanned: number;
    passedFilter: number;
    scoredAbove50: number;
    executionMs: number;
  };
  // Framework detection (MEDDPIC/BANT/SPICED)
  frameworkDetection?: {
    detected_framework: string | null;
    confidence: number;
    matched_fields: Array<{
      crm_field_name: string;
      crm_field_label: string;
      insight_type: string;
      fill_rate: number;
      object_type: string;
    }>;
    unmatched_framework_fields: string[];
    unmapped_custom_fields: Array<{
      crm_field_name: string;
      crm_field_label: string;
      fill_rate: number;
      object_type: string;
    }>;
  };
}

// ============================================================================
// 1. Extract All Custom Fields
// ============================================================================

async function extractCustomFields(
  workspaceId: string,
  entityType: 'deal' | 'account' | 'contact'
): Promise<RawFieldStats[]> {
  const tableName = entityType === 'deal' ? 'deals' : entityType === 'account' ? 'accounts' : 'contacts';

  const result = await query<{
    key: string;
    total_records: string;
    filled_records: string;
    distinct_values: string;
  }>(`
    SELECT
      key,
      COUNT(*) as total_records,
      COUNT(*) FILTER (WHERE value IS NOT NULL AND value::text != '' AND value::text != 'null') as filled_records,
      COUNT(DISTINCT value) as distinct_values
    FROM ${tableName},
      jsonb_each_text(COALESCE(custom_fields, '{}')) AS kv(key, value)
    WHERE workspace_id = $1
    GROUP BY key
    ORDER BY filled_records DESC
  `, [workspaceId]);

  return result.rows.map(row => {
    const totalRecords = parseInt(row.total_records, 10);
    const filledRecords = parseInt(row.filled_records, 10);

    return {
      entityType,
      fieldKey: row.key,
      totalRecords,
      filledRecords,
      fillRate: totalRecords > 0 ? filledRecords / totalRecords : 0,
      distinctValues: parseInt(row.distinct_values, 10),
    };
  });
}

/**
 * Extract Lead fields with cohort-aware stats (converted vs unconverted)
 */
async function extractLeadFields(workspaceId: string): Promise<RawLeadFieldStats[]> {
  const result = await query<{
    key: string;
    total_leads: string;
    total_filled: string;
    distinct_values: string;
    converted_total: string;
    converted_filled: string;
    unconverted_total: string;
    unconverted_filled: string;
  }>(`
    SELECT
      key,
      COUNT(*) as total_leads,
      COUNT(*) FILTER (
        WHERE value IS NOT NULL AND value::text != '' AND value::text != 'null'
      ) as total_filled,
      COUNT(DISTINCT value) as distinct_values,

      -- Converted cohort stats
      COUNT(*) FILTER (WHERE l.is_converted = true) as converted_total,
      COUNT(*) FILTER (
        WHERE l.is_converted = true
          AND value IS NOT NULL AND value::text != '' AND value::text != 'null'
      ) as converted_filled,

      -- Unconverted cohort stats
      COUNT(*) FILTER (WHERE l.is_converted = false) as unconverted_total,
      COUNT(*) FILTER (
        WHERE l.is_converted = false
          AND value IS NOT NULL AND value::text != '' AND value::text != 'null'
      ) as unconverted_filled
    FROM leads l,
      jsonb_each_text(COALESCE(l.custom_fields, '{}')) AS kv(key, value)
    WHERE l.workspace_id = $1
    GROUP BY key
    ORDER BY converted_filled DESC
  `, [workspaceId]);

  return result.rows.map(row => {
    const totalRecords = parseInt(row.total_leads, 10);
    const filledRecords = parseInt(row.total_filled, 10);
    const convertedTotal = parseInt(row.converted_total, 10);
    const convertedFilled = parseInt(row.converted_filled, 10);
    const unconvertedTotal = parseInt(row.unconverted_total, 10);
    const unconvertedFilled = parseInt(row.unconverted_filled, 10);

    const overallFillRate = totalRecords > 0 ? filledRecords / totalRecords : 0;
    const convertedFillRate = convertedTotal > 0 ? convertedFilled / convertedTotal : 0;
    const unconvertedFillRate = unconvertedTotal > 0 ? unconvertedFilled / unconvertedTotal : 0;
    const fillRateGap = convertedFillRate - unconvertedFillRate;

    return {
      entityType: 'lead' as const,
      fieldKey: row.key,
      totalRecords,
      filledRecords,
      fillRate: overallFillRate,
      distinctValues: parseInt(row.distinct_values, 10),
      convertedTotal,
      convertedFilled,
      convertedFillRate,
      unconvertedTotal,
      unconvertedFilled,
      unconvertedFillRate,
      fillRateGap,
    };
  });
}

// ============================================================================
// 2. Filter to Segmentation Candidates
// ============================================================================

function isSystemField(fieldKey: string): boolean {
  const lower = fieldKey.toLowerCase();

  // Skip IDs and timestamps
  if (lower.includes('id') && !lower.includes('_id_')) return true;
  if (lower.includes('timestamp')) return true;
  if (lower.includes('created')) return true;
  if (lower.includes('updated')) return true;
  if (lower.includes('modified')) return true;
  if (lower.endsWith('_at')) return true;

  // Allow business dates
  if (lower.includes('renewal') && lower.includes('date')) return false;
  if (lower.includes('start') && lower.includes('date')) return false;
  if (lower.includes('end') && lower.includes('date')) return false;

  if (lower.endsWith('_date')) return true;

  return false;
}

function filterToSegmentationCandidates(
  rawStats: RawFieldStats[],
  totalRecordCount: number
): { candidates: RawFieldStats[]; filtered: Map<string, string> } {
  const filtered = new Map<string, string>();
  const candidates: RawFieldStats[] = [];

  // Adjust cardinality threshold based on dataset size
  const maxCardinality = totalRecordCount > 1000 ? 50 : 30;

  for (const stat of rawStats) {
    // Filter criteria
    if (stat.fillRate < 0.40) {
      filtered.set(stat.fieldKey, `Low fill rate: ${(stat.fillRate * 100).toFixed(1)}%`);
      continue;
    }

    if (stat.distinctValues < 2) {
      filtered.set(stat.fieldKey, `Constant value (${stat.distinctValues} distinct values)`);
      continue;
    }

    if (stat.distinctValues > maxCardinality) {
      filtered.set(stat.fieldKey, `Too many values: ${stat.distinctValues} (limit: ${maxCardinality})`);
      continue;
    }

    if (isSystemField(stat.fieldKey)) {
      filtered.set(stat.fieldKey, 'System/internal field');
      continue;
    }

    candidates.push(stat);
  }

  return { candidates, filtered };
}

/**
 * Filter leads to segmentation candidates using cohort-aware logic
 * Uses converted cohort fill rate + fill rate gap as primary filters
 */
function filterLeadsToSegmentationCandidates(
  rawStats: RawLeadFieldStats[],
  totalLeadCount: number
): { candidates: RawLeadFieldStats[]; filtered: Map<string, string> } {
  const filtered = new Map<string, string>();
  const candidates: RawLeadFieldStats[] = [];

  const maxCardinality = totalLeadCount > 1000 ? 50 : 30;

  for (const stat of rawStats) {
    // Skip if no converted leads (can't compute conversion correlation)
    if (stat.convertedTotal < 10) {
      filtered.set(stat.fieldKey, `Too few converted leads: ${stat.convertedTotal} (need 10+)`);
      continue;
    }

    // Use CONVERTED cohort fill rate (not overall) as primary filter
    if (stat.convertedFillRate < 0.40) {
      filtered.set(stat.fieldKey, `Low converted fill rate: ${(stat.convertedFillRate * 100).toFixed(1)}%`);
      continue;
    }

    // ALSO keep fields with big fill rate gap (even if below 40%)
    // Big gap = reps deliberately fill during qualification = behavioral signal
    if (stat.convertedFillRate < 0.40 && stat.fillRateGap < 0.30) {
      filtered.set(stat.fieldKey, `Low converted fill rate ${(stat.convertedFillRate * 100).toFixed(1)}% AND small gap ${(stat.fillRateGap * 100).toFixed(1)}pts`);
      continue;
    }

    if (stat.distinctValues < 2) {
      filtered.set(stat.fieldKey, `Constant value (${stat.distinctValues} distinct values)`);
      continue;
    }

    if (stat.distinctValues > maxCardinality) {
      filtered.set(stat.fieldKey, `Too many values: ${stat.distinctValues} (limit: ${maxCardinality})`);
      continue;
    }

    if (isSystemField(stat.fieldKey)) {
      filtered.set(stat.fieldKey, 'System/internal field');
      continue;
    }

    candidates.push(stat);
  }

  return { candidates, filtered };
}

// ============================================================================
// 3. Compute Win/Loss Correlation (Deals Only)
// ============================================================================

async function computeDealFieldCorrelation(
  workspaceId: string,
  fieldKey: string
): Promise<{
  winRateByValue: Record<string, ValueStats>;
  amountByValue: Record<string, number>;
}> {
  const result = await query<{
    value: string;
    deal_count: string;
    won: string;
    lost: string;
    open: string;
    avg_won_amount: string | null;
    avg_lost_amount: string | null;
    avg_amount: string | null;
  }>(`
    SELECT
      cf.value,
      COUNT(*) as deal_count,
      COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_won') as won,
      COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_lost') as lost,
      COUNT(*) FILTER (WHERE d.stage_normalized NOT IN ('closed_won', 'closed_lost')) as open,
      AVG(d.amount) FILTER (WHERE d.stage_normalized = 'closed_won') as avg_won_amount,
      AVG(d.amount) FILTER (WHERE d.stage_normalized = 'closed_lost') as avg_lost_amount,
      AVG(d.amount) as avg_amount
    FROM deals d,
      jsonb_each_text(COALESCE(d.custom_fields, '{}')) AS cf(key, value)
    WHERE d.workspace_id = $1
      AND cf.key = $2
      AND d.stage_normalized IN ('closed_won', 'closed_lost')
    GROUP BY cf.value
    HAVING COUNT(*) >= 3
    ORDER BY deal_count DESC
  `, [workspaceId, fieldKey]);

  const winRateByValue: Record<string, ValueStats> = {};
  const amountByValue: Record<string, number> = {};

  for (const row of result.rows) {
    const won = parseInt(row.won, 10);
    const lost = parseInt(row.lost, 10);
    const total = won + lost;

    if (total > 0) {
      winRateByValue[row.value] = {
        winRate: won / total,
        dealCount: total,
        avgWonAmount: parseFloat(row.avg_won_amount || '0'),
        avgLostAmount: parseFloat(row.avg_lost_amount || '0'),
      };

      amountByValue[row.value] = parseFloat(row.avg_amount || '0');
    }
  }

  return { winRateByValue, amountByValue };
}

// ============================================================================
// 4. Compute Account-Level Correlation
// ============================================================================

async function computeAccountFieldCorrelation(
  workspaceId: string,
  fieldKey: string
): Promise<{
  winRateByValue: Record<string, ValueStats>;
  amountByValue: Record<string, number>;
}> {
  const result = await query<{
    value: string;
    account_count: string;
    deal_count: string;
    won: string;
    lost: string;
    avg_won_amount: string | null;
  }>(`
    SELECT
      acf.value,
      COUNT(DISTINCT a.id) as account_count,
      COUNT(d.id) as deal_count,
      COUNT(d.id) FILTER (WHERE d.stage_normalized = 'closed_won') as won,
      COUNT(d.id) FILTER (WHERE d.stage_normalized = 'closed_lost') as lost,
      AVG(d.amount) FILTER (WHERE d.stage_normalized = 'closed_won') as avg_won_amount
    FROM accounts a
    JOIN deals d ON d.account_id = a.id AND d.workspace_id = a.workspace_id
    CROSS JOIN jsonb_each_text(COALESCE(a.custom_fields, '{}')) AS acf(key, value)
    WHERE a.workspace_id = $1
      AND acf.key = $2
      AND d.stage_normalized IN ('closed_won', 'closed_lost')
    GROUP BY acf.value
    HAVING COUNT(d.id) >= 3
    ORDER BY deal_count DESC
  `, [workspaceId, fieldKey]);

  const winRateByValue: Record<string, ValueStats> = {};
  const amountByValue: Record<string, number> = {};

  for (const row of result.rows) {
    const won = parseInt(row.won, 10);
    const lost = parseInt(row.lost, 10);
    const total = won + lost;

    if (total > 0) {
      winRateByValue[row.value] = {
        winRate: won / total,
        dealCount: total,
        avgWonAmount: parseFloat(row.avg_won_amount || '0'),
        avgLostAmount: 0, // Not tracked at account level
      };

      amountByValue[row.value] = parseFloat(row.avg_won_amount || '0');
    }
  }

  return { winRateByValue, amountByValue };
}

// ============================================================================
// 4. Compute Lead Conversion Correlation (Cohort-Based)
// ============================================================================

/**
 * Compute conversion rate correlation for lead fields
 * Analyzes which field values convert at higher rates (lead → opportunity)
 */
async function computeLeadConversionCorrelation(
  workspaceId: string,
  fieldKey: string
): Promise<Record<string, LeadConversionStats>> {
  const result = await query<{
    value: string;
    lead_count: string;
    converted: string;
    not_converted: string;
  }>(`
    SELECT
      cf.value,
      COUNT(*) as lead_count,
      COUNT(*) FILTER (WHERE l.is_converted = true) as converted,
      COUNT(*) FILTER (WHERE l.is_converted = false) as not_converted
    FROM leads l
    CROSS JOIN jsonb_each_text(COALESCE(l.custom_fields, '{}')) AS cf(key, value)
    WHERE l.workspace_id = $1
      AND cf.key = $2
    GROUP BY cf.value
    HAVING COUNT(*) >= 3
    ORDER BY lead_count DESC
  `, [workspaceId, fieldKey]);

  const conversionRateByValue: Record<string, LeadConversionStats> = {};

  for (const row of result.rows) {
    const leadCount = parseInt(row.lead_count, 10);
    const converted = parseInt(row.converted, 10);
    const notConverted = parseInt(row.not_converted, 10);

    conversionRateByValue[row.value] = {
      conversionRate: leadCount > 0 ? converted / leadCount : 0,
      leadCount,
      convertedCount: converted,
      unconvertedCount: notConverted,
    };
  }

  return conversionRateByValue;
}

/**
 * Compute won-deal rate for converted leads
 * Goes one step further: which field values lead to WON deals (not just conversion)
 */
async function computeLeadWonDealCorrelation(
  workspaceId: string,
  fieldKey: string
): Promise<Record<string, LeadWonDealStats>> {
  const result = await query<{
    value: string;
    converted_leads: string;
    won_deals: string;
    lost_deals: string;
    open_deals: string;
    avg_won_amount: string | null;
  }>(`
    SELECT
      cf.value,
      COUNT(DISTINCT l.id) as converted_leads,
      COUNT(d.id) FILTER (WHERE d.stage_normalized = 'closed_won') as won_deals,
      COUNT(d.id) FILTER (WHERE d.stage_normalized = 'closed_lost') as lost_deals,
      COUNT(d.id) FILTER (WHERE d.stage_normalized NOT IN ('closed_won', 'closed_lost')) as open_deals,
      AVG(d.amount) FILTER (WHERE d.stage_normalized = 'closed_won') as avg_won_amount
    FROM leads l
    JOIN deals d ON d.id = l.converted_deal_id
    CROSS JOIN jsonb_each_text(COALESCE(l.custom_fields, '{}')) AS cf(key, value)
    WHERE l.workspace_id = $1
      AND l.is_converted = true
      AND cf.key = $2
      AND d.stage_normalized IN ('closed_won', 'closed_lost')
    GROUP BY cf.value
    HAVING COUNT(DISTINCT l.id) >= 3
    ORDER BY converted_leads DESC
  `, [workspaceId, fieldKey]);

  const wonDealRateByValue: Record<string, LeadWonDealStats> = {};

  for (const row of result.rows) {
    const convertedLeadCount = parseInt(row.converted_leads, 10);
    const wonDeals = parseInt(row.won_deals, 10);
    const lostDeals = parseInt(row.lost_deals, 10);
    const closedDeals = wonDeals + lostDeals;

    wonDealRateByValue[row.value] = {
      wonRate: closedDeals > 0 ? wonDeals / closedDeals : 0,
      convertedLeadCount,
      wonDeals,
      lostDeals,
      openDeals: parseInt(row.open_deals, 10),
      avgWonAmount: parseFloat(row.avg_won_amount || '0'),
    };
  }

  return wonDealRateByValue;
}

/**
 * Compute disqualification patterns for unconverted leads
 * Identifies negative ICP signals (which field values predict disqualification)
 */
async function computeLeadDisqualificationCorrelation(
  workspaceId: string,
  fieldKey: string
): Promise<Record<string, LeadDisqualificationStats>> {
  const result = await query<{
    value: string;
    unconverted_leads: string;
    disqualified: string;
    recycled: string;
  }>(`
    SELECT
      cf.value,
      COUNT(*) as unconverted_leads,
      COUNT(*) FILTER (WHERE l.status ILIKE '%disqual%') as disqualified,
      COUNT(*) FILTER (WHERE l.status ILIKE '%nurture%' OR l.status ILIKE '%recycle%') as recycled
    FROM leads l
    CROSS JOIN jsonb_each_text(COALESCE(l.custom_fields, '{}')) AS cf(key, value)
    WHERE l.workspace_id = $1
      AND l.is_converted = false
      AND cf.key = $2
    GROUP BY cf.value
    HAVING COUNT(*) >= 3
    ORDER BY unconverted_leads DESC
  `, [workspaceId, fieldKey]);

  const disqualificationByValue: Record<string, LeadDisqualificationStats> = {};

  for (const row of result.rows) {
    const unconvertedLeadCount = parseInt(row.unconverted_leads, 10);
    const disqualified = parseInt(row.disqualified, 10);
    const recycled = parseInt(row.recycled, 10);

    disqualificationByValue[row.value] = {
      disqualificationRate: unconvertedLeadCount > 0 ? disqualified / unconvertedLeadCount : 0,
      unconvertedLeadCount,
      disqualifiedCount: disqualified,
      recycledCount: recycled,
    };
  }

  return disqualificationByValue;
}

// ============================================================================
// 5. Score and Rank Fields
// ============================================================================

function calculateVariance(values: number[]): number {
  if (values.length === 0) return 0;

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;

  return Math.sqrt(variance);
}

function scoreFieldRelevance(field: FieldAnalysis): number {
  let score = 0;

  // Fill rate contribution (max 20 points)
  score += Math.min(20, field.fillRate * 25);

  // Win rate spread contribution (max 40 points)
  if (field.winRateSpread > 0) {
    score += Math.min(40, field.winRateSpread * 150);
  }

  // Cardinality sweet spot (max 15 points)
  if (field.cardinality >= 3 && field.cardinality <= 8) {
    score += 15;
  } else if (field.cardinality >= 2 && field.cardinality <= 15) {
    score += 10;
  } else if (field.cardinality <= 30) {
    score += 5;
  }

  // Sample size bonus (max 15 points)
  const totalSampled = Object.values(field.winRateByValue)
    .reduce((sum, v) => sum + v.dealCount, 0);
  if (totalSampled >= 100) {
    score += 15;
  } else if (totalSampled >= 50) {
    score += 10;
  } else if (totalSampled >= 20) {
    score += 5;
  }

  // Amount variance bonus (max 10 points)
  if (field.amountVariance > 0) {
    const amounts = Object.values(field.amountByValue);
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    if (avgAmount > 0) {
      const cv = field.amountVariance / avgAmount;
      score += Math.min(10, cv * 20);
    }
  }

  return Math.min(100, Math.round(score));
}

/**
 * Score lead field relevance using cohort-aware algorithm
 * Different from deal scoring - focuses on conversion and qualification signals
 */
function scoreLeadFieldRelevance(field: RawLeadFieldStats & {
  conversionRateSpread: number;
  wonDealRateSpread: number;
}): number {
  let score = 0;

  // Converted cohort fill rate (max 20 points)
  // Use converted cohort, not overall
  score += Math.min(20, field.convertedFillRate * 25);

  // Fill rate gap bonus (max 10 points)
  // Big gap = reps deliberately fill during qualification = behavioral signal
  score += Math.min(10, field.fillRateGap * 25);

  // Conversion rate spread (max 30 points)
  // Replaces win rate spread - measures lead→opp conversion predictiveness
  if (field.conversionRateSpread > 0) {
    score += Math.min(30, field.conversionRateSpread * 120);
  }

  // Won-deal rate spread (max 20 points)
  // Goes one step further: which values lead to WON deals
  if (field.wonDealRateSpread > 0) {
    score += Math.min(20, field.wonDealRateSpread * 100);
  }

  // Cardinality sweet spot (max 10 points)
  if (field.distinctValues >= 3 && field.distinctValues <= 8) {
    score += 10;
  } else if (field.distinctValues >= 2 && field.distinctValues <= 15) {
    score += 7;
  }

  // Sample size (max 10 points) - based on converted cohort only
  if (field.convertedFilled >= 100) {
    score += 10;
  } else if (field.convertedFilled >= 50) {
    score += 7;
  } else if (field.convertedFilled >= 20) {
    score += 4;
  }

  return Math.min(100, Math.round(score));
}

function generateDiscoveryReason(field: FieldAnalysis): string {
  const spreadPct = Math.round(field.winRateSpread * 100);
  const fillPct = Math.round(field.fillRate * 100);

  if (field.winRateSpread >= 0.15) {
    // High predictive power
    const maxVal = Object.entries(field.winRateByValue)
      .reduce((max, [key, val]) => val.winRate > max.winRate ? { key, ...val } : max,
              { key: '', winRate: 0, dealCount: 0, avgWonAmount: 0, avgLostAmount: 0 });
    const minVal = Object.entries(field.winRateByValue)
      .reduce((min, [key, val]) => val.winRate < min.winRate ? { key, ...val } : min,
              { key: '', winRate: 1, dealCount: 0, avgWonAmount: 0, avgLostAmount: 0 });

    return `${field.fieldKey} has ${field.cardinality} values with ${spreadPct}pt win-rate spread ` +
           `(${maxVal.key}: ${Math.round(maxVal.winRate * 100)}% vs ${minVal.key}: ${Math.round(minVal.winRate * 100)}%). ` +
           `Fill rate: ${fillPct}%.`;
  } else if (field.winRateSpread > 0) {
    // Low spread despite good fill
    return `${field.fieldKey} has ${field.cardinality} values but only ${spreadPct}pt win-rate spread. ` +
           `Low segmentation power despite ${fillPct}% fill rate.`;
  } else {
    // No win/loss data (account/contact fields)
    return `${field.fieldKey} has ${field.cardinality} distinct values with ${fillPct}% fill rate. ` +
           `Account/contact enrichment field.`;
  }
}

async function analyzeField(
  workspaceId: string,
  rawStat: RawFieldStats
): Promise<FieldAnalysis> {
  let winRateByValue: Record<string, ValueStats> = {};
  let amountByValue: Record<string, number> = {};

  // Get correlation data based on entity type
  if (rawStat.entityType === 'deal') {
    ({ winRateByValue, amountByValue } = await computeDealFieldCorrelation(workspaceId, rawStat.fieldKey));
  } else if (rawStat.entityType === 'account') {
    ({ winRateByValue, amountByValue } = await computeAccountFieldCorrelation(workspaceId, rawStat.fieldKey));
  }

  // Calculate statistics
  const winRates = Object.values(winRateByValue).map(v => v.winRate);
  const amounts = Object.values(amountByValue);

  const maxWinRate = winRates.length > 0 ? Math.max(...winRates) : 0;
  const minWinRate = winRates.length > 0 ? Math.min(...winRates) : 0;
  const winRateSpread = maxWinRate - minWinRate;
  const winRateVariance = calculateVariance(winRates);
  const amountVariance = calculateVariance(amounts);

  const analysis: FieldAnalysis = {
    fieldKey: rawStat.fieldKey,
    entityType: rawStat.entityType,
    fillRate: rawStat.fillRate,
    cardinality: rawStat.distinctValues,
    winRateByValue,
    winRateVariance,
    maxWinRate,
    minWinRate,
    winRateSpread,
    amountByValue,
    amountVariance,
    icpRelevanceScore: 0, // Will be set below
    discoveryReason: '', // Will be set below
  };

  analysis.icpRelevanceScore = scoreFieldRelevance(analysis);
  analysis.discoveryReason = generateDiscoveryReason(analysis);

  return analysis;
}

/**
 * Analyze a lead field with cohort-based correlation
 * Computes three correlation dimensions: conversion, won-deal, disqualification
 */
async function analyzeLeadField(
  workspaceId: string,
  rawStat: RawLeadFieldStats
): Promise<LeadFieldAnalysis> {
  // Get all three correlation dimensions
  const [conversionRateByValue, wonDealRateByValue, disqualificationByValue] = await Promise.all([
    computeLeadConversionCorrelation(workspaceId, rawStat.fieldKey),
    computeLeadWonDealCorrelation(workspaceId, rawStat.fieldKey),
    computeLeadDisqualificationCorrelation(workspaceId, rawStat.fieldKey),
  ]);

  // Calculate conversion rate statistics
  const conversionRates = Object.values(conversionRateByValue).map(v => v.conversionRate);
  const maxConversionRate = conversionRates.length > 0 ? Math.max(...conversionRates) : 0;
  const minConversionRate = conversionRates.length > 0 ? Math.min(...conversionRates) : 0;
  const conversionRateSpread = maxConversionRate - minConversionRate;

  // Calculate won-deal rate statistics
  const wonDealRates = Object.values(wonDealRateByValue).map(v => v.wonRate);
  const wonDealRateSpread = wonDealRates.length > 0 ? (Math.max(...wonDealRates) - Math.min(...wonDealRates)) : 0;

  const analysis: LeadFieldAnalysis = {
    fieldKey: rawStat.fieldKey,
    entityType: 'lead',
    overallFillRate: rawStat.fillRate,
    convertedFillRate: rawStat.convertedFillRate,
    unconvertedFillRate: rawStat.unconvertedFillRate,
    fillRateGap: rawStat.fillRateGap,
    cardinality: rawStat.distinctValues,
    convertedCount: rawStat.convertedTotal,
    unconvertedCount: rawStat.unconvertedTotal,
    conversionRateByValue,
    conversionRateSpread,
    maxConversionRate,
    minConversionRate,
    wonDealRateByValue,
    wonDealRateSpread,
    disqualificationByValue,
    icpRelevanceScore: 0, // Will be set below
    discoveryReason: '', // Will be set below
  };

  // Score using lead-specific algorithm
  analysis.icpRelevanceScore = scoreLeadFieldRelevance({
    ...rawStat,
    conversionRateSpread,
    wonDealRateSpread,
  });

  analysis.discoveryReason = generateLeadDiscoveryReason(analysis);

  return analysis;
}

function generateLeadDiscoveryReason(field: LeadFieldAnalysis): string {
  const conversionSpreadPct = Math.round(field.conversionRateSpread * 100);
  const convertedFillPct = Math.round(field.convertedFillRate * 100);
  const gapPct = Math.round(field.fillRateGap * 100);

  if (field.conversionRateSpread >= 0.15) {
    // High conversion rate spread - strong predictive power
    const maxVal = Object.entries(field.conversionRateByValue)
      .reduce((max, [key, val]) => val.conversionRate > max.conversionRate ? { key, ...val } : max,
              { key: '', conversionRate: 0, leadCount: 0, convertedCount: 0, unconvertedCount: 0 });
    const minVal = Object.entries(field.conversionRateByValue)
      .reduce((min, [key, val]) => val.conversionRate < min.conversionRate ? { key, ...val } : min,
              { key: '', conversionRate: 1, leadCount: 0, convertedCount: 0, unconvertedCount: 0 });

    const maxConvPct = Math.round(maxVal.conversionRate * 100);
    const minConvPct = Math.round(minVal.conversionRate * 100);

    return `High conversion predictiveness: "${maxVal.key}" converts at ${maxConvPct}% vs "${minVal.key}" at ${minConvPct}% (${conversionSpreadPct}pt spread)`;
  }

  if (field.fillRateGap >= 0.30) {
    // Big fill rate gap - behavioral signal
    return `Strong qualification signal: ${convertedFillPct}% filled for converted leads vs ${Math.round(field.unconvertedFillRate * 100)}% for unconverted (${gapPct}pt gap indicates reps deliberately fill during qualification)`;
  }

  if (field.wonDealRateSpread >= 0.15) {
    // Won-deal predictiveness
    return `Won-deal predictiveness: different values correlate with won vs lost outcomes after conversion (${Math.round(field.wonDealRateSpread * 100)}pt spread)`;
  }

  if (field.conversionRateSpread >= 0.08) {
    return `Moderate conversion signal: ${conversionSpreadPct}pt spread in conversion rates across values`;
  }

  return `Filled by ${convertedFillPct}% of converted leads, ${field.cardinality} distinct values`;
}

// ============================================================================
// Part B: DeepSeek Field Classification
// ============================================================================

interface FieldForClassification {
  fieldKey: string;
  entityType: string;
  fillRate: number;
  cardinality: number;
  topValues: Array<{ value: string; count: number; winRate: number | null }>;
  winRateSpread: number;
}

// ============================================================================
// Markdown Report Generator
// ============================================================================

export function generateDiscoveryReport(result: CustomFieldDiscoveryResult): string {
  const lines: string[] = [];

  lines.push('# Custom Field Discovery Report');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Total Fields Scanned**: ${result.metadata.totalFieldsScanned}`);
  lines.push(`- **Passed Filters**: ${result.metadata.passedFilter}`);
  lines.push(`- **Scored Above 50**: ${result.metadata.scoredAbove50}`);
  lines.push(`- **Execution Time**: ${result.metadata.executionMs}ms`);
  lines.push('');

  lines.push('## Entity Breakdown');
  lines.push('');
  lines.push('| Entity | Total Fields | Candidates | Relevant (>50) |');
  lines.push('|--------|--------------|------------|----------------|');
  lines.push(`| Deals | ${result.entityBreakdown.deals.total} | ${result.entityBreakdown.deals.candidates} | ${result.entityBreakdown.deals.relevant} |`);
  lines.push(`| Accounts | ${result.entityBreakdown.accounts.total} | ${result.entityBreakdown.accounts.candidates} | ${result.entityBreakdown.accounts.relevant} |`);
  lines.push(`| Contacts | ${result.entityBreakdown.contacts.total} | ${result.entityBreakdown.contacts.candidates} | ${result.entityBreakdown.contacts.relevant} |`);
  lines.push(`| Leads | ${result.entityBreakdown.leads.total} | ${result.entityBreakdown.leads.candidates} | ${result.entityBreakdown.leads.relevant} |`);
  lines.push('');

  // Lead cohort summary
  if (result.entityBreakdown.leads.total > 0) {
    const conversionRate = result.entityBreakdown.leads.convertedTotal /
      (result.entityBreakdown.leads.convertedTotal + result.entityBreakdown.leads.unconvertedTotal);

    lines.push('### Lead Cohort Summary');
    lines.push('');
    lines.push(`- **Total Leads**: ${result.entityBreakdown.leads.convertedTotal + result.entityBreakdown.leads.unconvertedTotal}`);
    lines.push(`- **Converted**: ${result.entityBreakdown.leads.convertedTotal} (${(conversionRate * 100).toFixed(1)}%)`);
    lines.push(`- **Unconverted**: ${result.entityBreakdown.leads.unconvertedTotal}`);
    lines.push('');
  }

  // Framework detection (MEDDPIC/BANT/SPICED)
  if (result.frameworkDetection) {
    const fw = result.frameworkDetection;

    lines.push('## Qualification Framework Analysis');
    lines.push('');

    if (fw.detected_framework) {
      lines.push(`### Detected Framework: ${fw.detected_framework.toUpperCase()}`);
      lines.push('');
      lines.push(`**Confidence**: ${fw.confidence}% (${fw.matched_fields.length} of ${fw.matched_fields.length + fw.unmatched_framework_fields.length} framework fields found)`);
      lines.push('');

      if (fw.matched_fields.length > 0) {
        lines.push('**Matched Fields:**');
        lines.push('');
        lines.push('| Field | Insight Type | Fill Rate |');
        lines.push('|-------|--------------|-----------|');
        fw.matched_fields.forEach(field => {
          lines.push(`| ${field.crm_field_label} | ${field.insight_type} | ${field.fill_rate.toFixed(1)}% |`);
        });
        lines.push('');

        // Calculate average fill rate
        const avgFillRate = fw.matched_fields.reduce((sum, f) => sum + f.fill_rate, 0) / fw.matched_fields.length;
        const lowFillFields = fw.matched_fields.filter(f => f.fill_rate < 10);

        lines.push(`**Average Fill Rate**: ${avgFillRate.toFixed(1)}%`);
        lines.push('');

        if (lowFillFields.length > 0) {
          lines.push(`⚠️ **Gap Analysis**: ${lowFillFields.length} of ${fw.matched_fields.length} ${fw.detected_framework.toUpperCase()} fields have <10% fill rate`);
          lines.push('');
        }
      }

      if (fw.unmatched_framework_fields.length > 0) {
        lines.push(`**Missing Framework Fields**: ${fw.unmatched_framework_fields.join(', ')}`);
        lines.push('');
      }

      // Recommendation
      lines.push('**💡 Recommendation**: Enable Deal Insights extraction to auto-populate qualification fields from conversation transcripts.');
      lines.push('');
      lines.push(`Your conversation data (Gong/Fireflies) can automatically extract ${fw.detected_framework.toUpperCase()} insights from call transcripts and populate these CRM fields.`);
      lines.push('');
      lines.push('Configure at: Settings → Deal Insights');
      lines.push('');
    } else {
      lines.push('### No Standard Framework Detected');
      lines.push('');
      lines.push('No MEDDPIC, BANT, or SPICED qualification framework detected in your CRM schema.');
      lines.push('');

      if (fw.unmapped_custom_fields.length > 0) {
        lines.push(`You have ${fw.unmapped_custom_fields.length} custom fields on Opportunities/Deals that could be mapped to qualification insights.`);
        lines.push('');
        lines.push('**💡 Recommendation**: Configure custom insight types in Settings → Deal Insights to extract qualification data from conversation transcripts.');
        lines.push('');
      }
    }
  }

  if (result.topFields.length > 0) {
    lines.push('## Top Segmentation Fields (by ICP Relevance)');
    lines.push('');

    result.topFields.forEach((field, index) => {
      lines.push(`### ${index + 1}. ${field.fieldKey} (Score: ${field.icpRelevanceScore}/100)`);
      lines.push('');

      if (field.classification) {
        lines.push(`- **Category**: ${field.classification.category}`);
        lines.push(`- **ICP Dimension**: ${field.classification.icpDimension}`);
        lines.push('');
      }

      // Handle lead fields differently (cohort-based)
      if (field.entityType === 'lead') {
        lines.push(`- **Entity**: Lead (funnel analysis)`);
        lines.push(`- **Converted Fill Rate**: ${(field.convertedFillRate * 100).toFixed(1)}% | Unconverted: ${(field.unconvertedFillRate * 100).toFixed(1)}% | Gap: ${(field.fillRateGap * 100).toFixed(0)}pts`);
        lines.push(`- **Cardinality**: ${field.cardinality} values`);
        lines.push('');

        // Conversion correlation
        if (Object.keys(field.conversionRateByValue).length > 0) {
          lines.push(`- **Conversion Rate Spread**: ${(field.conversionRateSpread * 100).toFixed(0)} points`);

          const sortedConversion = Object.entries(field.conversionRateByValue)
            .sort((a, b) => b[1].conversionRate - a[1].conversionRate);

          if (sortedConversion.length > 0) {
            const [highestKey, highestStats] = sortedConversion[0];
            const [lowestKey, lowestStats] = sortedConversion[sortedConversion.length - 1];

            lines.push(`  - **${highestKey}**: ${(highestStats.conversionRate * 100).toFixed(0)}% conversion (${highestStats.convertedCount}/${highestStats.leadCount})`);
            lines.push(`  - **${lowestKey}**: ${(lowestStats.conversionRate * 100).toFixed(0)}% conversion (${lowestStats.convertedCount}/${lowestStats.leadCount})`);
          }
          lines.push('');
        }

        // Won-deal correlation (if available)
        if (Object.keys(field.wonDealRateByValue).length > 0) {
          lines.push(`- **Won-Deal Rate Spread**: ${(field.wonDealRateSpread * 100).toFixed(0)} points`);

          const sortedWonDeal = Object.entries(field.wonDealRateByValue)
            .sort((a, b) => b[1].wonRate - a[1].wonRate)
            .slice(0, 2);

          sortedWonDeal.forEach(([key, stats]) => {
            lines.push(`  - **${key}**: ${(stats.wonRate * 100).toFixed(0)}% won-deal rate (${stats.wonDeals}/${stats.wonDeals + stats.lostDeals} closed deals)`);
          });
          lines.push('');
        }
      } else {
        // Handle deal/account/contact fields (existing logic)
        lines.push(`- **Fill Rate**: ${(field.fillRate * 100).toFixed(1)}%`);
        lines.push(`- **Cardinality**: ${field.cardinality} values`);
        lines.push('');

        if (Object.keys(field.winRateByValue).length > 0) {
          lines.push(`- **Win Rate Spread**: ${(field.winRateSpread * 100).toFixed(0)} points`);

          const sortedValues = Object.entries(field.winRateByValue)
            .sort((a, b) => b[1].winRate - a[1].winRate);

          if (sortedValues.length > 0) {
            const [highestKey, highestStats] = sortedValues[0];
            const [lowestKey, lowestStats] = sortedValues[sortedValues.length - 1];

            lines.push(`  - ${highestKey}: ${(highestStats.winRate * 100).toFixed(0)}% (highest)`);
            lines.push(`  - ${lowestKey}: ${(lowestStats.winRate * 100).toFixed(0)}% (lowest)`);
          }
          lines.push('');

          if (Object.keys(field.amountByValue).length > 0) {
            const amounts = Object.values(field.amountByValue);
            const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
            lines.push(`- **Average Deal Size**: $${Math.round(avgAmount).toLocaleString()}`);
            lines.push(`- **Amount Variance**: $${Math.round(field.amountVariance).toLocaleString()}`);
            lines.push('');
          }
        }
      }

      if (field.classification) {
        lines.push(`- **Recommendation**: ${field.classification.segmentationRecommendation}`);
      } else {
        lines.push(`- **Analysis**: ${field.discoveryReason}`);
      }

      lines.push('');
    });
  } else {
    lines.push('## No High-Relevance Fields Found');
    lines.push('');
    lines.push('No custom fields scored above 50. This could mean:');
    lines.push('- Custom fields have low fill rates (<40%)');
    lines.push('- Fields don\'t show significant win/loss correlation');
    lines.push('- Dataset is too small for statistical significance');
    lines.push('');
  }

  // Show some examples of filtered fields
  const lowScoreFields = result.discoveredFields
    .filter(f => f.icpRelevanceScore < 50 && f.icpRelevanceScore > 0)
    .slice(0, 5);

  if (lowScoreFields.length > 0) {
    lines.push('## Fields Considered but Excluded');
    lines.push('');

    lowScoreFields.forEach(field => {
      lines.push(`- **${field.fieldKey}** (Score: ${field.icpRelevanceScore}): ${field.discoveryReason}`);
    });

    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// Part B: DeepSeek Field Classification
// ============================================================================

export async function classifyFieldsWithDeepSeek(
  fields: FieldAnalysis[]
): Promise<Map<string, FieldClassification>> {
  if (fields.length === 0) {
    return new Map();
  }

  logger.info('[Custom Field Discovery] Classifying fields with DeepSeek', {
    fieldCount: fields.length,
  });

  // Prepare field data for classification
  const fieldsForClassification: FieldForClassification[] = fields.map(field => {
    // Get top 10 values sorted by deal count
    const topValues = Object.entries(field.winRateByValue)
      .sort((a, b) => b[1].dealCount - a[1].dealCount)
      .slice(0, 10)
      .map(([value, stats]) => ({
        value,
        count: stats.dealCount,
        winRate: stats.winRate,
      }));

    return {
      fieldKey: field.fieldKey,
      entityType: field.entityType,
      fillRate: field.fillRate,
      cardinality: field.cardinality,
      topValues,
      winRateSpread: field.winRateSpread,
    };
  });

  const prompt = `You are a CRM data analyst. Classify these custom fields by their business purpose and ICP relevance.

For each field, provide:
1. category: one of [acquisition_channel, deal_type, product_line, geography, industry_segment, use_case, customer_tier, competitive_context, buying_process, revenue_model, other]
2. icp_dimension: which ICP dimension this field informs [firmographic, behavioral, needs_based, acquisition, value]
3. segmentation_recommendation: how to use this field in ICP analysis (one sentence)
4. name_normalized: a clean human-readable name for the field

Fields to classify:
${JSON.stringify(fieldsForClassification, null, 2)}

Each field includes: key, sample values with counts, win rates per value, fill rate, and cardinality.

Respond with ONLY a JSON array of classifications matching this schema:
[{
  "fieldKey": "string",
  "category": "string",
  "icpDimension": "string",
  "segmentationRecommendation": "string",
  "nameNormalized": "string"
}]`;

  try {
    // Note: This would call DeepSeek API in production
    // For now, return empty classifications since we don't have the API wired yet
    // TODO: Integrate with DeepSeek API when available

    logger.warn('[Custom Field Discovery] DeepSeek classification not yet implemented', {
      fieldCount: fields.length,
      estimatedTokens: prompt.length / 4, // rough estimate
    });

    return new Map();

  } catch (error) {
    logger.error('[Custom Field Discovery] DeepSeek classification failed', { error });
    return new Map();
  }
}

// ============================================================================
// Main Discovery Function
// ============================================================================

export async function discoverCustomFields(
  workspaceId: string,
  options: { enableClassification?: boolean } = {}
): Promise<CustomFieldDiscoveryResult> {
  const startTime = Date.now();

  logger.info('[Custom Field Discovery] Starting analysis', {
    workspaceId,
    enableClassification: options.enableClassification ?? false,
  });

  // 1. Extract all custom fields from each entity type
  const [dealFields, accountFields, contactFields, leadFields] = await Promise.all([
    extractCustomFields(workspaceId, 'deal'),
    extractCustomFields(workspaceId, 'account'),
    extractCustomFields(workspaceId, 'contact'),
    extractLeadFields(workspaceId),
  ]);

  const allFields = [...dealFields, ...accountFields, ...contactFields];
  const totalFieldsScanned = allFields.length + leadFields.length;

  logger.info('[Custom Field Discovery] Extracted fields', {
    deals: dealFields.length,
    accounts: accountFields.length,
    contacts: contactFields.length,
    leads: leadFields.length,
    total: totalFieldsScanned,
  });

  // 2. Filter to segmentation candidates
  const dealCount = dealFields.length > 0 ? dealFields[0].totalRecords : 0;
  const leadCount = leadFields.length > 0 ? leadFields[0].totalRecords : 0;

  const { candidates: dealCandidates, filtered: dealFiltered } = filterToSegmentationCandidates(dealFields, dealCount);
  const { candidates: accountCandidates, filtered: accountFiltered } = filterToSegmentationCandidates(accountFields, dealCount);
  const { candidates: contactCandidates, filtered: contactFiltered } = filterToSegmentationCandidates(contactFields, dealCount);
  const { candidates: leadCandidates, filtered: leadFiltered } = filterLeadsToSegmentationCandidates(leadFields, leadCount);

  const allCandidates = [...dealCandidates, ...accountCandidates, ...contactCandidates];

  logger.info('[Custom Field Discovery] Filtered to candidates', {
    deals: { total: dealFields.length, candidates: dealCandidates.length, filtered: dealFiltered.size },
    accounts: { total: accountFields.length, candidates: accountCandidates.length, filtered: accountFiltered.size },
    contacts: { total: contactFields.length, candidates: contactCandidates.length, filtered: contactFiltered.size },
    leads: { total: leadFields.length, candidates: leadCandidates.length, filtered: leadFiltered.size },
    totalCandidates: allCandidates.length + leadCandidates.length,
  });

  // Log some examples of filtered fields
  if (dealFiltered.size > 0) {
    const examples = Array.from(dealFiltered.entries()).slice(0, 3);
    logger.debug('[Custom Field Discovery] Deal filter examples', { examples });
  }

  // 3. Analyze each candidate field
  const discoveredFields: Array<FieldAnalysis | LeadFieldAnalysis> = [];

  // Analyze non-lead fields
  for (const candidate of allCandidates) {
    try {
      const analysis = await analyzeField(workspaceId, candidate);
      discoveredFields.push(analysis);
    } catch (error) {
      logger.warn('[Custom Field Discovery] Failed to analyze field', {
        fieldKey: candidate.fieldKey,
        entityType: candidate.entityType,
        error,
      });
    }
  }

  // Analyze lead fields (cohort-based)
  for (const leadCandidate of leadCandidates) {
    try {
      const analysis = await analyzeLeadField(workspaceId, leadCandidate);
      discoveredFields.push(analysis);
    } catch (error) {
      logger.warn('[Custom Field Discovery] Failed to analyze lead field', {
        fieldKey: leadCandidate.fieldKey,
        error,
      });
    }
  }

  // 4. Sort by relevance score
  discoveredFields.sort((a, b) => b.icpRelevanceScore - a.icpRelevanceScore);

  // 5. Extract top fields (score >= 50, max 10)
  const topFields = discoveredFields
    .filter(f => f.icpRelevanceScore >= 50)
    .slice(0, 10);

  const scoredAbove50 = discoveredFields.filter(f => f.icpRelevanceScore >= 50).length;

  logger.info('[Custom Field Discovery] Analysis complete', {
    discoveredFields: discoveredFields.length,
    topFields: topFields.length,
    scoredAbove50,
    executionMs: Date.now() - startTime,
  });

  // Log top fields
  for (const field of topFields.slice(0, 5)) {
    logger.info('[Custom Field Discovery] Top field', {
      fieldKey: field.fieldKey,
      entityType: field.entityType,
      score: field.icpRelevanceScore,
      reason: field.discoveryReason,
    });
  }

  // Optional: Classify top fields with DeepSeek
  if (options.enableClassification && topFields.length > 0) {
    try {
      const classifications = await classifyFieldsWithDeepSeek(topFields);

      // Merge classifications back into field analysis
      for (const field of topFields) {
        const classification = classifications.get(field.fieldKey);
        if (classification) {
          field.classification = classification;
        }
      }

      logger.info('[Custom Field Discovery] Classifications applied', {
        classifiedCount: classifications.size,
        topFieldsCount: topFields.length,
      });
    } catch (error) {
      logger.warn('[Custom Field Discovery] Classification failed, continuing without it', { error });
    }
  }

  // Calculate cohort totals for leads
  const leadConvertedTotal = leadFields.length > 0 ? leadFields[0].convertedTotal : 0;
  const leadUnconvertedTotal = leadFields.length > 0 ? leadFields[0].unconvertedTotal : 0;

  // 6. Detect qualification framework (MEDDPIC/BANT/SPICED)
  let frameworkDetection;
  try {
    const { detectFramework } = await import('../../analysis/framework-detector.js');

    const fieldsForDetection = allFields.map(f => ({
      name: f.fieldKey,
      label: f.fieldKey, // TODO: get actual label from CRM schema
      fill_rate: f.fillRate,
      object_type: f.entityType,
    }));

    frameworkDetection = detectFramework(fieldsForDetection);

    if (frameworkDetection.detected_framework) {
      logger.info('[Custom Field Discovery] Framework detected', {
        framework: frameworkDetection.detected_framework,
        confidence: frameworkDetection.confidence,
        matchedFields: frameworkDetection.matched_fields.length,
      });
    }
  } catch (error) {
    logger.warn('[Custom Field Discovery] Framework detection failed', { error });
  }

  return {
    discoveredFields,
    topFields,
    frameworkDetection,
    entityBreakdown: {
      deals: {
        total: dealFields.length,
        candidates: dealCandidates.length,
        relevant: discoveredFields.filter(f => f.entityType === 'deal' && f.icpRelevanceScore >= 50).length,
      },
      accounts: {
        total: accountFields.length,
        candidates: accountCandidates.length,
        relevant: discoveredFields.filter(f => f.entityType === 'account' && f.icpRelevanceScore >= 50).length,
      },
      contacts: {
        total: contactFields.length,
        candidates: contactCandidates.length,
        relevant: discoveredFields.filter(f => f.entityType === 'contact' && f.icpRelevanceScore >= 50).length,
      },
      leads: {
        total: leadFields.length,
        candidates: leadCandidates.length,
        relevant: discoveredFields.filter(f => f.entityType === 'lead' && f.icpRelevanceScore >= 50).length,
        convertedTotal: leadConvertedTotal,
        unconvertedTotal: leadUnconvertedTotal,
      },
    },
    metadata: {
      totalFieldsScanned,
      passedFilter: allCandidates.length + leadCandidates.length,
      scoredAbove50,
      executionMs: Date.now() - startTime,
    },
  };
}
