import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { resolveContactRoles } from './resolve-contact-roles.js';
import { enrichBatchViaApollo } from './apollo.js';
import { enrichAccountWithSignals, classifyAccountSignalsBatch } from './classify-signals.js';
import { getEnrichmentConfig } from './config.js';
import { searchCompanySignalsBatch } from './serper.js';
import pLimit from 'p-limit';

const logger = createLogger('ClosedDealEnrichment');

export interface EnrichmentResult {
  dealId: string;
  dealName: string;
  outcome: 'won' | 'lost';
  contactResolution: {
    contactCount: number;
    rolesResolved: number;
    rolesSummary: Record<string, number>;
  };
  apolloEnrichment: {
    enrichedCount: number;
    cachedCount: number;
    failedCount: number;
  };
  accountSignals: {
    signalCount: number;
    signalScore: number;
    topSignals: string[];
  };
  linkedinEnrichment: null;
  durationMs: number;
}

export async function enrichClosedDeal(
  workspaceId: string,
  dealId: string
): Promise<EnrichmentResult> {
  const startTime = Date.now();
  logger.info('Starting closed deal enrichment', { workspaceId, dealId });

  const dealResult = await query(
    `SELECT d.id, d.name, d.stage_normalized, d.close_date, d.amount,
            a.name as account_name, a.id as account_id
     FROM deals d
     LEFT JOIN accounts a ON a.id = d.account_id AND a.workspace_id = d.workspace_id
     WHERE d.id = $1 AND d.workspace_id = $2`,
    [dealId, workspaceId]
  );

  if (dealResult.rows.length === 0) {
    throw new Error(`Deal ${dealId} not found in workspace ${workspaceId}`);
  }

  const deal = dealResult.rows[0];
  const outcome: 'won' | 'lost' = deal.stage_normalized === 'closed_won' ? 'won' : 'lost';
  const accountId: string | null = deal.account_id || null;
  const accountName: string = deal.account_name || '';

  const connResult = await query(
    `SELECT connector_name FROM connections
     WHERE workspace_id = $1 AND connector_name IN ('hubspot', 'salesforce') AND status IN ('active', 'healthy') LIMIT 1`,
    [workspaceId]
  );

  const source: 'hubspot' | 'salesforce' = connResult.rows.length > 0
    ? connResult.rows[0].connector_name as 'hubspot' | 'salesforce'
    : 'hubspot';

  const contactResolution = await resolveContactRoles(workspaceId, dealId, source);

  const config = await getEnrichmentConfig(workspaceId);

  let apolloEnrichment = { enrichedCount: 0, cachedCount: 0, failedCount: 0 };

  if (config.apolloApiKey) {
    const contactsResult = await query(
      `SELECT dc.id, c.email FROM deal_contacts dc
       JOIN contacts c ON c.id = dc.contact_id AND c.workspace_id = dc.workspace_id
       WHERE dc.deal_id = $1 AND dc.workspace_id = $2
         AND c.email IS NOT NULL
         AND dc.enriched_at IS NULL`,
      [dealId, workspaceId]
    );

    const contacts = contactsResult.rows.map((r: any) => ({
      email: r.email,
      dealContactId: r.id,
    }));

    if (contacts.length > 0) {
      apolloEnrichment = await enrichBatchViaApollo(contacts, config.apolloApiKey, config.cacheDays);

      const enrichedContacts = await query(
        `SELECT dc.id, dc.buying_role, dc.role_source, dc.apollo_data
         FROM deal_contacts dc
         WHERE dc.deal_id = $1 AND dc.workspace_id = $2
           AND dc.apollo_data IS NOT NULL`,
        [dealId, workspaceId]
      );

      for (const dc of enrichedContacts.rows) {
        const apolloData = typeof dc.apollo_data === 'string' ? JSON.parse(dc.apollo_data) : dc.apollo_data;
        const person = apolloData?.person;
        if (!person) continue;

        const seniority = person.seniority_level?.toLowerCase?.();
        if (
          seniority &&
          ['owner', 'founder', 'c_suite'].includes(seniority) &&
          (!dc.buying_role || dc.role_source === 'title_match')
        ) {
          await query(
            `UPDATE deal_contacts
             SET buying_role = 'decision_maker', role_confidence = 0.75, role_source = 'apollo_seniority', updated_at = NOW()
             WHERE id = $1`,
            [dc.id]
          );
        }
      }
    }
  } else {
    logger.info('Skipping Apollo enrichment - no API key configured', { workspaceId, dealId });
  }

  let accountSignals = { signalCount: 0, signalScore: 0, topSignals: [] as string[] };

  if (config.serperApiKey && accountId) {
    const signalResult = await enrichAccountWithSignals(
      workspaceId, accountId, accountName, config.serperApiKey, config.cacheDays
    );
    accountSignals.signalCount = signalResult.signalCount;
    accountSignals.signalScore = signalResult.signalScore;

    const signalsData = await query(
      `SELECT signals FROM account_signals
       WHERE workspace_id = $1 AND account_id = $2
       ORDER BY enriched_at DESC LIMIT 1`,
      [workspaceId, accountId]
    );

    if (signalsData.rows.length > 0) {
      const signals = signalsData.rows[0].signals;
      const parsed = typeof signals === 'string' ? JSON.parse(signals) : signals;
      if (Array.isArray(parsed)) {
        accountSignals.topSignals = parsed
          .sort((a: any, b: any) => (b.relevance || 0) - (a.relevance || 0))
          .slice(0, 5)
          .map((s: any) => s.signal || s.type || '');
      }
    }
  } else {
    logger.info('Skipping Serper enrichment - no API key or no account', { workspaceId, dealId });
  }

  logger.info('LinkedIn enrichment not yet implemented');

  const apolloContacts = await query(
    `SELECT dc.id, dc.apollo_data
     FROM deal_contacts dc
     WHERE dc.deal_id = $1 AND dc.workspace_id = $2
       AND dc.apollo_data IS NOT NULL`,
    [dealId, workspaceId]
  );

  for (const dc of apolloContacts.rows) {
    const apolloData = typeof dc.apollo_data === 'string' ? JSON.parse(dc.apollo_data) : dc.apollo_data;
    const person = apolloData?.person;
    if (!person) {
      await query(
        `UPDATE deal_contacts SET enrichment_status = 'partial', updated_at = NOW() WHERE id = $1`,
        [dc.id]
      );
      continue;
    }

    let tenureMonths: number | null = null;
    if (person.employment_history && Array.isArray(person.employment_history) && person.employment_history.length > 0) {
      const current = person.employment_history[0];
      if (current.start_date) {
        const start = new Date(current.start_date);
        const now = new Date();
        tenureMonths = Math.round((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30));
      }
    }

    const seniorityVerified = person.seniority_level || null;
    const departmentVerified = person.department || null;

    await query(
      `UPDATE deal_contacts
       SET enrichment_status = 'enriched',
           tenure_months = COALESCE($2, tenure_months),
           seniority_verified = COALESCE($3, seniority_verified),
           department_verified = COALESCE($4, department_verified),
           updated_at = NOW()
       WHERE id = $1`,
      [dc.id, tenureMonths, seniorityVerified, departmentVerified]
    );
  }

  const durationMs = Date.now() - startTime;

  logger.info('Closed deal enrichment complete', {
    workspaceId, dealId, outcome, durationMs,
    contactCount: contactResolution.contactCount,
    rolesResolved: contactResolution.rolesResolved,
    apolloEnriched: apolloEnrichment.enrichedCount,
    signalCount: accountSignals.signalCount,
  });

  return {
    dealId,
    dealName: deal.name || '',
    outcome,
    contactResolution,
    apolloEnrichment,
    accountSignals,
    linkedinEnrichment: null,
    durationMs,
  };
}

