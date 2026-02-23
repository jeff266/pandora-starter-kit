/**
 * Apollo Enrichment Service
 *
 * Orchestrates end-to-end enrichment workflow:
 * 1. Get closed-won accounts from workspace
 * 2. Call Apollo API for each domain
 * 3. Normalize Apollo responses
 * 4. Match to CRM accounts
 * 5. Calculate confidence scores
 * 6. Save to enriched_accounts table
 */

import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { ApolloClient } from './apollo-client.js';

const logger = createLogger('Apollo Enrichment');
import { normalizeApolloOrganization } from './apollo-normalizer.js';
import { calculateConfidenceScore, type EnrichedAccountData } from './confidence-scorer.js';
import { getClosedWonAccountDomains, matchEnrichedAccount } from './account-matcher.js';

export interface EnrichmentResult {
  success: boolean;
  total_accounts: number;
  enriched_count: number;
  failed_count: number;
  average_confidence: number;
  errors: string[];
}

export interface EnrichmentProgress {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  current_domain?: string;
}

/**
 * Run full Apollo enrichment for a workspace.
 *
 * @param workspaceId - Target workspace ID
 * @param apiKey - Apollo API key
 * @param onProgress - Optional callback for progress updates
 */
export async function runApolloEnrichment(
  workspaceId: string,
  apiKey: string,
  onProgress?: (progress: EnrichmentProgress) => void
): Promise<EnrichmentResult> {
  logger.info('[Apollo Enrichment] Starting enrichment run', { workspace_id: workspaceId });

  const result: EnrichmentResult = {
    success: false,
    total_accounts: 0,
    enriched_count: 0,
    failed_count: 0,
    average_confidence: 0,
    errors: [],
  };

  try {
    // Step 1: Get all closed-won account domains
    const accounts = await getClosedWonAccountDomains(workspaceId);
    result.total_accounts = accounts.length;

    if (accounts.length === 0) {
      logger.warn('[Apollo Enrichment] No closed-won accounts found', { workspace_id: workspaceId });
      result.success = true;
      return result;
    }

    logger.info('[Apollo Enrichment] Found accounts to enrich', {
      workspace_id: workspaceId,
      count: accounts.length,
    });

    // Step 2: Initialize Apollo client
    const apolloClient = new ApolloClient(apiKey);

    // Step 3: Enrich each account
    const confidenceScores: number[] = [];
    let processed = 0;

    for (const account of accounts) {
      processed++;

      // Report progress
      if (onProgress) {
        onProgress({
          total: accounts.length,
          processed,
          succeeded: result.enriched_count,
          failed: result.failed_count,
          current_domain: account.domain,
        });
      }

      try {
        // Call Apollo API
        const apolloResponse = await apolloClient.enrichOrganization(account.domain);

        if (!apolloResponse.organization) {
          logger.warn('[Apollo Enrichment] No data returned for domain', { domain: account.domain });
          result.failed_count++;
          result.errors.push(`No data returned for ${account.domain}`);
          continue;
        }

        // Normalize Apollo response to Pandora schema
        const normalized = normalizeApolloOrganization(apolloResponse.organization);

        // Calculate confidence score
        const confidenceScore = calculateConfidenceScore(normalized);

        // Save to database
        await saveEnrichedAccount(
          workspaceId,
          account.crm_account_id,
          normalized,
          confidenceScore
        );

        confidenceScores.push(confidenceScore);
        result.enriched_count++;

        logger.info('[Apollo Enrichment] Account enriched successfully', {
          domain: account.domain,
          confidence: confidenceScore,
          company_name: normalized.company_name,
        });
      } catch (error) {
        logger.error('[Apollo Enrichment] Failed to enrich account', {
          domain: account.domain,
          error: error instanceof Error ? error.message : String(error),
        });
        result.failed_count++;
        result.errors.push(
          `${account.domain}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    // Calculate average confidence
    if (confidenceScores.length > 0) {
      result.average_confidence =
        confidenceScores.reduce((sum, score) => sum + score, 0) / confidenceScores.length;
    }

    result.success = true;

    logger.info('[Apollo Enrichment] Enrichment run complete', {
      workspace_id: workspaceId,
      total: result.total_accounts,
      enriched: result.enriched_count,
      failed: result.failed_count,
      average_confidence: result.average_confidence.toFixed(2),
    });

    return result;
  } catch (error) {
    logger.error('[Apollo Enrichment] Enrichment run failed', {
      workspace_id: workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });

    result.success = false;
    result.errors.push(error instanceof Error ? error.message : 'Unknown error');
    return result;
  }
}

/**
 * Save enriched account data to database.
 */
async function saveEnrichedAccount(
  workspaceId: string,
  crmAccountId: string,
  data: EnrichedAccountData,
  confidenceScore: number
): Promise<void> {
  try {
    // Check if record already exists
    const existing = await query(
      `SELECT id FROM enriched_accounts
       WHERE workspace_id = $1
         AND crm_account_id = $2
         AND enrichment_source = 'apollo'`,
      [workspaceId, crmAccountId]
    );

    if (existing.rows.length > 0) {
      // Update existing record
      await query(
        `UPDATE enriched_accounts
         SET domain = $1,
             company_name = $2,
             industry = $3,
             employee_count = $4,
             employee_range = $5,
             revenue_range = $6,
             funding_stage = $7,
             hq_country = $8,
             hq_state = $9,
             hq_city = $10,
             tech_stack = $11,
             growth_signal = $12,
             founded_year = $13,
             public_or_private = $14,
             confidence_score = $15,
             enriched_at = NOW(),
             updated_at = NOW()
         WHERE id = $16`,
        [
          data.domain,
          data.company_name,
          data.industry,
          data.employee_count,
          data.employee_range,
          data.revenue_range,
          data.funding_stage,
          data.hq_country,
          data.hq_state,
          data.hq_city,
          data.tech_stack,
          data.growth_signal,
          data.founded_year,
          data.public_or_private,
          confidenceScore,
          existing.rows[0].id,
        ]
      );

      logger.debug('[Apollo Enrichment] Updated existing enrichment record', {
        record_id: existing.rows[0].id,
        crm_account_id: crmAccountId,
      });
    } else {
      // Insert new record
      await query(
        `INSERT INTO enriched_accounts (
           workspace_id,
           crm_account_id,
           domain,
           company_name,
           industry,
           employee_count,
           employee_range,
           revenue_range,
           funding_stage,
           hq_country,
           hq_state,
           hq_city,
           tech_stack,
           growth_signal,
           founded_year,
           public_or_private,
           enrichment_source,
           confidence_score,
           enriched_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'apollo', $17, NOW())`,
        [
          workspaceId,
          crmAccountId,
          data.domain,
          data.company_name,
          data.industry,
          data.employee_count,
          data.employee_range,
          data.revenue_range,
          data.funding_stage,
          data.hq_country,
          data.hq_state,
          data.hq_city,
          data.tech_stack,
          data.growth_signal,
          data.founded_year,
          data.public_or_private,
          confidenceScore,
        ]
      );

      logger.debug('[Apollo Enrichment] Inserted new enrichment record', {
        crm_account_id: crmAccountId,
      });
    }
  } catch (error) {
    logger.error('[Apollo Enrichment] Failed to save enriched account', {
      crm_account_id: crmAccountId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get enrichment statistics for a workspace.
 */
export async function getEnrichmentStats(workspaceId: string): Promise<{
  total_enriched: number;
  apollo_count: number;
  webhook_count: number;
  csv_count: number;
  average_confidence: number;
  last_enrichment?: Date;
}> {
  try {
    const result = await query<{
      total_enriched: string;
      apollo_count: string;
      webhook_count: string;
      csv_count: string;
      average_confidence: string;
      last_enrichment: Date | null;
    }>(
      `SELECT
         COUNT(*) as total_enriched,
         COUNT(*) FILTER (WHERE enrichment_source = 'apollo') as apollo_count,
         COUNT(*) FILTER (WHERE enrichment_source = 'webhook') as webhook_count,
         COUNT(*) FILTER (WHERE enrichment_source = 'csv') as csv_count,
         AVG(confidence_score) as average_confidence,
         MAX(enriched_at) as last_enrichment
       FROM enriched_accounts
       WHERE workspace_id = $1`,
      [workspaceId]
    );

    const row = result.rows[0];

    return {
      total_enriched: parseInt(row.total_enriched),
      apollo_count: parseInt(row.apollo_count),
      webhook_count: parseInt(row.webhook_count),
      csv_count: parseInt(row.csv_count),
      average_confidence: parseFloat(row.average_confidence) || 0,
      last_enrichment: row.last_enrichment || undefined,
    };
  } catch (error) {
    logger.error('[Apollo Enrichment] Failed to get enrichment stats', {
      workspace_id: workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
