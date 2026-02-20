/**
 * ICP Taxonomy Builder — Compute Functions
 *
 * Three-phase compute pipeline:
 * 1. buildICPTaxonomy — Foundation analysis (0 tokens)
 * 2. enrichTopAccounts — Serper signal enrichment (0 tokens)
 * 3. persistTaxonomy — Write results to database (0 tokens)
 */

import { query } from '../../db.js';
import { createLogger } from '../../utils/logger.js';
import { enrichTopAccountsWithSignals, type CompanyWithSignals } from '../../integrations/serper.js';
import { getActiveScopes, getScopeWhereClause, DEFAULT_SCOPE, type ActiveScope } from '../../config/scope-loader.js';

const logger = createLogger('ICPTaxonomy');

const MIN_WON_DEALS = 10;
const MAX_ACCOUNTS_FOR_SERPER = 50;

// ============================================================================
// Types
// ============================================================================

export interface TaxonomyFoundation {
  scope_id: string;
  scope_name: string;
  won_count: number;
  lost_count: number;
  meets_threshold: boolean;
  min_threshold: number;
  top_industries: Array<{
    industry: string;
    count: number;
    win_rate: number;
    avg_amount: number;
  }>;
  top_sizes: Array<{
    size_bucket: string;
    count: number;
    win_rate: number;
  }>;
}

export interface EnrichedAccountsResult {
  accounts_enriched: number;
  serper_searches: number;
  accounts_with_signals: number;
  top_accounts: CompanyWithSignals[];
}

export interface PersistResult {
  taxonomy_id: string;
  scope_id: string;
  accounts_analyzed: number;
  created_at: string;
}

// ============================================================================
// Phase 1: Build Taxonomy Foundation (COMPUTE)
// ============================================================================

/**
 * Analyze closed deals to build foundation for taxonomy
 * - Check minimum threshold (10+ won deals)
 * - Identify top industries and company sizes
 * - Aggregate basic patterns
 *
 * Token cost: 0 (pure SQL aggregation)
 */
export async function buildICPTaxonomy(
  workspaceId: string,
  scopeId: string = 'default'
): Promise<TaxonomyFoundation> {
  logger.info('Building ICP taxonomy foundation', { workspaceId, scopeId });

  // Get scope configuration
  const scopes = await getActiveScopes(workspaceId);
  const scope = scopes.find(s => s.scope_id === scopeId) || DEFAULT_SCOPE;
  const scopeWhere = getScopeWhereClause(scope);

  // Count won/lost deals
  const countResult = await query<{ outcome: string; cnt: string }>(
    `SELECT
       CASE WHEN is_won = true THEN 'won' ELSE 'lost' END as outcome,
       COUNT(*)::text as cnt
     FROM deals
     WHERE workspace_id = $1
       AND is_closed = true
       ${scopeWhere ? `AND ${scopeWhere}` : ''}
     GROUP BY outcome`,
    [workspaceId]
  );

  const wonCount = parseInt(countResult.rows.find(r => r.outcome === 'won')?.cnt || '0', 10);
  const lostCount = parseInt(countResult.rows.find(r => r.outcome === 'lost')?.cnt || '0', 10);
  const meetsThreshold = wonCount >= MIN_WON_DEALS;

  // Get top industries
  const industriesResult = await query<{
    industry: string;
    total: string;
    won: string;
    avg_amount: string;
  }>(
    `SELECT
       COALESCE(a.industry, 'Unknown') as industry,
       COUNT(*)::text as total,
       SUM(CASE WHEN d.is_won THEN 1 ELSE 0 END)::text as won,
       AVG(CASE WHEN d.is_won THEN d.amount ELSE NULL END)::text as avg_amount
     FROM deals d
     LEFT JOIN accounts a ON d.account_id = a.id
     WHERE d.workspace_id = $1
       AND d.is_closed = true
       ${scopeWhere ? `AND ${scopeWhere}` : ''}
     GROUP BY a.industry
     HAVING COUNT(*) >= 2
     ORDER BY COUNT(*) DESC
     LIMIT 10`,
    [workspaceId]
  );

  const topIndustries = industriesResult.rows.map(row => ({
    industry: row.industry,
    count: parseInt(row.total, 10),
    win_rate: parseInt(row.won, 10) / parseInt(row.total, 10),
    avg_amount: parseFloat(row.avg_amount || '0'),
  }));

  // Get top company sizes
  const sizesResult = await query<{
    size_bucket: string;
    total: string;
    won: string;
  }>(
    `SELECT
       CASE
         WHEN a.employee_count < 50 THEN '1-49'
         WHEN a.employee_count < 200 THEN '50-199'
         WHEN a.employee_count < 1000 THEN '200-999'
         WHEN a.employee_count < 5000 THEN '1K-5K'
         ELSE '5K+'
       END as size_bucket,
       COUNT(*)::text as total,
       SUM(CASE WHEN d.is_won THEN 1 ELSE 0 END)::text as won
     FROM deals d
     LEFT JOIN accounts a ON d.account_id = a.id
     WHERE d.workspace_id = $1
       AND d.is_closed = true
       AND a.employee_count IS NOT NULL
       ${scopeWhere ? `AND ${scopeWhere}` : ''}
     GROUP BY size_bucket
     ORDER BY COUNT(*) DESC`,
    [workspaceId]
  );

  const topSizes = sizesResult.rows.map(row => ({
    size_bucket: row.size_bucket,
    count: parseInt(row.total, 10),
    win_rate: parseInt(row.won, 10) / parseInt(row.total, 10),
  }));

  const foundation: TaxonomyFoundation = {
    scope_id: scope.scope_id,
    scope_name: scope.name,
    won_count: wonCount,
    lost_count: lostCount,
    meets_threshold: meetsThreshold,
    min_threshold: MIN_WON_DEALS,
    top_industries: topIndustries,
    top_sizes: topSizes,
  };

  if (!meetsThreshold) {
    logger.warn('Insufficient won deals for taxonomy', {
      workspaceId,
      scopeId,
      wonCount,
      required: MIN_WON_DEALS,
    });
  }

  return foundation;
}