export async function reEnrichExistingDealContacts(
  workspaceId: string,
  options: {
    resolveRoles?: boolean;
    runApollo?: boolean;
    runSerper?: boolean;
    apolloLimit?: number;
    serperLimit?: number;
  } = {}
): Promise<{
  rolesResolved: number;
  apolloEnriched: number;
  apolloFailed: number;
  accountsSignaled: number;
  errors: string[];
}> {
  const {
    resolveRoles = true,
    runApollo = true,
    runSerper = true,
    apolloLimit = 500,
    serperLimit = 100,
  } = options;

  logger.info('Starting re-enrichment of existing deal contacts', { workspaceId, resolveRoles, runApollo, runSerper });

  const config = await getEnrichmentConfig(workspaceId);
  const errors: string[] = [];
  let totalRolesResolved = 0;
  let totalApolloEnriched = 0;
  let totalApolloFailed = 0;
  let totalAccountsSignaled = 0;

  const connResult = await query(
    `SELECT connector_name FROM connections
     WHERE workspace_id = $1 AND connector_name IN ('hubspot', 'salesforce') AND status IN ('active', 'healthy') LIMIT 1`,
    [workspaceId]
  );
  const source: 'hubspot' | 'salesforce' = connResult.rows.length > 0
    ? connResult.rows[0].connector_name as 'hubspot' | 'salesforce'
    : 'hubspot';

  if (resolveRoles) {
    const closedDeals = await query(
      `SELECT DISTINCT d.id FROM deals d
       JOIN deal_contacts dc ON dc.deal_id = d.id AND dc.workspace_id = d.workspace_id
       WHERE d.workspace_id = $1 AND d.stage_normalized IN ('closed_won', 'closed_lost')
       AND (dc.buying_role IS NULL OR dc.role_confidence < 0.5)
       ORDER BY d.id`,
      [workspaceId]
    );

    logger.info('Resolving contact roles', { dealsToProcess: closedDeals.rows.length });

    for (const deal of closedDeals.rows) {
      try {
        const result = await resolveContactRoles(workspaceId, deal.id, source);
        totalRolesResolved += result.rolesResolved;
      } catch (err: any) {
        errors.push(`Role resolution failed for deal ${deal.id}: ${err.message}`);
        logger.error('Role resolution failed', err instanceof Error ? err : new Error(String(err)), { dealId: deal.id });
      }
    }
    logger.info('Contact role resolution complete', { totalRolesResolved });
  }

  if (runApollo && config.apolloApiKey) {
    const pendingContacts = await query(
      `SELECT dc.id, c.email FROM deal_contacts dc
       JOIN contacts c ON c.id = dc.contact_id AND c.workspace_id = dc.workspace_id
       JOIN deals d ON d.id = dc.deal_id AND d.workspace_id = dc.workspace_id
       WHERE dc.workspace_id = $1
         AND d.stage_normalized IN ('closed_won', 'closed_lost')
         AND c.email IS NOT NULL
         AND (dc.enrichment_status IS NULL OR dc.enrichment_status = 'pending')
         AND (dc.apollo_data IS NULL OR dc.apollo_data::text = '{}' OR dc.apollo_data::text = 'null')
       ORDER BY d.close_date DESC
       LIMIT $2`,
      [workspaceId, apolloLimit]
    );

    logger.info('Running Apollo enrichment on pending contacts', { contactCount: pendingContacts.rows.length });

    const contacts = pendingContacts.rows.map((r: any) => ({
      email: r.email,
      dealContactId: r.id,
    }));

    if (contacts.length > 0) {
      const apolloResult = await enrichBatchViaApollo(contacts, config.apolloApiKey, config.cacheDays);
      totalApolloEnriched = apolloResult.enrichedCount;
      totalApolloFailed = apolloResult.failedCount;

      const enrichedContacts = await query(
        `SELECT dc.id, dc.buying_role, dc.role_source, dc.apollo_data
         FROM deal_contacts dc
         WHERE dc.workspace_id = $1
           AND dc.apollo_data IS NOT NULL AND dc.apollo_data::text != '{}'
           AND (dc.enrichment_status IS NULL OR dc.enrichment_status = 'pending')`,
        [workspaceId]
      );

      for (const dc of enrichedContacts.rows) {
        const apolloData = typeof dc.apollo_data === 'string' ? JSON.parse(dc.apollo_data) : dc.apollo_data;
        const person = apolloData?.person;
        if (!person) continue;

        const seniority = person.seniority_level?.toLowerCase?.();
        if (
          seniority &&
          ['owner', 'founder', 'c_suite'].includes(seniority) &&
          (!dc.buying_role || dc.role_source === 'title_match')
        ) {
          await query(
            `UPDATE deal_contacts
             SET buying_role = 'decision_maker', role_confidence = 0.75, role_source = 'apollo_seniority', updated_at = NOW()
             WHERE id = $1`,
            [dc.id]
          );
        }

        const seniorityVerified = person.seniority_level || null;
        const departmentVerified = person.department || null;
        let tenureMonths: number | null = null;
        if (person.employment_history && Array.isArray(person.employment_history) && person.employment_history.length > 0) {
          const current = person.employment_history[0];
          if (current.start_date) {
            const start = new Date(current.start_date);
            const now = new Date();
            tenureMonths = Math.round((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30));
          }
        }

        await query(
          `UPDATE deal_contacts
           SET enrichment_status = 'enriched',
               tenure_months = COALESCE($2, tenure_months),
               seniority_verified = COALESCE($3, seniority_verified),
               department_verified = COALESCE($4, department_verified),
               updated_at = NOW()
           WHERE id = $1`,
          [dc.id, tenureMonths, seniorityVerified, departmentVerified]
        );
      }
    }

    logger.info('Apollo enrichment complete', { totalApolloEnriched, totalApolloFailed });
  } else if (runApollo && !config.apolloApiKey) {
    errors.push('Apollo enrichment skipped: no API key configured');
  }

  if (runSerper && config.serperApiKey) {
    const accountsNeedingSignals = await query(
      `SELECT DISTINCT a.id, a.name FROM accounts a
       JOIN deals d ON d.account_id = a.id AND d.workspace_id = a.workspace_id
       LEFT JOIN account_signals asi ON asi.account_id = a.id AND asi.workspace_id = a.workspace_id
       WHERE a.workspace_id = $1
         AND d.stage_normalized IN ('closed_won', 'closed_lost')
         AND a.name IS NOT NULL AND a.name != ''
         AND asi.id IS NULL
       ORDER BY a.name
       LIMIT $2`,
      [workspaceId, serperLimit]
    );

    logger.info('Running Serper enrichment on accounts', { accountCount: accountsNeedingSignals.rows.length });

    for (const account of accountsNeedingSignals.rows) {
      try {
        const result = await enrichAccountWithSignals(
          workspaceId, account.id, account.name, config.serperApiKey, config.cacheDays
        );
        if (!result.cached) {
          totalAccountsSignaled++;
        }
      } catch (err: any) {
        errors.push(`Serper enrichment failed for account ${account.name}: ${err.message}`);
        logger.error('Serper enrichment failed', err instanceof Error ? err : new Error(String(err)), {
          accountId: account.id, accountName: account.name,
        });
      }
    }

    logger.info('Serper enrichment complete', { totalAccountsSignaled });
  } else if (runSerper && !config.serperApiKey) {
    errors.push('Serper enrichment skipped: no API key configured');
  }

  logger.info('Re-enrichment complete', {
    totalRolesResolved, totalApolloEnriched, totalApolloFailed, totalAccountsSignaled, errorCount: errors.length,
  });

  return {
    rolesResolved: totalRolesResolved,
    apolloEnriched: totalApolloEnriched,
    apolloFailed: totalApolloFailed,
    accountsSignaled: totalAccountsSignaled,
    errors,
  };
}

