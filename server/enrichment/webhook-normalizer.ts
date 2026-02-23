/**
 * Webhook Payload Normalizer
 *
 * Normalizes inbound webhook records to Pandora's enrichment schema.
 * Handles flexible field names and data formats from various sources (Clay, Zapier, Make, etc.).
 */

import type { EnrichedAccountData } from './confidence-scorer.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Webhook Normalizer');

export interface WebhookRecord {
  domain?: string | null;
  company_name?: string | null;
  industry?: string | null;
  employee_count?: number | string | null;
  employee_range?: string | null;
  revenue_range?: string | null;
  funding_stage?: string | null;
  hq_country?: string | null;
  hq_state?: string | null;
  hq_city?: string | null;
  tech_stack?: string[] | string | null;
  growth_signal?: string | null;
  founded_year?: number | string | null;
  public_or_private?: string | null;
  [key: string]: any; // Allow other fields to be ignored
}

export interface NormalizationResult {
  data: EnrichedAccountData;
  errors: string[];
}

/**
 * Normalize a webhook record to Pandora's enrichment schema.
 * Returns normalized data and any validation errors encountered.
 */
export function normalizeWebhookRecord(record: WebhookRecord): NormalizationResult {
  const errors: string[] = [];

  // Validate required identifiers
  if (!record.domain && !record.company_name) {
    errors.push('Missing required field: domain or company_name must be present');
  }

  // Normalize domain
  let domain: string | null = null;
  if (record.domain) {
    domain = normalizeDomain(record.domain);
    if (!domain) {
      errors.push(`Invalid domain format: ${record.domain}`);
    }
  }

  // Normalize employee_count
  let employeeCount: number | null = null;
  if (record.employee_count !== null && record.employee_count !== undefined) {
    const parsed = parseInteger(record.employee_count);
    if (parsed !== null) {
      employeeCount = parsed;
    } else {
      errors.push(`Invalid employee_count: ${record.employee_count}`);
    }
  }

  // Normalize founded_year
  let foundedYear: number | null = null;
  if (record.founded_year !== null && record.founded_year !== undefined) {
    const parsed = parseInteger(record.founded_year);
    if (parsed !== null && parsed >= 1800 && parsed <= new Date().getFullYear() + 1) {
      foundedYear = parsed;
    } else {
      errors.push(`Invalid founded_year: ${record.founded_year}`);
    }
  }

  // Normalize tech_stack
  let techStack: string[] | null = null;
  if (record.tech_stack !== null && record.tech_stack !== undefined) {
    techStack = normalizeTechStack(record.tech_stack);
  }

  const data: EnrichedAccountData = {
    domain,
    company_name: record.company_name || null,
    industry: record.industry || null,
    employee_count: employeeCount,
    employee_range: record.employee_range || null,
    revenue_range: record.revenue_range || null,
    funding_stage: record.funding_stage || null,
    hq_country: record.hq_country || null,
    hq_state: record.hq_state || null,
    hq_city: record.hq_city || null,
    tech_stack: techStack,
    growth_signal: record.growth_signal || null,
    founded_year: foundedYear,
    public_or_private: record.public_or_private || null,
  };

  return { data, errors };
}

/**
 * Normalize domain to lowercase, remove protocol and www.
 */
function normalizeDomain(domain: string): string | null {
  try {
    let cleaned = domain.trim().toLowerCase();

    // Remove protocol if present
    cleaned = cleaned.replace(/^https?:\/\//, '');

    // Remove www. prefix
    cleaned = cleaned.replace(/^www\./, '');

    // Remove trailing slash and path
    cleaned = cleaned.split('/')[0];

    // Basic validation: must contain at least one dot
    if (!cleaned.includes('.')) {
      return null;
    }

    return cleaned;
  } catch {
    return null;
  }
}

/**
 * Parse integer from string or number.
 */
function parseInteger(value: number | string): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : Math.floor(value);
  }

  if (typeof value === 'string') {
    // Remove commas and whitespace
    const cleaned = value.replace(/[,\s]/g, '');
    const parsed = parseInt(cleaned, 10);
    return isNaN(parsed) ? null : parsed;
  }

  return null;
}

/**
 * Normalize tech_stack to array of strings.
 * Accepts:
 * - Array of strings: ["Salesforce", "Gong"]
 * - Pipe-separated string: "Salesforce|Gong|Slack"
 * - Comma-separated string: "Salesforce, Gong, Slack"
 * - JSON string: '["Salesforce", "Gong"]'
 */
function normalizeTechStack(value: string[] | string): string[] | null {
  try {
    // Already an array
    if (Array.isArray(value)) {
      return value
        .filter(item => typeof item === 'string' && item.trim().length > 0)
        .map(item => item.trim());
    }

    // String value
    if (typeof value === 'string') {
      const trimmed = value.trim();

      // Try parsing as JSON array
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            return parsed
              .filter(item => typeof item === 'string' && item.trim().length > 0)
              .map(item => item.trim());
          }
        } catch {
          // Not valid JSON, continue to delimiter parsing
        }
      }

      // Pipe-separated
      if (trimmed.includes('|')) {
        return trimmed
          .split('|')
          .map(item => item.trim())
          .filter(item => item.length > 0);
      }

      // Comma-separated
      if (trimmed.includes(',')) {
        return trimmed
          .split(',')
          .map(item => item.trim())
          .filter(item => item.length > 0);
      }

      // Single value
      return [trimmed];
    }

    return null;
  } catch (error) {
    logger.warn('Failed to normalize tech_stack', {
      value,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Validate inbound payload structure.
 */
export function validateInboundPayload(payload: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!payload || typeof payload !== 'object') {
    errors.push('Payload must be a JSON object');
    return { valid: false, errors };
  }

  if (!payload.pandora_batch_id || typeof payload.pandora_batch_id !== 'string') {
    errors.push('Missing or invalid pandora_batch_id');
  }

  if (!payload.records || !Array.isArray(payload.records)) {
    errors.push('Missing or invalid records array');
  }

  if (payload.records && payload.records.length === 0) {
    errors.push('Records array is empty');
  }

  return { valid: errors.length === 0, errors };
}
