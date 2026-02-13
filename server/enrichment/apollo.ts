import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Apollo');

const APOLLO_API_BASE = 'https://api.apollo.io/api/v1/people/match';
const RATE_LIMIT_DELAY_MS = 500;
const RATE_LIMIT_BACKOFF_MS = 60000;
const MAX_RETRIES = 1;

const SENIORITY_MAP: Record<string, string> = {
  'owner': 'c_level',
  'founder': 'c_level',
  'c_suite': 'c_level',
  'partner': 'vp',
  'vp': 'vp',
  'director': 'director',
  'manager': 'manager',
  'senior': 'ic',
  'entry': 'ic',
};

export interface ApolloPersonResult {
  found: boolean;
  verified_email: string | null;
  current_title: string | null;
  seniority: string | null;
  department: string | null;
  linkedin_url: string | null;
  company_name: string | null;
  company_size: string | null;
  company_industry: string | null;
  raw_data: Record<string, any>;
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mapSeniority(apolloLabel: string | null): string | null {
  if (!apolloLabel) return null;
  const normalized = apolloLabel.toLowerCase().trim();
  return SENIORITY_MAP[normalized] || null;
}

async function callApolloAPI(
  email: string,
  apiKey: string,
  retryCount: number = 0
): Promise<Record<string, any> | null> {
  try {
    const response = await fetch(APOLLO_API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        api_key: apiKey,
      }),
    });

    if (response.status === 429) {
      if (retryCount < MAX_RETRIES) {
        logger.warn('Rate limited by Apollo, backing off', { email, retryCount });
        await delay(RATE_LIMIT_BACKOFF_MS);
        return callApolloAPI(email, apiKey, retryCount + 1);
      } else {
        logger.warn('Rate limit backoff exhausted, returning null', { email });
        return null;
      }
    }

    if (!response.ok) {
      logger.warn('Apollo API error', { email, status: response.status });
      return null;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    logger.error('Failed to call Apollo API', error instanceof Error ? error : new Error(String(error)), { email });
    return null;
  }
}

function parseApolloResponse(data: Record<string, any>): ApolloPersonResult {
  if (!data || !data.person) {
    return {
      found: false,
      verified_email: null,
      current_title: null,
      seniority: null,
      department: null,
      linkedin_url: null,
      company_name: null,
      company_size: null,
      company_industry: null,
      raw_data: {},
    };
  }

  const person = data.person;
  const organization = data.organization || {};

  return {
    found: true,
    verified_email: person.email || null,
    current_title: person.title || null,
    seniority: mapSeniority(person.seniority_level),
    department: person.department || null,
    linkedin_url: person.linkedin_url || null,
    company_name: organization.name || null,
    company_size: organization.size || null,
    company_industry: organization.industry || null,
    raw_data: data,
  };
}

export async function enrichContactViaApollo(
  email: string,
  apiKey: string
): Promise<ApolloPersonResult> {
  logger.debug('Enriching contact via Apollo', { email });

  const response = await callApolloAPI(email, apiKey);
  if (!response) {
    return {
      found: false,
      verified_email: null,
      current_title: null,
      seniority: null,
      department: null,
      linkedin_url: null,
      company_name: null,
      company_size: null,
      company_industry: null,
      raw_data: {},
    };
  }

  return parseApolloResponse(response);
}

export async function enrichBatchViaApollo(
  contacts: { email: string; dealContactId: string }[],
  apiKey: string,
  cacheDays: number
): Promise<{
  enrichedCount: number;
  cachedCount: number;
  failedCount: number;
}> {
  logger.info('Starting batch enrichment', { contactCount: contacts.length, cacheDays });

  let enrichedCount = 0;
  let cachedCount = 0;
  let failedCount = 0;

  for (const contact of contacts) {
    try {
      const cachedData = await query(
        `SELECT apollo_data, enriched_at FROM deal_contacts
         WHERE id = $1 AND apollo_data IS NOT NULL AND enriched_at IS NOT NULL`,
        [contact.dealContactId]
      );

      if (cachedData.rows.length > 0) {
        const row = cachedData.rows[0];
        const enrichedAt = new Date(row.enriched_at);
        const now = new Date();
        const ageInDays = (now.getTime() - enrichedAt.getTime()) / (1000 * 60 * 60 * 24);

        if (ageInDays <= cacheDays) {
          cachedCount++;
          logger.debug('Using cached Apollo data', { dealContactId: contact.dealContactId, ageInDays });
          await delay(RATE_LIMIT_DELAY_MS);
          continue;
        }
      }

      const result = await enrichContactViaApollo(contact.email, apiKey);

      if (result.found) {
        await query(
          `UPDATE deal_contacts SET apollo_data = $1, enriched_at = NOW(), enrichment_status = 'enriched'
           WHERE id = $2`,
          [JSON.stringify(result.raw_data), contact.dealContactId]
        );
        enrichedCount++;
        logger.debug('Enriched contact via Apollo', { dealContactId: contact.dealContactId });
      } else {
        await query(
          `UPDATE deal_contacts SET enrichment_status = 'not_found', enriched_at = NOW()
           WHERE id = $1`,
          [contact.dealContactId]
        );
        failedCount++;
        logger.debug('Apollo enrichment returned no data', { dealContactId: contact.dealContactId });
      }

      await delay(RATE_LIMIT_DELAY_MS);
    } catch (error) {
      failedCount++;
      logger.error('Batch enrichment error for contact', error instanceof Error ? error : new Error(String(error)), {
        dealContactId: contact.dealContactId,
        email: contact.email,
      });
    }
  }

  logger.info('Batch enrichment complete', { enrichedCount, cachedCount, failedCount });

  return { enrichedCount, cachedCount, failedCount };
}