export async function enrichClosedDealsInBatch(
  workspaceId: string,
  lookbackMonths: number = 6,
  limit: number = 50,
  concurrency: number = 5
): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  results: EnrichmentResult[];
  durationMs: number;
}> {
  const batchStartTime = Date.now();
  logger.info('Starting batch closed deal enrichment', { workspaceId, lookbackMonths, limit, concurrency });

  // If concurrency is 1, use sequential mode (original behavior)
  if (concurrency === 1) {
    return enrichClosedDealsInBatchSequential(workspaceId, lookbackMonths, limit);
  }

  // Parallel mode
  return enrichClosedDealsInBatchParallel(workspaceId, lookbackMonths, limit, concurrency);
}

/**
 * Sequential enrichment (original behavior, preserved as fallback)
 */
async function enrichClosedDealsInBatchSequential(
  workspaceId: string,
  lookbackMonths: number,
  limit: number
): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  results: EnrichmentResult[];
  durationMs: number;
}> {
  const startTime = Date.now();

  const dealsResult = await query(
    `SELECT d.id FROM deals d
     WHERE d.workspace_id = $1
       AND d.stage_normalized IN ('closed_won', 'closed_lost')
       AND d.close_date > NOW() - INTERVAL '1 month' * $2
       AND NOT EXISTS (
         SELECT 1 FROM deal_contacts dc
         WHERE dc.deal_id = d.id AND dc.workspace_id = d.workspace_id
           AND dc.enriched_at IS NOT NULL
       )
     ORDER BY d.close_date DESC
     LIMIT $3`,
    [workspaceId, lookbackMonths, limit]
  );

  const dealIds = dealsResult.rows.map((r: any) => r.id);
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const results: EnrichmentResult[] = [];

  for (const id of dealIds) {
    processed++;
    try {
      const result = await enrichClosedDeal(workspaceId, id);
      results.push(result);
      succeeded++;
    } catch (error) {
      failed++;
      logger.error('Failed to enrich deal in batch', error instanceof Error ? error : new Error(String(error)), {
        workspaceId, dealId: id,
      });
    }
  }

  const durationMs = Date.now() - startTime;
  logger.info('Sequential batch enrichment complete', { workspaceId, processed, succeeded, failed, durationMs });

  return { processed, succeeded, failed, results, durationMs };
}