// ============================================================================
// Phase 2: Enrich Top Accounts (COMPUTE + Serper API)
// ============================================================================

/**
 * Fetch top 50 won accounts and enrich with Serper web signals
 * Cost control: Limited to top 50 accounts by deal amount
 *
 * Token cost: 0 (SQL + external API)
 * Serper cost: ~$0.05 per 50 searches
 */
export async function enrichTopAccounts(
  workspaceId: string,
  scopeId: string = 'default',
  stepData?: Record<string, any>
): Promise<EnrichedAccountsResult> {
  logger.info('Enriching top accounts with web signals', { workspaceId, scopeId });

  // Get scope configuration
  const scopes = await getActiveScopes(workspaceId);
  const scope = scopes.find(s => s.scope_id === scopeId) || DEFAULT_SCOPE;
  const scopeWhere = getScopeWhereClause(scope);

  // Get top 50 won accounts by total deal amount
  const accountsResult = await query<{
    account_id: string;
    account_name: string;
    industry: string | null;
    employee_count: number | null;
    total_amount: string;
    deal_count: string;
    latest_close_date: string;
  }>(
    `SELECT
       a.id as account_id,
       a.name as account_name,
       a.industry,
       a.employee_count,
       SUM(d.amount)::text as total_amount,
       COUNT(*)::text as deal_count,
       MAX(d.close_date)::text as latest_close_date
     FROM accounts a
     JOIN deals d ON d.account_id = a.id
     WHERE d.workspace_id = $1
       AND d.is_won = true
       ${scopeWhere ? `AND ${scopeWhere}` : ''}
     GROUP BY a.id, a.name, a.industry, a.employee_count
     ORDER BY SUM(d.amount) DESC
     LIMIT $2`,
    [workspaceId, MAX_ACCOUNTS_FOR_SERPER]
  );

  const topAccounts = accountsResult.rows.map(row => ({
    id: row.account_id,
    name: row.account_name,
    industry: row.industry || 'Unknown',
    employee_count: row.employee_count || null,
    amount: parseFloat(row.total_amount),
    deal_count: parseInt(row.deal_count, 10),
    close_date: row.latest_close_date,
  }));

  // Enrich with Serper signals (handles API key lookup and rate limiting)
  const enriched = await enrichTopAccountsWithSignals(workspaceId, topAccounts, MAX_ACCOUNTS_FOR_SERPER);

  const result: EnrichedAccountsResult = {
    accounts_enriched: enriched.length,
    serper_searches: enriched.length,
    accounts_with_signals: enriched.filter(acc => acc.signalCount > 0).length,
    top_accounts: enriched,
  };

  logger.info('Account enrichment complete', {
    workspaceId,
    scopeId,
    accountsEnriched: result.accounts_enriched,
    accountsWithSignals: result.accounts_with_signals,
  });

  return result;
}

