import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Apollo');

const APOLLO_API_BASE = 'https://api.apollo.io/api/v1/people/match';
const APOLLO_BULK_API = 'https://api.apollo.io/api/v1/people/bulk_match';
const RATE_LIMIT_DELAY_MS = 500;
const RATE_LIMIT_BACKOFF_MS = 60000;
const MAX_RETRIES = 1;
const BULK_BATCH_SIZE = 10; // Apollo allows up to 10 people per bulk call

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

/**
 * Call Apollo Bulk API to enrich multiple people at once (up to 10)
 */
async function callApolloBulkAPI(
  emails: string[],
  apiKey: string,
  retryCount: number = 0
): Promise<Record<string, any> | null> {
  if (emails.length === 0 || emails.length > BULK_BATCH_SIZE) {
    throw new Error(`Bulk API requires 1-${BULK_BATCH_SIZE} emails, got ${emails.length}`);
  }

  try {
    const details = emails.map(email => ({ email }));

    const response = await fetch(APOLLO_BULK_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        details,
      }),
    });

    if (response.status === 429) {
      if (retryCount < MAX_RETRIES) {
        logger.warn('Rate limited by Apollo bulk API, backing off', { emailCount: emails.length, retryCount });
        await delay(RATE_LIMIT_BACKOFF_MS);
        return callApolloBulkAPI(emails, apiKey, retryCount + 1);
      } else {
        logger.warn('Rate limit backoff exhausted for bulk API', { emailCount: emails.length });
        return null;
      }
    }

    if (!response.ok) {
      logger.warn('Apollo bulk API error', { emailCount: emails.length, status: response.status });
      return null;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    logger.error('Failed to call Apollo bulk API', error instanceof Error ? error : new Error(String(error)), {
      emailCount: emails.length,
    });
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
  logger.info('Starting batch enrichment with bulk API', { contactCount: contacts.length, cacheDays });

  let enrichedCount = 0;
  let cachedCount = 0;
  let failedCount = 0;

  // Phase 1: Check cache for all contacts
  const contactsToEnrich: { email: string; dealContactId: string }[] = [];

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
          continue;
        }
      }

      contactsToEnrich.push(contact);
    } catch (error) {
      logger.error('Cache check error', error instanceof Error ? error : new Error(String(error)), {
        dealContactId: contact.dealContactId,
      });
      contactsToEnrich.push(contact);
    }
  }

  if (contactsToEnrich.length === 0) {
    logger.info('All contacts cached, no enrichment needed');
    return { enrichedCount, cachedCount, failedCount };
  }

  logger.info('Contacts to enrich after cache check', {
    total: contacts.length,
    cached: cachedCount,
    toEnrich: contactsToEnrich.length,
  });

  // Phase 2: Enrich in batches of 10 using bulk API
  const batches: { email: string; dealContactId: string }[][] = [];
  for (let i = 0; i < contactsToEnrich.length; i += BULK_BATCH_SIZE) {
    batches.push(contactsToEnrich.slice(i, i + BULK_BATCH_SIZE));
  }

  logger.info('Processing bulk enrichment', { batchCount: batches.length, batchSize: BULK_BATCH_SIZE });

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const emails = batch.map(c => c.email);

    try {
      logger.debug('Calling Apollo bulk API', {
        batchIndex: batchIndex + 1,
        totalBatches: batches.length,
        emailCount: emails.length,
      });

      const bulkResponse = await callApolloBulkAPI(emails, apiKey);

      if (!bulkResponse || !bulkResponse.matches) {
        logger.warn('Bulk API returned no matches', { batchIndex, emailCount: emails.length });
        failedCount += batch.length;

        // Mark all as not_found
        for (const contact of batch) {
          await query(
            `UPDATE deal_contacts SET enrichment_status = 'not_found', enriched_at = NOW()
             WHERE id = $1`,
            [contact.dealContactId]
          );
        }

        await delay(RATE_LIMIT_DELAY_MS);
        continue;
      }

      // Process matches
      const matches = bulkResponse.matches || [];
      logger.debug('Bulk API returned matches', {
        batchIndex: batchIndex + 1,
        requestedCount: emails.length,
        matchedCount: matches.length,
      });

      // Create email → match map
      const matchMap = new Map<string, any>();
      for (const match of matches) {
        const email = match.email?.toLowerCase();
        if (email) {
          matchMap.set(email, match);
        }
      }

      // Update database for each contact
      for (const contact of batch) {
        const email = contact.email.toLowerCase();
        const match = matchMap.get(email);

        if (match) {
          // Store full match data (equivalent to single API response)
          const apolloData = {
            person: match,
            organization: match.organization || {},
          };

          await query(
            `UPDATE deal_contacts SET apollo_data = $1, enriched_at = NOW(), enrichment_status = 'enriched'
             WHERE id = $2`,
            [JSON.stringify(apolloData), contact.dealContactId]
          );
          enrichedCount++;
          logger.debug('Enriched contact via bulk API', {
            dealContactId: contact.dealContactId,
            email: contact.email,
          });
        } else {
          await query(
            `UPDATE deal_contacts SET enrichment_status = 'not_found', enriched_at = NOW()
             WHERE id = $1`,
            [contact.dealContactId]
          );
          failedCount++;
          logger.debug('Contact not found in bulk response', {
            dealContactId: contact.dealContactId,
            email: contact.email,
          });
        }
      }

      // Rate limit delay between batches
      await delay(RATE_LIMIT_DELAY_MS);
    } catch (error) {
      logger.error('Bulk enrichment error for batch', error instanceof Error ? error : new Error(String(error)), {
        batchIndex,
        emailCount: batch.length,
      });

      // Mark batch as failed
      failedCount += batch.length;
      for (const contact of batch) {
        await query(
          `UPDATE deal_contacts SET enrichment_status = 'error', enriched_at = NOW()
           WHERE id = $1`,
          [contact.dealContactId]
        );
      }
    }
  }

  logger.info('Batch enrichment complete', {
    total: contacts.length,
    enrichedCount,
    cachedCount,
    failedCount,
    bulkBatchesProcessed: batches.length,
  });

  return { enrichedCount, cachedCount, failedCount };
}
