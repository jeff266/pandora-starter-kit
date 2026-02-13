import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { resolveContactRoles } from './resolve-contact-roles.js';
import { enrichBatchViaApollo } from './apollo.js';
import { enrichAccountWithSignals } from './classify-signals.js';
import { getEnrichmentConfig } from './config.js';

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
         AND (dc.enrichment_status IS NULL OR dc.enrichment_status = 'pending')`,
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
  limit: number = 50
): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  results: EnrichmentResult[];
}> {
  logger.info('Starting batch closed deal enrichment', { workspaceId, lookbackMonths, limit });

  const dealsResult = await query(
    `SELECT d.id FROM deals d
     LEFT JOIN deal_contacts dc ON dc.deal_id = d.id AND dc.workspace_id = d.workspace_id
     WHERE d.workspace_id = $1
       AND d.stage_normalized IN ('closed_won', 'closed_lost')
       AND d.close_date > NOW() - INTERVAL '1 month' * $2
       AND dc.id IS NULL
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

  logger.info('Batch closed deal enrichment complete', { workspaceId, processed, succeeded, failed });

  return { processed, succeeded, failed, results };
}
