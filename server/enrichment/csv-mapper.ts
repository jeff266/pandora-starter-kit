/**
 * CSV Column Mapper
 *
 * Auto-detects column mappings based on common column name variations.
 * Provides suggested mappings for user confirmation.
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('CSV Mapper');

export type PandoraField =
  | 'domain'
  | 'company_name'
  | 'industry'
  | 'employee_count'
  | 'employee_range'
  | 'revenue_range'
  | 'funding_stage'
  | 'hq_country'
  | 'hq_state'
  | 'hq_city'
  | 'tech_stack'
  | 'growth_signal'
  | 'founded_year'
  | 'public_or_private'
  | 'skip';

export interface ColumnMapping {
  source_column: string;
  pandora_field: PandoraField;
  confidence: 'high' | 'medium' | 'low';
}

export interface MappingSuggestion {
  mappings: ColumnMapping[];
  unmapped_columns: string[];
  has_required_fields: boolean;
}

// Column name variations per spec section 5.3
const MAPPING_PATTERNS: Record<PandoraField, string[]> = {
  domain: ['domain', 'website', 'company url', 'web address', 'url', 'site'],
  company_name: ['company', 'company name', 'account name', 'organization', 'org name', 'business name'],
  industry: ['industry', 'vertical', 'sector', 'market'],
  employee_count: ['employees', 'headcount', 'team size', '# employees', 'employee count', 'emp count', 'number of employees'],
  employee_range: ['employee range', 'size range', 'company size', 'emp range'],
  revenue_range: ['revenue', 'annual revenue', 'arr', 'estimated revenue', 'revenue range'],
  funding_stage: ['funding stage', 'funding round', 'funding', 'round', 'series'],
  hq_country: ['country', 'hq country', 'location (country)', 'headquarters country'],
  hq_state: ['state', 'province', 'region', 'hq state'],
  hq_city: ['city', 'hq city', 'headquarters city'],
  tech_stack: ['technologies', 'tech stack', 'tools used', 'software', 'technology', 'tools'],
  growth_signal: ['growth', 'growth signal', 'company growth', 'growth status'],
  founded_year: ['founded', 'year founded', 'est.', 'established', 'founded year', 'incorporation year'],
  public_or_private: ['public/private', 'ownership', 'company type', 'public or private', 'status'],
  skip: [],
};

/**
 * Auto-detect column mappings based on header names.
 */
export function suggestMappings(headers: string[]): MappingSuggestion {
  const mappings: ColumnMapping[] = [];
  const unmappedColumns: string[] = [];
  const usedFields = new Set<PandoraField>();

  for (const header of headers) {
    const normalized = header.toLowerCase().trim();
    let bestMatch: { field: PandoraField; confidence: 'high' | 'medium' | 'low' } | null = null;

    // Try to find best matching field
    for (const [field, patterns] of Object.entries(MAPPING_PATTERNS) as [PandoraField, string[]][]) {
      if (field === 'skip') continue;
      if (usedFields.has(field)) continue; // Avoid duplicate mappings

      for (const pattern of patterns) {
        const similarity = calculateSimilarity(normalized, pattern);

        if (similarity >= 0.9) {
          // Exact or very close match
          bestMatch = { field, confidence: 'high' };
          break;
        } else if (similarity >= 0.7 && (!bestMatch || bestMatch.confidence !== 'high')) {
          // Good match
          bestMatch = { field, confidence: 'medium' };
        } else if (similarity >= 0.5 && !bestMatch) {
          // Weak match
          bestMatch = { field, confidence: 'low' };
        }
      }

      if (bestMatch?.confidence === 'high') break; // Stop if we found exact match
    }

    if (bestMatch) {
      mappings.push({
        source_column: header,
        pandora_field: bestMatch.field,
        confidence: bestMatch.confidence,
      });
      usedFields.add(bestMatch.field);
    } else {
      unmappedColumns.push(header);
    }
  }

  // Check if required fields are present
  const hasDomain = usedFields.has('domain');
  const hasCompanyName = usedFields.has('company_name');
  const has_required_fields = hasDomain || hasCompanyName;

  logger.info('Column mappings suggested', {
    total_columns: headers.length,
    mapped: mappings.length,
    unmapped: unmappedColumns.length,
    has_required_fields,
  });

  return {
    mappings,
    unmapped_columns: unmappedColumns,
    has_required_fields,
  };
}

/**
 * Calculate similarity between two strings (0.0 to 1.0).
 * Uses a combination of exact match, contains, and Levenshtein distance.
 */
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  // Exact match
  if (s1 === s2) return 1.0;

  // Contains match
  if (s1.includes(s2) || s2.includes(s1)) return 0.85;

  // Word-based match (all words from pattern appear in column)
  const words1 = s1.split(/\s+/);
  const words2 = s2.split(/\s+/);

  const allWordsMatch = words2.every(word => words1.some(w => w.includes(word) || word.includes(w)));
  if (allWordsMatch) return 0.75;

  // Levenshtein distance
  const distance = levenshteinDistance(s1, s2);
  const maxLen = Math.max(s1.length, s2.length);
  const similarity = 1 - distance / maxLen;

  return Math.max(0, similarity);
}

/**
 * Calculate Levenshtein distance between two strings.
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]) + 1;
      }
    }
  }

  return dp[m][n];
}

/**
 * Validate a user-confirmed mapping.
 */
export function validateMapping(mappings: ColumnMapping[], headers: string[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const usedColumns = new Set<string>();
  const usedFields = new Set<PandoraField>();

  // Check that all source columns exist in headers
  for (const mapping of mappings) {
    if (!headers.includes(mapping.source_column)) {
      errors.push(`Source column "${mapping.source_column}" not found in file headers`);
    }

    // Check for duplicate source columns
    if (usedColumns.has(mapping.source_column)) {
      errors.push(`Duplicate mapping for column "${mapping.source_column}"`);
    }
    usedColumns.add(mapping.source_column);

    // Check for duplicate target fields (except 'skip')
    if (mapping.pandora_field !== 'skip') {
      if (usedFields.has(mapping.pandora_field)) {
        errors.push(`Field "${mapping.pandora_field}" is mapped multiple times`);
      }
      usedFields.add(mapping.pandora_field);
    }
  }

  // Check for required fields
  const hasDomain = usedFields.has('domain');
  const hasCompanyName = usedFields.has('company_name');

  if (!hasDomain && !hasCompanyName) {
    errors.push('At least one identifier field is required: domain or company_name');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Apply mapping to a row of data.
 */
export function applyMapping(row: Record<string, any>, mappings: ColumnMapping[]): Record<string, any> {
  const mapped: Record<string, any> = {};

  for (const mapping of mappings) {
    if (mapping.pandora_field === 'skip') continue;

    const value = row[mapping.source_column];
    if (value !== undefined && value !== null && value !== '') {
      mapped[mapping.pandora_field] = value;
    }
  }

  return mapped;
}