// ============================================================================
// Phase 3: Persist Taxonomy (COMPUTE)
// ============================================================================

/**
 * Write taxonomy results to icp_taxonomy table
 * Links to icp_profiles for integration with ICP Discovery
 *
 * Token cost: 0 (SQL write)
 */
export async function persistTaxonomy(
  workspaceId: string,
  scopeId: string = 'default',
  stepData?: Record<string, any>
): Promise<PersistResult> {
  logger.info('Persisting taxonomy to database', { workspaceId, scopeId });

  const foundation = stepData?.taxonomy_foundation;
  const enrichedAccounts = stepData?.enriched_accounts;
  const accountClassifications = stepData?.account_classifications;
  const taxonomyReport = stepData?.taxonomy_report;

  if (!foundation || !enrichedAccounts || !taxonomyReport) {
    throw new Error('Missing required step data for taxonomy persistence');
  }

  // Detect vertical from classifications
  const verticalCounts: Record<string, number> = {};
  if (Array.isArray(accountClassifications)) {
    for (const classification of accountClassifications) {
      const vertical = classification.vertical_pattern || 'generic_b2b';
      verticalCounts[vertical] = (verticalCounts[vertical] || 0) + 1;
    }
  }

  // Map to high-level vertical
  const topVertical = Object.entries(verticalCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'generic';

  let finalVertical = 'generic';
  if (topVertical.startsWith('healthcare')) finalVertical = 'healthcare';
  else if (topVertical.startsWith('industrial')) finalVertical = 'industrial';
  else if (topVertical.startsWith('software')) finalVertical = 'software';

  // Calculate token usage from stepData (populated by runtime)
  const tokenUsage = {
    classify: stepData?._token_usage?.classify || 0,
    synthesize: stepData?._token_usage?.synthesize || 0,
    total: (stepData?._token_usage?.classify || 0) + (stepData?._token_usage?.synthesize || 0),
  };

  // Insert taxonomy record
  const insertResult = await query<{ id: string; created_at: string }>(
    `INSERT INTO icp_taxonomy (
       workspace_id, scope_id, generated_at,
       vertical, top_accounts, account_classifications, taxonomy_report,
       accounts_analyzed, won_deals_count, serper_searches, token_usage
     )
     VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, created_at`,
    [
      workspaceId,
      scopeId,
      finalVertical,
      JSON.stringify(enrichedAccounts.top_accounts),
      JSON.stringify(accountClassifications || []),
      JSON.stringify({ report: taxonomyReport }),
      enrichedAccounts.accounts_enriched,
      foundation.won_count,
      enrichedAccounts.serper_searches,
      JSON.stringify(tokenUsage),
    ]
  );

  const taxonomyId = insertResult.rows[0].id;
  const createdAt = insertResult.rows[0].created_at;

  // Link to most recent icp_profile for this scope
  await query(
    `UPDATE icp_profiles
     SET taxonomy_id = $1, scope_id = $2
     WHERE workspace_id = $3
       AND scope_id = $2
       AND id = (
         SELECT id FROM icp_profiles
         WHERE workspace_id = $3 AND scope_id = $2
         ORDER BY generated_at DESC
         LIMIT 1
       )`,
    [taxonomyId, scopeId, workspaceId]
  );

  logger.info('Taxonomy persisted successfully', {
    workspaceId,
    scopeId,
    taxonomyId,
    vertical: finalVertical,
  });

  return {
    taxonomy_id: taxonomyId,
    scope_id: scopeId,
    accounts_analyzed: enrichedAccounts.accounts_enriched,
    created_at: createdAt,
  };
}
