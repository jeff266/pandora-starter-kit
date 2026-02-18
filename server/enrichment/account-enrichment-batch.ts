import { query as dbQuery } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { enrichAccount } from './account-enrichment.js';
import { scoreAccount } from '../scoring/account-scorer.js';

const logger = createLogger('AccountEnrichmentBatch');

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const CONCURRENCY = 5;

export interface BatchResult {
  processed: number;
  serperOnly: number;
  escalatedPuppeteer: number;
  escalatedCheerio: number;
  directoryPivot: number;
  apolloUsed: number;
  failed: number;
  errors: string[];
}

export async function runAccountEnrichmentBatch(
  workspaceId: string,
  options?: {
    limit?: number;
    forceRefresh?: boolean;
    accountIds?: string[];
  }
): Promise<BatchResult> {
  let accountsToProcess: Array<{ id: string; name: string; domain: string | null }>;

  if (options?.accountIds?.length) {
    const result = await dbQuery<{ id: string; name: string; domain: string | null }>(
      `SELECT id, name, domain FROM accounts WHERE workspace_id = $1 AND id = ANY($2)`,
      [workspaceId, options.accountIds]
    );
    accountsToProcess = result.rows;
  } else {
    const staleCondition = options?.forceRefresh ? 'TRUE' : 'acs.stale_after < now()';
    const result = await dbQuery<{ id: string; name: string; domain: string | null }>(
      `SELECT a.id, a.name, a.domain,
         CASE WHEN d.id IS NOT NULL THEN 1 ELSE 2 END AS priority
       FROM accounts a
       LEFT JOIN LATERAL (
         SELECT id FROM deals
         WHERE workspace_id = a.workspace_id
           AND account_id = a.id
           AND stage_normalized NOT IN ('closed_won', 'closed_lost')
         LIMIT 1
       ) d ON true
       LEFT JOIN account_signals acs ON acs.account_id = a.id AND acs.workspace_id = a.workspace_id
       WHERE a.workspace_id = $1
         AND (
           acs.id IS NULL
           OR acs.scrape_status = 'pending'
           OR ${staleCondition}
         )
       ORDER BY priority ASC, a.name ASC
       LIMIT $2`,
      [workspaceId, options?.limit ?? 100]
    );
    accountsToProcess = result.rows;
  }

  const results: BatchResult = {
    processed: 0,
    serperOnly: 0,
    escalatedPuppeteer: 0,
    escalatedCheerio: 0,
    directoryPivot: 0,
    apolloUsed: 0,
    failed: 0,
    errors: [],
  };

  for (let i = 0; i < accountsToProcess.length; i += CONCURRENCY) {
    const batch = accountsToProcess.slice(i, i + CONCURRENCY);
    await Promise.allSettled(
      batch.map(async (account) => {
        try {
          const result = await enrichAccount(workspaceId, account.id);
          results.processed++;
          if (result.siteType === 'puppeteer') results.escalatedPuppeteer++;
          else if (result.siteType === 'cheerio') results.escalatedCheerio++;
          else if (result.siteType === 'directory') results.directoryPivot++;
          else if (result.siteType !== 'failed') results.serperOnly++;
          if (result.apolloUsed) results.apolloUsed++;
        } catch (err) {
          results.failed++;
          const msg = err instanceof Error ? err.message : String(err);
          results.errors.push(`${account.name}: ${msg}`);
          logger.error('Account enrichment failed', new Error(msg), { accountId: account.id });
        }
      })
    );

    if (i + CONCURRENCY < accountsToProcess.length) {
      await sleep(2000);
    }
  }

  // After enrichment, score all processed accounts
  if (results.processed > 0) {
    await runAccountScoringBatch(workspaceId, { limit: results.processed + results.failed });
  }

  logger.info('Account enrichment batch complete', { workspaceId, ...results });
  return results;
}

export async function runAccountScoringBatch(
  workspaceId: string,
  options?: { limit?: number }
): Promise<void> {
  const accounts = await dbQuery<{ id: string }>(
    `SELECT a.id FROM accounts a
     LEFT JOIN account_scores acs ON acs.account_id = a.id AND acs.workspace_id = a.workspace_id
     WHERE a.workspace_id = $1
       AND (acs.id IS NULL OR acs.stale_after < now())
     LIMIT $2`,
    [workspaceId, options?.limit ?? 500]
  );

  for (const account of accounts.rows) {
    await scoreAccount(workspaceId, account.id).catch(err =>
      logger.error('Account scoring failed', err instanceof Error ? err : new Error(String(err)), { accountId: account.id })
    );
  }

  logger.info('Account scoring batch complete', { workspaceId, count: accounts.rows.length });
}
