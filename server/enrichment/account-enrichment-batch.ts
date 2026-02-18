import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { enrichAccount, shouldUseApollo } from './account-enrichment.js';
import { scoreAccount } from '../scoring/account-scorer.js';
import { getEnrichmentConfig } from './config.js';
import pLimit from 'p-limit';

const logger = createLogger('AccountEnrichmentBatch');

export interface BatchEnrichmentResult {
  total: number;
  enriched: number;
  scored: number;
  cached: number;
  failed: number;
  apolloGated: number;
  grades: Record<string, number>;
  duration_ms: number;
}

export async function enrichAndScoreAccountsBatch(
  workspaceId: string,
  options: {
    limit?: number;
    forceRefresh?: boolean;
    concurrency?: number;
  } = {}
): Promise<BatchEnrichmentResult> {
  const startTime = Date.now();
  const { limit = 50, forceRefresh = false, concurrency = 3 } = options;

  const config = await getEnrichmentConfig(workspaceId);
  if (!config.serperApiKey) {
    logger.warn('Serper API key not configured, skipping enrichment', { workspaceId });
    return {
      total: 0, enriched: 0, scored: 0, cached: 0, failed: 0,
      apolloGated: 0, grades: {}, duration_ms: Date.now() - startTime,
    };
  }

  const accountsResult = await query<{
    id: string; name: string; domain: string | null;
    has_active_deal: boolean; current_grade: string | null;
    last_enriched: Date | null;
  }>(
    `SELECT
      a.id, a.name, a.domain,
      EXISTS(
        SELECT 1 FROM deals d
        WHERE d.account_id = a.id AND d.workspace_id = a.workspace_id
          AND d.stage NOT IN ('closed_won', 'closed_lost', 'closedwon', 'closedlost')
      ) as has_active_deal,
      acs.grade as current_grade,
      asi.enriched_at as last_enriched
     FROM accounts a
     LEFT JOIN account_scores acs ON acs.account_id = a.id AND acs.workspace_id = a.workspace_id
     LEFT JOIN account_signals asi ON asi.account_id = a.id AND asi.workspace_id = a.workspace_id
     WHERE a.workspace_id = $1
     ORDER BY
       asi.enriched_at ASC NULLS FIRST,
       a.updated_at DESC
     LIMIT $2`,
    [workspaceId, limit]
  );

  const accounts = accountsResult.rows;
  if (accounts.length === 0) {
    logger.info('No accounts to enrich', { workspaceId });
    return {
      total: 0, enriched: 0, scored: 0, cached: 0, failed: 0,
      apolloGated: 0, grades: {}, duration_ms: Date.now() - startTime,
    };
  }

  logger.info('Starting batch enrichment', {
    workspaceId, accountCount: accounts.length, concurrency, forceRefresh,
  });

  let enriched = 0;
  let scored = 0;
  let cached = 0;
  let failed = 0;
  let apolloGated = 0;
  const grades: Record<string, number> = {};

  const limiter = pLimit(concurrency);

  const tasks = accounts.map(account =>
    limiter(async () => {
      try {
        const enrichResult = await enrichAccount(workspaceId, account.id, {
          cacheDays: config.cacheDays,
          forceRefresh,
        });

        if (enrichResult.cached) {
          cached++;
        } else {
          enriched++;
        }

        const apolloCheck = shouldUseApollo(
          account.id,
          account.has_active_deal,
          account.current_grade
        );
        if (apolloCheck) {
          apolloGated++;
          logger.info('Apollo gate: would enrich via Apollo', {
            accountId: account.id, accountName: account.name,
            grade: account.current_grade, hasActiveDeal: account.has_active_deal,
          });
        }

        const scoreResult = await scoreAccount(workspaceId, account.id);
        scored++;
        grades[scoreResult.grade] = (grades[scoreResult.grade] || 0) + 1;

      } catch (err) {
        failed++;
        logger.warn('Failed to enrich/score account', {
          accountId: account.id, accountName: account.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })
  );

  await Promise.all(tasks);

  const duration_ms = Date.now() - startTime;

  logger.info('Batch enrichment complete', {
    workspaceId, total: accounts.length,
    enriched, scored, cached, failed, apolloGated,
    grades, duration_ms,
  });

  return {
    total: accounts.length,
    enriched, scored, cached, failed, apolloGated,
    grades, duration_ms,
  };
}

export async function getAccountScoringStatus(
  workspaceId: string
): Promise<{
  totalAccounts: number;
  scoredAccounts: number;
  enrichedAccounts: number;
  gradeDistribution: Record<string, number>;
  avgScore: number;
  lastScoredAt: string | null;
  coveragePercent: number;
}> {
  const [totals, gradesDist, lastScored] = await Promise.all([
    query<{
      total_accounts: string;
      scored_accounts: string;
      enriched_accounts: string;
      avg_score: string;
    }>(
      `SELECT
        (SELECT COUNT(*) FROM accounts WHERE workspace_id = $1) as total_accounts,
        (SELECT COUNT(*) FROM account_scores WHERE workspace_id = $1) as scored_accounts,
        (SELECT COUNT(*) FROM account_signals WHERE workspace_id = $1 AND enriched_at IS NOT NULL) as enriched_accounts,
        (SELECT COALESCE(AVG(total_score), 0) FROM account_scores WHERE workspace_id = $1) as avg_score`,
      [workspaceId]
    ),
    query<{ grade: string; count: string }>(
      `SELECT grade, COUNT(*) as count
       FROM account_scores WHERE workspace_id = $1
       GROUP BY grade ORDER BY grade`,
      [workspaceId]
    ),
    query<{ last_scored: Date }>(
      `SELECT MAX(scored_at) as last_scored FROM account_scores WHERE workspace_id = $1`,
      [workspaceId]
    ),
  ]);

  const t = totals.rows[0];
  const totalAccounts = parseInt(t.total_accounts) || 0;
  const scoredAccounts = parseInt(t.scored_accounts) || 0;
  const enrichedAccounts = parseInt(t.enriched_accounts) || 0;
  const avgScore = parseFloat(t.avg_score) || 0;

  const gradeDistribution: Record<string, number> = {};
  for (const row of gradesDist.rows) {
    gradeDistribution[row.grade] = parseInt(row.count);
  }

  const lastScoredAt = lastScored.rows[0]?.last_scored
    ? lastScored.rows[0].last_scored.toISOString()
    : null;

  return {
    totalAccounts,
    scoredAccounts,
    enrichedAccounts,
    gradeDistribution,
    avgScore: Math.round(avgScore * 10) / 10,
    lastScoredAt,
    coveragePercent: totalAccounts > 0 ? Math.round((scoredAccounts / totalAccounts) * 100) : 0,
  };
}
