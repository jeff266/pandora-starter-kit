/**
 * Apollo.io API Client
 *
 * Handles API calls to Apollo Organization Enrichment endpoint.
 * Rate limit: 600 requests/minute on paid plans.
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('Apollo Client');

const APOLLO_API_BASE = 'https://api.apollo.io';
const APOLLO_ENRICH_ENDPOINT = '/v1/organizations/enrich';
const RATE_LIMIT_DELAY_MS = 200; // 200ms between requests = 300 req/min (conservative)

export interface ApolloOrganization {
  name: string | null;
  website_url: string | null;
  primary_domain: string | null;
  industry: string | null;
  estimated_num_employees: number | null;
  annual_revenue_printed: string | null;
  funding_total_usd: number | null;
  country: string | null;
  state: string | null;
  city: string | null;
  technology_names: string[] | null;
  founded_year: number | null;
  publicly_traded_symbol: string | null;
  [key: string]: any;
}

export interface ApolloEnrichResponse {
  organization: ApolloOrganization | null;
  status?: string;
  error?: string;
}

export class ApolloClient {
  private apiKey: string;
  private lastRequestTime: number = 0;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Enrich a single organization by domain.
   * Automatically rate-limits to stay within Apollo's limits.
   */
  async enrichOrganization(domain: string): Promise<ApolloEnrichResponse> {
    // Rate limiting: ensure 200ms between requests
    await this.enforceRateLimit();

    const url = `${APOLLO_API_BASE}${APOLLO_ENRICH_ENDPOINT}`;
    const body = {
      api_key: this.apiKey,
      domain: domain.trim().toLowerCase(),
    };

    try {
      logger.info('[Apollo] Enriching organization', { domain });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('[Apollo] API error', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          domain,
        });

        // Handle specific error codes
        if (response.status === 401 || response.status === 403) {
          throw new Error('Apollo API authentication failed. Check your API key.');
        }

        if (response.status === 429) {
          throw new Error('Apollo rate limit exceeded. Please slow down requests.');
        }

        if (response.status >= 500) {
          throw new Error(`Apollo API server error (${response.status}). Try again later.`);
        }

        throw new Error(`Apollo API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (!(data as any).organization) {
        logger.warn('[Apollo] No organization data returned', { domain });
        return { organization: null };
      }

      logger.info('[Apollo] Organization enriched successfully', {
        domain,
        name: (data as any).organization.name,
      });

      return data as ApolloEnrichResponse;
    } catch (error) {
      if (error instanceof Error) {
        logger.error('[Apollo] Enrichment failed', { domain, error: error.message });
        throw error;
      }
      throw new Error(`Unknown error enriching ${domain}`);
    }
  }

  /**
   * Batch enrich multiple organizations.
   * Processes sequentially with rate limiting.
   */
  async enrichOrganizations(domains: string[]): Promise<Map<string, ApolloEnrichResponse>> {
    const results = new Map<string, ApolloEnrichResponse>();

    logger.info('[Apollo] Starting batch enrichment', { count: domains.length });

    for (const domain of domains) {
      try {
        const result = await this.enrichOrganization(domain);
        results.set(domain, result);
      } catch (error) {
        logger.error('[Apollo] Failed to enrich domain', {
          domain,
          error: error instanceof Error ? error.message : String(error),
        });
        results.set(domain, {
          organization: null,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    logger.info('[Apollo] Batch enrichment complete', {
      total: domains.length,
      succeeded: Array.from(results.values()).filter(r => r.organization !== null).length,
      failed: Array.from(results.values()).filter(r => r.organization === null).length,
    });

    return results;
  }

  /**
   * Enforce rate limit by delaying if necessary.
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < RATE_LIMIT_DELAY_MS) {
      const delayNeeded = RATE_LIMIT_DELAY_MS - timeSinceLastRequest;
      await this.sleep(delayNeeded);
    }

    this.lastRequestTime = Date.now();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Test Apollo API key validity.
 * Makes a single enrichment call with a known domain.
 */
export async function testApolloApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const client = new ApolloClient(apiKey);
    // Test with a well-known domain
    const result = await client.enrichOrganization('salesforce.com');

    if (result.error) {
      return { valid: false, error: result.error };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Invalid API key',
    };
  }
}
