/**
 * AI-Powered Field Suggestions
 *
 * Analyzes deal fields and recommends which ones should be editable on Deal Detail
 * based on fill rate, update frequency, won deal correlation, and field type.
 */

import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('FieldSuggestions');

export interface FieldSuggestion {
  field_name: string;
  field_label: string;
  field_type: string;
  crm_property_name: string;
  score: number;
  fill_rate: number;
  update_frequency: number;
  won_correlation: number | null;
  reasoning: string;
}

// Fields to exclude from analysis (system fields, computed fields, etc.)
const EXCLUDED_FIELDS = [
  'id', 'workspace_id', 'created_at', 'updated_at', 'crm_id', 'crm_type',
  'account_id', 'owner_id', 'pipeline_id', 'last_synced_at',
  // Computed scores
  'health_score', 'skill_score', 'engagement_score', 'momentum_score',
  'deal_score', 'enhanced_deal_score', 'composite_score',
  // System fields
  'divergence_flag', 'phase_divergence', 'inferred_phase', 'phase_confidence',
  'stage_normalized', 'is_active', 'deleted_at'
];

/**
 * Generate AI-powered field suggestions for a workspace
 */
export async function suggestEditableFields(
  workspaceId: string,
  limit: number = 5
): Promise<FieldSuggestion[]> {
  try {
    // 1. Get all columns from deals table
    const columnsResult = await query<{ column_name: string; data_type: string }>(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'deals'
      ORDER BY ordinal_position
    `);

    const suggestions: FieldSuggestion[] = [];

    for (const col of columnsResult.rows) {
      const fieldName = col.column_name;

      // Skip excluded fields
      if (EXCLUDED_FIELDS.includes(fieldName)) continue;
      if (fieldName.endsWith('_score')) continue;
      if (fieldName.endsWith('_at')) continue;
      if (fieldName.endsWith('_id')) continue;

      try {
        const suggestion = await analyzeField(workspaceId, fieldName, col.data_type);
        if (suggestion && suggestion.score >= 50) {
          suggestions.push(suggestion);
        }
      } catch (err) {
        logger.warn(`Failed to analyze field ${fieldName}`, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    // Sort by score descending and return top N
    return suggestions
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

  } catch (err) {
    logger.error('Failed to generate field suggestions', err as Error);
    throw err;
  }
}

/**
 * Analyze a single field and calculate its suggestion score
 */
async function analyzeField(
  workspaceId: string,
  fieldName: string,
  dataType: string
): Promise<FieldSuggestion | null> {
  let score = 0;
  const reasoning: string[] = [];

  // 1. Calculate fill rate (40 points max)
  const fillRateResult = await query<{ total: string; filled: string }>(`
    SELECT
      COUNT(*) as total,
      COUNT(${fieldName}) as filled
    FROM deals
    WHERE workspace_id = $1
      AND stage_normalized NOT IN ('closed_won', 'closed_lost')
  `, [workspaceId]);

  const total = Number(fillRateResult.rows[0]?.total || 0);
  const filled = Number(fillRateResult.rows[0]?.filled || 0);
  const fillRate = total > 0 ? (filled / total) * 100 : 0;

  if (fillRate >= 90) {
    score += 40;
    reasoning.push(`${fillRate.toFixed(0)}% fill rate`);
  } else if (fillRate >= 75) {
    score += 30;
    reasoning.push(`${fillRate.toFixed(0)}% fill rate`);
  } else if (fillRate >= 50) {
    score += 20;
  } else if (fillRate >= 25) {
    score += 10;
  }

  // Skip fields with very low fill rate
  if (fillRate < 10) return null;

  // 2. Calculate update frequency in last 90 days (30 points max)
  // Note: This requires audit_log table tracking field changes
  // For now, use a simpler heuristic based on recent updated_at changes
  const updateFreqResult = await query<{ updated_count: string; total_deals: string }>(`
    SELECT
      COUNT(DISTINCT d.id) FILTER (WHERE d.updated_at > NOW() - INTERVAL '90 days' AND d.${fieldName} IS NOT NULL) as updated_count,
      COUNT(DISTINCT d.id) as total_deals
    FROM deals d
    WHERE d.workspace_id = $1
      AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
  `, [workspaceId]);

  const updatedCount = Number(updateFreqResult.rows[0]?.updated_count || 0);
  const totalDeals = Number(updateFreqResult.rows[0]?.total_deals || 0);
  const updateFrequency = totalDeals > 0 ? (updatedCount / totalDeals) * 100 : 0;

  if (updateFrequency > 60) {
    score += 30;
    reasoning.push(`Updated in ${updateFrequency.toFixed(0)}% of deals`);
  } else if (updateFrequency > 40) {
    score += 20;
    reasoning.push('Updated frequently');
  } else if (updateFrequency > 20) {
    score += 10;
  }

  // 3. Calculate won deal correlation (20 points max)
  let wonCorrelation: number | null = null;
  const correlationResult = await query<{ won_fill_rate: string; lost_fill_rate: string }>(`
    SELECT
      COUNT(CASE WHEN stage_normalized = 'closed_won' AND ${fieldName} IS NOT NULL THEN 1 END)::float /
        NULLIF(COUNT(CASE WHEN stage_normalized = 'closed_won' THEN 1 END), 0) as won_fill_rate,
      COUNT(CASE WHEN stage_normalized = 'closed_lost' AND ${fieldName} IS NOT NULL THEN 1 END)::float /
        NULLIF(COUNT(CASE WHEN stage_normalized = 'closed_lost' THEN 1 END), 0) as lost_fill_rate
    FROM deals
    WHERE workspace_id = $1
  `, [workspaceId]);

  const wonFillRate = Number(correlationResult.rows[0]?.won_fill_rate || 0) * 100;
  const lostFillRate = Number(correlationResult.rows[0]?.lost_fill_rate || 0) * 100;
  wonCorrelation = wonFillRate - lostFillRate;

  if (wonFillRate > 90 && wonCorrelation > 40) {
    score += 20;
    reasoning.push('High correlation with won deals');
  } else if (wonFillRate > 80 && wonCorrelation > 20) {
    score += 15;
    reasoning.push('Filled in most won deals');
  } else if (wonFillRate > 70) {
    score += 10;
  }

  // 4. Field type priority (10 points max)
  const fieldType = mapPostgresType(dataType);

  if (dataType === 'text') {
    score += 10;
    reasoning.push('Text field with high information value');
  } else if (dataType === 'character varying') {
    score += 8;
  } else if (dataType === 'date' || dataType.includes('timestamp')) {
    score += 6;
    reasoning.push('Timeline-critical field');
  } else if (dataType === 'numeric' || dataType === 'integer' || dataType === 'double precision') {
    score += 4;
  } else if (dataType === 'boolean') {
    score += 2;
  }

  return {
    field_name: fieldName,
    field_label: toTitleCase(fieldName),
    field_type: fieldType,
    crm_property_name: fieldName, // Default to same name; would need CRM property mapping
    score: Math.round(score),
    fill_rate: Math.round(fillRate * 10) / 10,
    update_frequency: Math.round(updateFrequency * 10) / 10,
    won_correlation: wonCorrelation ? Math.round(wonCorrelation * 10) / 10 : null,
    reasoning: reasoning.join(' • '),
  };
}

/**
 * Convert PostgreSQL data type to UI field type
 */
function mapPostgresType(pgType: string): string {
  if (pgType === 'text') return 'textarea';
  if (pgType === 'character varying') return 'text';
  if (pgType === 'numeric' || pgType === 'integer' || pgType === 'double precision') return 'number';
  if (pgType === 'date' || pgType.includes('timestamp')) return 'date';
  if (pgType === 'boolean') return 'boolean';
  return 'text';
}

/**
 * Convert snake_case field name to Title Case label
 */
function toTitleCase(str: string): string {
  return str
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
}
