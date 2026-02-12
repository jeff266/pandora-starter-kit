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

interface ValueStats {
  winRate: number;
  dealCount: number;
  avgWonAmount: number;
  avgLostAmount: number;
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

export interface FieldClassification {
  category: string;
  icpDimension: string;
  segmentationRecommendation: string;
  nameNormalized: string;
}

export interface CustomFieldDiscoveryResult {
  discoveredFields: FieldAnalysis[];
  topFields: FieldAnalysis[];
  entityBreakdown: {
    deals: { total: number; candidates: number; relevant: number };
    accounts: { total: number; candidates: number; relevant: number };
    contacts: { total: number; candidates: number; relevant: number };
  };
  metadata: {
    totalFieldsScanned: number;
    passedFilter: number;
    scoredAbove50: number;
    executionMs: number;
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
  lines.push('');

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
  const [dealFields, accountFields, contactFields] = await Promise.all([
    extractCustomFields(workspaceId, 'deal'),
    extractCustomFields(workspaceId, 'account'),
    extractCustomFields(workspaceId, 'contact'),
  ]);

  const allFields = [...dealFields, ...accountFields, ...contactFields];
  const totalFieldsScanned = allFields.length;

  logger.info('[Custom Field Discovery] Extracted fields', {
    deals: dealFields.length,
    accounts: accountFields.length,
    contacts: contactFields.length,
    total: totalFieldsScanned,
  });

  // 2. Filter to segmentation candidates
  const dealCount = dealFields.length > 0 ? dealFields[0].totalRecords : 0;
  const { candidates: dealCandidates, filtered: dealFiltered } = filterToSegmentationCandidates(dealFields, dealCount);
  const { candidates: accountCandidates, filtered: accountFiltered } = filterToSegmentationCandidates(accountFields, dealCount);
  const { candidates: contactCandidates, filtered: contactFiltered } = filterToSegmentationCandidates(contactFields, dealCount);

  const allCandidates = [...dealCandidates, ...accountCandidates, ...contactCandidates];

  logger.info('[Custom Field Discovery] Filtered to candidates', {
    deals: { total: dealFields.length, candidates: dealCandidates.length, filtered: dealFiltered.size },
    accounts: { total: accountFields.length, candidates: accountCandidates.length, filtered: accountFiltered.size },
    contacts: { total: contactFields.length, candidates: contactCandidates.length, filtered: contactFiltered.size },
    totalCandidates: allCandidates.length,
  });

  // Log some examples of filtered fields
  if (dealFiltered.size > 0) {
    const examples = Array.from(dealFiltered.entries()).slice(0, 3);
    logger.debug('[Custom Field Discovery] Deal filter examples', { examples });
  }

  // 3. Analyze each candidate field
  const discoveredFields: FieldAnalysis[] = [];

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

  return {
    discoveredFields,
    topFields,
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
    },
    metadata: {
      totalFieldsScanned,
      passedFilter: allCandidates.length,
      scoredAbove50,
      executionMs: Date.now() - startTime,
    },
  };
}
