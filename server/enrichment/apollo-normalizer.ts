/**
 * Apollo Response Normalizer
 *
 * Maps Apollo API response fields to Pandora's normalized enrichment schema.
 */

import type { ApolloOrganization } from './apollo-client.js';
import type { EnrichedAccountData } from './confidence-scorer.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Apollo Normalizer');

/**
 * Normalize Apollo organization data to Pandora schema.
 */
export function normalizeApolloOrganization(org: ApolloOrganization): EnrichedAccountData {
  return {
    domain: extractDomain(org),
    company_name: org.name || null,
    industry: org.industry || null,
    employee_count: org.estimated_num_employees || null,
    employee_range: deriveEmployeeRange(org.estimated_num_employees),
    revenue_range: org.annual_revenue_printed || null,
    funding_stage: deriveFundingStage(org.funding_total_usd),
    hq_country: org.country || null,
    hq_state: org.state || null,
    hq_city: org.city || null,
    tech_stack: org.technology_names || null,
    growth_signal: null, // Apollo doesn't provide growth signal
    founded_year: org.founded_year || null,
    public_or_private: deriveOwnershipType(org.publicly_traded_symbol),
  };
}

/**
 * Extract domain from Apollo response.
 * Prefers primary_domain, falls back to parsing website_url.
 */
function extractDomain(org: ApolloOrganization): string | null {
  // Prefer primary_domain if available
  if (org.primary_domain) {
    return org.primary_domain.toLowerCase().trim();
  }

  // Fall back to parsing website_url
  if (org.website_url) {
    try {
      const url = org.website_url.trim();
      // Add protocol if missing
      const urlWithProtocol = url.startsWith('http') ? url : `https://${url}`;
      const parsed = new URL(urlWithProtocol);
      return parsed.hostname.toLowerCase().replace(/^www\./, '');
    } catch (error) {
      logger.warn('[Apollo Normalizer] Failed to parse website_url', {
        website_url: org.website_url,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  return null;
}

/**
 * Derive employee range bucket from employee count.
 */
function deriveEmployeeRange(employeeCount: number | null): string | null {
  if (employeeCount === null || employeeCount === undefined) return null;

  if (employeeCount < 10) return '1-10';
  if (employeeCount < 50) return '11-50';
  if (employeeCount < 200) return '51-200';
  if (employeeCount < 500) return '201-500';
  if (employeeCount < 1000) return '501-1000';
  if (employeeCount < 5000) return '1001-5000';
  if (employeeCount < 10000) return '5001-10000';
  return '10000+';
}

/**
 * Derive funding stage from total funding amount (USD).
 * This is a rough heuristic since Apollo doesn't explicitly provide funding round.
 */
function deriveFundingStage(fundingTotalUsd: number | null): string | null {
  if (fundingTotalUsd === null || fundingTotalUsd === undefined) return null;
  if (fundingTotalUsd === 0) return 'Bootstrapped';

  // Rough bucketing based on typical funding rounds
  if (fundingTotalUsd < 2_000_000) return 'Seed';
  if (fundingTotalUsd < 15_000_000) return 'Series A';
  if (fundingTotalUsd < 50_000_000) return 'Series B';
  if (fundingTotalUsd < 100_000_000) return 'Series C';
  if (fundingTotalUsd < 200_000_000) return 'Series D+';
  return 'Late Stage';
}

/**
 * Derive ownership type from publicly traded symbol.
 */
function deriveOwnershipType(publiclyTradedSymbol: string | null): string | null {
  if (publiclyTradedSymbol && publiclyTradedSymbol.trim().length > 0) {
    return 'public';
  }
  return 'private'; // Default assumption if not public
}
