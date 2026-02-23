/**
 * Confidence Scoring for Enriched Accounts
 *
 * Calculates a 0.0-1.0 confidence score based on field completeness.
 * Used to determine data quality and surface partial enrichment in UI.
 *
 * Score Ranges:
 * - 0.9 – 1.0 (High): domain + industry + employee_count + revenue_range + tech_stack
 * - 0.7 – 0.89 (Medium): domain + industry + employee_count
 * - 0.5 – 0.69 (Low): domain or company_name + at least 2 other fields
 * - < 0.5 (Insufficient): Missing both identifiers OR fewer than 2 total fields
 */

export interface EnrichedAccountData {
  domain?: string | null;
  company_name?: string | null;
  industry?: string | null;
  employee_count?: number | null;
  employee_range?: string | null;
  revenue_range?: string | null;
  funding_stage?: string | null;
  hq_country?: string | null;
  hq_state?: string | null;
  hq_city?: string | null;
  tech_stack?: string[] | null;
  growth_signal?: string | null;
  founded_year?: number | null;
  public_or_private?: string | null;
}

/**
 * Calculate confidence score for an enriched account record.
 * Returns a float between 0.0 and 1.0.
 */
export function calculateConfidenceScore(data: EnrichedAccountData): number {
  // Check for required identifier fields
  const hasDomain = !!data.domain && data.domain.trim().length > 0;
  const hasCompanyName = !!data.company_name && data.company_name.trim().length > 0;

  if (!hasDomain && !hasCompanyName) {
    return 0.0; // No identifier = zero confidence
  }

  // Count non-empty enrichment fields (excluding identifiers)
  const enrichmentFields = [
    data.industry,
    data.employee_count,
    data.employee_range,
    data.revenue_range,
    data.funding_stage,
    data.hq_country,
    data.hq_state,
    data.hq_city,
    data.tech_stack && data.tech_stack.length > 0 ? data.tech_stack : null,
    data.growth_signal,
    data.founded_year,
    data.public_or_private,
  ];

  const populatedFields = enrichmentFields.filter(field => {
    if (typeof field === 'string') return field.trim().length > 0;
    if (typeof field === 'number') return true;
    if (Array.isArray(field)) return field.length > 0;
    return false;
  });

  const enrichmentFieldCount = populatedFields.length;

  // Insufficient data: fewer than 2 enrichment fields
  if (enrichmentFieldCount < 2) {
    return 0.3; // Has identifier but minimal enrichment
  }

  // Check for high-value field combinations
  const hasIndustry = !!data.industry && data.industry.trim().length > 0;
  const hasEmployeeCount = data.employee_count != null && data.employee_count > 0;
  const hasRevenueRange = !!data.revenue_range && data.revenue_range.trim().length > 0;
  const hasTechStack = !!data.tech_stack && data.tech_stack.length > 0;

  // High confidence: domain + industry + employee_count + revenue_range + tech_stack
  if (hasDomain && hasIndustry && hasEmployeeCount && hasRevenueRange && hasTechStack) {
    return 0.95;
  }

  // Medium-high: domain + 4 of the high-value fields
  if (hasDomain && enrichmentFieldCount >= 4) {
    const highValueCount = [hasIndustry, hasEmployeeCount, hasRevenueRange, hasTechStack].filter(Boolean).length;
    if (highValueCount >= 3) return 0.85;
  }

  // Medium: domain + industry + employee_count (core firmographic signals)
  if (hasDomain && hasIndustry && hasEmployeeCount) {
    return 0.75;
  }

  // Low-medium: domain + industry OR employee data
  if (hasDomain && (hasIndustry || hasEmployeeCount)) {
    return 0.65;
  }

  // Low: domain or company_name + at least 2 other fields
  if ((hasDomain || hasCompanyName) && enrichmentFieldCount >= 2) {
    return 0.55;
  }

  // Fallback: has identifier + 1 field
  if ((hasDomain || hasCompanyName) && enrichmentFieldCount >= 1) {
    return 0.45;
  }

  // Minimum score for records with identifiers
  return 0.3;
}

/**
 * Get confidence score label for display in UI.
 */
export function getConfidenceLabel(score: number): string {
  if (score >= 0.9) return 'High';
  if (score >= 0.7) return 'Medium';
  if (score >= 0.5) return 'Low';
  return 'Insufficient';
}

/**
 * Calculate average confidence score for a workspace.
 * Used to determine ICP Profile setup status.
 */
export function calculateAverageConfidence(scores: number[]): number {
  if (scores.length === 0) return 0;
  const sum = scores.reduce((acc, score) => acc + score, 0);
  return sum / scores.length;
}

/**
 * Determine if ICP Profile setup is ready based on enrichment confidence.
 *
 * Returns:
 * - 'not_started': No enriched accounts
 * - 'partial': At least 1 account with confidence > 0.5, but average < 0.7
 * - 'ready': Average confidence >= 0.7
 */
export function getICPProfileStatus(scores: number[]): 'not_started' | 'partial' | 'ready' {
  if (scores.length === 0) return 'not_started';

  const highConfidenceCount = scores.filter(s => s > 0.5).length;
  if (highConfidenceCount === 0) return 'not_started';

  const avgConfidence = calculateAverageConfidence(scores);
  return avgConfidence >= 0.7 ? 'ready' : 'partial';
}
