/**
 * Account Matching Logic
 *
 * Links enriched data to CRM accounts using domain (preferred) or fuzzy company name matching.
 */

import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Account Matcher');

export interface AccountMatch {
  crm_account_id: string;
  match_type: 'domain_exact' | 'name_fuzzy' | 'none';
  confidence: number; // 0.0 to 1.0
  crm_account_name?: string;
}

/**
 * Find matching CRM account for enriched data.
 *
 * Matching strategy:
 * 1. Exact domain match (confidence: 1.0)
 * 2. Fuzzy company name match (confidence: 0.5-0.9 based on similarity)
 * 3. No match (confidence: 0.0)
 */
export async function matchEnrichedAccount(
  workspaceId: string,
  domain: string | null,
  companyName: string | null
): Promise<AccountMatch> {
  // Strategy 1: Exact domain match (most reliable)
  if (domain) {
    const domainMatch = await matchByDomain(workspaceId, domain);
    if (domainMatch) {
      return {
        crm_account_id: domainMatch.id,
        match_type: 'domain_exact',
        confidence: 1.0,
        crm_account_name: domainMatch.name,
      };
    }
  }

  // Strategy 2: Fuzzy company name match
  if (companyName) {
    const nameMatch = await matchByCompanyName(workspaceId, companyName);
    if (nameMatch) {
      return {
        crm_account_id: nameMatch.id,
        match_type: 'name_fuzzy',
        confidence: nameMatch.similarity,
        crm_account_name: nameMatch.name,
      };
    }
  }

  // No match found
  return {
    crm_account_id: '',
    match_type: 'none',
    confidence: 0.0,
  };
}

/**
 * Match by exact domain.
 */
async function matchByDomain(
  workspaceId: string,
  domain: string
): Promise<{ id: string; name: string } | null> {
  try {
    const normalizedDomain = domain.toLowerCase().trim().replace(/^www\./, '');

    const result = await query<{ id: string; name: string }>(
      `SELECT id, name
       FROM accounts
       WHERE workspace_id = $1
         AND (
           LOWER(REPLACE(COALESCE(website, ''), 'www.', '')) = $2
           OR LOWER(REPLACE(COALESCE(domain, ''), 'www.', '')) = $2
         )
       LIMIT 1`,
      [workspaceId, normalizedDomain]
    );

    if (result.rows.length > 0) {
      logger.info('[Account Matcher] Domain match found', {
        domain,
        account_id: result.rows[0].id,
        account_name: result.rows[0].name,
      });
      return result.rows[0];
    }

    return null;
  } catch (error) {
    logger.error('[Account Matcher] Domain match error', {
      domain,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Match by fuzzy company name using PostgreSQL trigram similarity.
 * Returns best match above 0.5 similarity threshold.
 */
async function matchByCompanyName(
  workspaceId: string,
  companyName: string
): Promise<{ id: string; name: string; similarity: number } | null> {
  try {
    // Ensure pg_trgm extension is available for similarity matching
    await query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`, []);

    const result = await query<{ id: string; name: string; similarity: number }>(
      `SELECT id, name, SIMILARITY(LOWER(name), LOWER($2)) as similarity
       FROM accounts
       WHERE workspace_id = $1
         AND SIMILARITY(LOWER(name), LOWER($2)) > 0.5
       ORDER BY similarity DESC
       LIMIT 1`,
      [workspaceId, companyName]
    );

    if (result.rows.length > 0) {
      const match = result.rows[0];
      logger.info('[Account Matcher] Fuzzy name match found', {
        input_name: companyName,
        matched_name: match.name,
        similarity: match.similarity,
        account_id: match.id,
      });

      // Only return if similarity is reasonable (> 0.6 for auto-match)
      if (match.similarity >= 0.6) {
        return match;
      }

      // Log low-confidence matches for manual review
      logger.warn('[Account Matcher] Low-confidence match (manual review needed)', {
        input_name: companyName,
        matched_name: match.name,
        similarity: match.similarity,
      });
    }

    return null;
  } catch (error) {
    logger.error('[Account Matcher] Fuzzy name match error', {
      company_name: companyName,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Get all closed-won account domains for enrichment.
 */
export async function getClosedWonAccountDomains(
  workspaceId: string
): Promise<Array<{ domain: string; company_name: string; crm_account_id: string }>> {
  try {
    // Query accounts that have at least one closed-won deal
    const result = await query<{ domain: string; company_name: string; crm_account_id: string }>(
      `SELECT DISTINCT
         COALESCE(a.domain, a.website) as domain,
         a.name as company_name,
         a.id as crm_account_id
       FROM accounts a
       WHERE a.workspace_id = $1
         AND EXISTS (
           SELECT 1 FROM deals d
           WHERE d.account_id = a.id
             AND d.workspace_id = a.workspace_id
             AND d.stage = 'Closed Won'
         )
         AND (a.domain IS NOT NULL OR a.website IS NOT NULL)
       ORDER BY a.name`,
      [workspaceId]
    );

    logger.info('[Account Matcher] Found closed-won accounts', {
      workspace_id: workspaceId,
      count: result.rows.length,
    });

    return result.rows
      .map(row => ({
        domain: extractDomainFromUrl(row.domain),
        company_name: row.company_name,
        crm_account_id: row.crm_account_id,
      }))
      .filter(row => row.domain.length > 0);
  } catch (error) {
    logger.error('[Account Matcher] Failed to get closed-won domains', {
      workspace_id: workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Extract clean domain from URL string.
 */
function extractDomainFromUrl(urlString: string | null): string {
  if (!urlString) return '';

  try {
    const cleaned = urlString.trim().toLowerCase();
    // Add protocol if missing
    const withProtocol = cleaned.startsWith('http') ? cleaned : `https://${cleaned}`;
    const url = new URL(withProtocol);
    return url.hostname.replace(/^www\./, '');
  } catch {
    // If URL parsing fails, try to extract domain manually
    return urlString
      .trim()
      .toLowerCase()
      .replace(/^(https?:\/\/)?(www\.)?/, '')
      .split('/')[0];
  }
}
