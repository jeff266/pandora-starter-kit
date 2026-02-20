/**
 * Serper Integration
 *
 * Wrapper around enrichment/serper.ts for use in skill compute functions
 * Provides company signal search with cost control and rate limiting
 */

import { searchCompanySignalsBatch, type SerperSearchResult } from '../enrichment/serper.js';
import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('SerperIntegration');

export interface CompanyWithSignals {
  id: string;
  name: string;
  amount: number;
  signals: SerperSearchResult[];
  signalCount: number;
}

/**
 * Fetch web signals for top accounts with cost control
 * Limited to top N accounts to prevent excessive API usage
 */
export async function enrichTopAccountsWithSignals(
  workspaceId: string,
  accounts: Array<{ id: string; name: string; amount: number }>,
  maxAccounts: number = 50
): Promise<CompanyWithSignals[]> {
  // Limit to top N accounts by amount
  const topAccounts = [...accounts]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, maxAccounts);

  logger.info('Fetching Serper signals for top accounts', {
    workspaceId,
    totalAccounts: accounts.length,
    searchingTop: topAccounts.length,
  });

  // Get Serper API key — try credentials table first, fall back to env var
  let apiKey: string | null = null;
  try {
    const credResult = await query<{ value: string }>(
      `SELECT value FROM credentials WHERE workspace_id = $1 AND service = 'serper' AND key = 'api_key'`,
      [workspaceId]
    );
    if (credResult.rows.length > 0) {
      apiKey = credResult.rows[0].value;
    }
  } catch {
    // credentials table may not exist — fall through to env var
  }

  if (!apiKey) {
    apiKey = process.env.SERPER_API_KEY || null;
  }

  if (!apiKey) {
    logger.warn('No Serper API key found, skipping signal enrichment', { workspaceId });
    return topAccounts.map(acc => ({
      ...acc,
      signals: [],
      signalCount: 0,
    }));
  }

  // Batch search with rate limiting (handled by serper.ts)
  const signalsMap = await searchCompanySignalsBatch(
    topAccounts.map(acc => ({ id: acc.id, name: acc.name })),
    apiKey
  );

  // Combine results
  const enrichedAccounts = topAccounts.map(acc => ({
    ...acc,
    signals: signalsMap.get(acc.id) || [],
    signalCount: (signalsMap.get(acc.id) || []).length,
  }));

  const totalSignals = enrichedAccounts.reduce((sum, acc) => sum + acc.signalCount, 0);
  logger.info('Serper signal enrichment complete', {
    workspaceId,
    accountsSearched: topAccounts.length,
    totalSignals,
    avgSignalsPerAccount: (totalSignals / topAccounts.length).toFixed(1),
  });

  return enrichedAccounts;
}

export { type SerperSearchResult };