/**
 * Parallel enrichment with controlled concurrency
 */
async function enrichClosedDealsInBatchParallel(
  workspaceId: string,
  lookbackMonths: number,
  limit: number,
  concurrency: number
): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  results: EnrichmentResult[];
  durationMs: number;
}> {
  const startTime = Date.now();

  // Get deals to enrich (deals without any Apollo-enriched contacts)
  const dealsResult = await query(
    `SELECT d.id, d.name, d.stage_normalized, a.id as account_id, a.name as account_name
     FROM deals d
     LEFT JOIN accounts a ON a.id = d.account_id AND a.workspace_id = d.workspace_id
     WHERE d.workspace_id = $1
       AND d.stage_normalized IN ('closed_won', 'closed_lost')
       AND d.close_date > NOW() - INTERVAL '1 month' * $2
       AND NOT EXISTS (
         SELECT 1 FROM deal_contacts dc
         WHERE dc.deal_id = d.id AND dc.workspace_id = d.workspace_id
           AND dc.enriched_at IS NOT NULL
       )
     ORDER BY d.close_date DESC
     LIMIT $3`,
    [workspaceId, lookbackMonths, limit]
  );

  const deals = dealsResult.rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    stage: r.stage_normalized,
    accountId: r.account_id,
    accountName: r.account_name,
  }));

  logger.info('Fetched deals for parallel enrichment', { dealCount: deals.length });

  const config = await getEnrichmentConfig(workspaceId);

  // Phase 1: Parallel Serper searches for account signals
  const phase1Start = Date.now();
  let serperResults = new Map<string, any[]>();

  if (config.serperApiKey) {
    const accountsToEnrich = deals
      .filter(d => d.accountId && d.accountName)
      .map(d => ({ id: d.accountId, name: d.accountName }));

    // Remove duplicates
    const uniqueAccounts = Array.from(
      new Map(accountsToEnrich.map(a => [a.id, a])).values()
    );

    // Check cache for accounts
    const cacheResult = await query(
      `SELECT account_id FROM account_signals
       WHERE workspace_id = $1 AND account_id = ANY($2)
         AND enriched_at > NOW() - ($3 || ' days')::interval`,
      [workspaceId, uniqueAccounts.map(a => a.id), config.cacheDays]
    );

    const cachedAccountIds = new Set(cacheResult.rows.map((r: any) => r.account_id));
    const accountsToFetch = uniqueAccounts.filter(a => !cachedAccountIds.has(a.id));

    logger.info('Serper cache check', {
      total: uniqueAccounts.length,
      cached: cachedAccountIds.size,
      toFetch: accountsToFetch.length,
    });

    if (accountsToFetch.length > 0) {
      logger.info('Starting parallel Serper searches', { accountCount: accountsToFetch.length });
      serperResults = await searchCompanySignalsBatch(accountsToFetch, config.serperApiKey);
      logger.info('Parallel Serper searches complete', { resultCount: serperResults.size });
    }
  }

  const phase1Duration = Date.now() - phase1Start;
  logger.info('Phase 1: Serper signal search complete', {
    durationMs: phase1Duration,
    accountsSearched: serperResults.size,
  });

  // Phase 2: Batch DeepSeek classification
  const phase2Start = Date.now();
  if (serperResults.size > 0) {
    const accountsForClassification = Array.from(serperResults.entries())
      .filter(([_, results]) => results.length > 0)
      .map(([accountId, searchResults]) => {
        const deal = deals.find(d => d.accountId === accountId);
        return {
          accountId,
          companyName: deal?.accountName || '',
          searchResults,
        };
      });

    // Process in batches of 5 for DeepSeek
    const batchSize = 5;
    logger.info('Starting batched DeepSeek classification', {
      accountCount: accountsForClassification.length,
      batchSize,
    });

    for (let i = 0; i < accountsForClassification.length; i += batchSize) {
      const batch = accountsForClassification.slice(i, i + batchSize);
      try {
        const classificationResults = await classifyAccountSignalsBatch(workspaceId, batch);

        // Store results in database
        for (const [accountId, result] of classificationResults.entries()) {
          await query(
            `INSERT INTO account_signals (workspace_id, account_id, signals, signal_summary, signal_score, enriched_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (workspace_id, account_id)
             DO UPDATE SET signals = $3, signal_summary = $4, signal_score = $5, enriched_at = NOW()`,
            [workspaceId, accountId, JSON.stringify(result.signals), result.signal_summary, result.signal_score]
          );
        }

        logger.info('Batch classification complete', {
          batchIndex: Math.floor(i / batchSize) + 1,
          totalBatches: Math.ceil(accountsForClassification.length / batchSize),
          accountsInBatch: batch.length,
        });
      } catch (error) {
        logger.error('Batch classification failed', error instanceof Error ? error : new Error(String(error)), {
          batchIndex: i / batchSize,
        });
      }
    }
  }

  const phase2Duration = Date.now() - phase2Start;
  logger.info('Phase 2: DeepSeek classification complete', {
    durationMs: phase2Duration,
    accountsClassified: serperResults.size,
  });

  // Phase 3A: Resolve contact roles across all deals in parallel
  const phase3aStart = Date.now();
  const limiter = pLimit(concurrency);

  const connResult = await query(
    `SELECT connector_name FROM connections
     WHERE workspace_id = $1 AND connector_name IN ('hubspot', 'salesforce') AND status IN ('active', 'healthy') LIMIT 1`,
    [workspaceId]
  );
  const source: 'hubspot' | 'salesforce' = connResult.rows.length > 0
    ? connResult.rows[0].connector_name as 'hubspot' | 'salesforce'
    : 'hubspot';

  const roleResults = new Map<string, { contactCount: number; rolesResolved: number; rolesSummary: Record<string, number> }>();

  await Promise.all(deals.map(deal =>
    limiter(async () => {
      try {
        const cr = await resolveContactRoles(workspaceId, deal.id, source);
        roleResults.set(deal.id, cr);
      } catch (error) {
        logger.error('Contact role resolution failed', error instanceof Error ? error : new Error(String(error)), { dealId: deal.id });
        roleResults.set(deal.id, { contactCount: 0, rolesResolved: 0, rolesSummary: {} });
      }
    })
  ));

  const phase3aDuration = Date.now() - phase3aStart;
  logger.info('Phase 3A: Contact role resolution complete', {
    dealCount: deals.length,
    durationMs: phase3aDuration,
  });

  // Phase 3B: Collect ALL unenriched contacts across ALL deals, dedupe by email, bulk Apollo
  const phase3bStart = Date.now();
  let apolloStats = { enrichedCount: 0, cachedCount: 0, failedCount: 0, bulkBatches: 0, uniqueEmails: 0, totalContacts: 0 };

  if (config.apolloApiKey) {
    const dealIds = deals.map(d => d.id);

    const allContactsResult = await query(
      `SELECT dc.id as deal_contact_id, dc.deal_id, c.email
       FROM deal_contacts dc
       JOIN contacts c ON c.id = dc.contact_id AND c.workspace_id = dc.workspace_id
       WHERE dc.deal_id = ANY($1) AND dc.workspace_id = $2
         AND c.email IS NOT NULL
         AND dc.enriched_at IS NULL`,
      [dealIds, workspaceId]
    );

    const allRows = allContactsResult.rows as Array<{ deal_contact_id: string; deal_id: string; email: string }>;
    apolloStats.totalContacts = allRows.length;

    const emailToDealContacts = new Map<string, string[]>();
    for (const row of allRows) {
      const email = row.email.toLowerCase();
      const existing = emailToDealContacts.get(email) || [];
      existing.push(row.deal_contact_id);
      emailToDealContacts.set(email, existing);
    }

    const uniqueContacts = Array.from(emailToDealContacts.entries()).map(([email, dcIds]) => ({
      email,
      dealContactId: dcIds[0],
      allDealContactIds: dcIds,
    }));
    apolloStats.uniqueEmails = uniqueContacts.length;

    logger.info('Phase 3B: Collected contacts for bulk Apollo enrichment', {
      totalContacts: allRows.length,
      uniqueEmails: uniqueContacts.length,
      duplicatesSaved: allRows.length - uniqueContacts.length,
      acrossDeals: dealIds.length,
    });

    if (uniqueContacts.length > 0) {
      const bulkResult = await enrichBatchViaApollo(uniqueContacts, config.apolloApiKey, config.cacheDays);

      for (const contact of uniqueContacts) {
        if (contact.allDealContactIds.length > 1) {
          const primaryDc = await query(
            `SELECT apollo_data, enrichment_status, enriched_at FROM deal_contacts WHERE id = $1`,
            [contact.allDealContactIds[0]]
          );
          if (primaryDc.rows.length > 0 && primaryDc.rows[0].apollo_data) {
            const siblingIds = contact.allDealContactIds.slice(1);
            await query(
              `UPDATE deal_contacts SET apollo_data = $1, enrichment_status = $2, enriched_at = $3, updated_at = NOW()
               WHERE id = ANY($4)`,
              [primaryDc.rows[0].apollo_data, primaryDc.rows[0].enrichment_status, primaryDc.rows[0].enriched_at, siblingIds]
            );
          }
        }
      }

      apolloStats.enrichedCount = bulkResult.enrichedCount;
      apolloStats.cachedCount = bulkResult.cachedCount;
      apolloStats.failedCount = bulkResult.failedCount;
      apolloStats.bulkBatches = Math.ceil(uniqueContacts.length / 10);
    }
  }

  const phase3bDuration = Date.now() - phase3bStart;
  logger.info('Phase 3B: Bulk Apollo enrichment complete', {
    ...apolloStats,
    durationMs: phase3bDuration,
  });

  // Phase 3C: Post-process role upgrades from Apollo data + build results
  const phase3cStart = Date.now();
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const results: EnrichmentResult[] = [];

  await Promise.all(deals.map(deal =>
    limiter(async () => {
      processed++;
      try {
        const enrichedContacts = await query(
          `SELECT dc.id, dc.buying_role, dc.role_source, dc.apollo_data
           FROM deal_contacts dc
           WHERE dc.deal_id = $1 AND dc.workspace_id = $2
             AND dc.apollo_data IS NOT NULL`,
          [deal.id, workspaceId]
        );

        for (const dc of enrichedContacts.rows) {
          const apolloData = typeof dc.apollo_data === 'string' ? JSON.parse(dc.apollo_data) : dc.apollo_data;
          const person = apolloData?.person;
          if (!person) {
            await query(`UPDATE deal_contacts SET enrichment_status = 'partial', updated_at = NOW() WHERE id = $1`, [dc.id]);
            continue;
          }

          const seniority = person.seniority_level?.toLowerCase?.();
          if (seniority && ['owner', 'founder', 'c_suite'].includes(seniority) && (!dc.buying_role || dc.role_source === 'title_match')) {
            await query(
              `UPDATE deal_contacts SET buying_role = 'decision_maker', role_confidence = 0.75, role_source = 'apollo_seniority', updated_at = NOW() WHERE id = $1`,
              [dc.id]
            );
          }

          let tenureMonths: number | null = null;
          if (person.employment_history && Array.isArray(person.employment_history) && person.employment_history.length > 0) {
            const current = person.employment_history[0];
            if (current.start_date) {
              const start = new Date(current.start_date);
              tenureMonths = Math.round((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24 * 30));
            }
          }

          await query(
            `UPDATE deal_contacts SET enrichment_status = 'enriched',
               tenure_months = COALESCE($2, tenure_months),
               seniority_verified = COALESCE($3, seniority_verified),
               department_verified = COALESCE($4, department_verified),
               updated_at = NOW()
             WHERE id = $1`,
            [dc.id, tenureMonths, person.seniority_level || null, person.department || null]
          );
        }

        const signalRow = await query(
          `SELECT signal_score, signals FROM account_signals
           WHERE workspace_id = $1 AND account_id = $2 ORDER BY enriched_at DESC LIMIT 1`,
          [workspaceId, deal.accountId]
        );

        const accountSignals = {
          signalCount: 0,
          signalScore: 0,
          topSignals: [] as string[],
        };

        if (signalRow.rows.length > 0) {
          accountSignals.signalScore = signalRow.rows[0].signal_score || 0;
          const signals = typeof signalRow.rows[0].signals === 'string' ? JSON.parse(signalRow.rows[0].signals) : signalRow.rows[0].signals;
          if (Array.isArray(signals)) {
            accountSignals.signalCount = signals.length;
            accountSignals.topSignals = signals
              .sort((a: any, b: any) => (b.relevance || 0) - (a.relevance || 0))
              .slice(0, 5)
              .map((s: any) => s.signal || s.type || '');
          }
        }

        const cr = roleResults.get(deal.id) || { contactCount: 0, rolesResolved: 0, rolesSummary: {} };
        const outcome: 'won' | 'lost' = deal.stage === 'closed_won' ? 'won' : 'lost';

        results.push({
          dealId: deal.id,
          dealName: deal.name,
          outcome,
          contactResolution: cr,
          apolloEnrichment: apolloStats,
          accountSignals,
          linkedinEnrichment: null,
          durationMs: 0,
        });
        succeeded++;
      } catch (error) {
        failed++;
        logger.error('Post-processing failed for deal', error instanceof Error ? error : new Error(String(error)), { dealId: deal.id });
      }
    })
  ));

  const phase3cDuration = Date.now() - phase3cStart;
  const totalDuration = Date.now() - startTime;

  logger.info('Phase 3C: Post-processing complete', { durationMs: phase3cDuration });

  logger.info('Parallel batch enrichment complete', {
    workspaceId,
    processed,
    succeeded,
    failed,
    totalDurationMs: totalDuration,
    phase1_serper_ms: phase1Duration,
    phase2_deepseek_ms: phase2Duration,
    phase3a_roles_ms: phase3aDuration,
    phase3b_apollo_ms: phase3bDuration,
    phase3c_postprocess_ms: phase3cDuration,
    apolloContacts: apolloStats.enrichedCount + apolloStats.failedCount,
    apolloBulkBatches: apolloStats.bulkBatches,
    avgTimePerDeal: Math.round(totalDuration / (processed || 1)),
  });

  return { processed, succeeded, failed, results, durationMs: totalDuration };
}
