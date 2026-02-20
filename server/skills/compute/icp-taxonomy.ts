/**
 * ICP Taxonomy Builder — Compute Functions
 *
 * Three-phase compute pipeline:
 * 1. buildICPTaxonomy — Foundation analysis (0 tokens)
 * 2. enrichTopAccounts — Serper signal enrichment (0 tokens)
 * 3. compressForClassification — Compact enriched data for DeepSeek (0 tokens)
 * 4. persistTaxonomy — Write results to database (0 tokens)
 */

import { query } from '../../db.js';
import { createLogger } from '../../utils/logger.js';
import { enrichTopAccountsWithSignals, type CompanyWithSignals } from '../../integrations/serper.js';
import { getActiveScopes, getScopeWhereClause, DEFAULT_SCOPE, type ActiveScope } from '../../config/scope-loader.js';
import { callLLM } from '../../utils/llm-router.js';

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
       CASE WHEN stage_normalized = 'closed_won' THEN 'won' ELSE 'lost' END as outcome,
       COUNT(*)::text as cnt
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized IN ('closed_won', 'closed_lost')
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
       SUM(CASE WHEN d.stage_normalized = 'closed_won' THEN 1 ELSE 0 END)::text as won,
       AVG(CASE WHEN d.stage_normalized = 'closed_won' THEN d.amount ELSE NULL END)::text as avg_amount
     FROM deals d
     LEFT JOIN accounts a ON d.account_id = a.id
     WHERE d.workspace_id = $1
       AND d.stage_normalized IN ('closed_won', 'closed_lost')
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
       SUM(CASE WHEN d.stage_normalized = 'closed_won' THEN 1 ELSE 0 END)::text as won
     FROM deals d
     LEFT JOIN accounts a ON d.account_id = a.id
     WHERE d.workspace_id = $1
       AND d.stage_normalized IN ('closed_won', 'closed_lost')
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
       AND d.stage_normalized = 'closed_won'
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
// Phase 2B: Compress Enriched Data for DeepSeek (COMPUTE)
// ============================================================================

export interface CompressedAccount {
  id: string;
  name: string;
  industry: string;
  employee_count: number | null;
  amount: number;
  research_summary: string;
}

export interface CompressedAccountsResult {
  accounts: CompressedAccount[];
  total: number;
}

export function compressForClassification(
  _workspaceId: string,
  _scopeId: string = 'default',
  stepData?: Record<string, any>
): CompressedAccountsResult {
  const enriched = stepData?.enriched_accounts;
  if (!enriched || !enriched.top_accounts) {
    return { accounts: [], total: 0 };
  }

  const compressed: CompressedAccount[] = enriched.top_accounts.map((acc: any) => {
    let researchSummary = '';
    if (acc.signals && acc.signals.length > 0) {
      const firstSnippet = acc.signals[0].snippet || '';
      researchSummary = firstSnippet.length > 150
        ? firstSnippet.slice(0, 147) + '...'
        : firstSnippet;
    }

    return {
      id: acc.id,
      name: acc.name,
      industry: acc.industry || 'Unknown',
      employee_count: acc.employee_count || null,
      amount: acc.amount || 0,
      research_summary: researchSummary,
    };
  });

  return { accounts: compressed, total: compressed.length };
}

// ============================================================================
// Phase 2C: Classify Accounts in Batches (COMPUTE + DeepSeek)
// ============================================================================

const CLASSIFY_BATCH_SIZE = 15;

const CLASSIFICATION_SYSTEM_PROMPT = `You are a B2B sales intelligence analyst classifying company patterns from closed deals and web signals.

For EACH account provided, return a classification object. Respond with ONLY a JSON array containing one object per account.

Each object must have:
- account_id: the account index as a string
- account_name: the company name
- vertical_pattern: one of "healthcare_provider", "healthcare_tech", "industrial_manufacturing", "industrial_services", "software_b2b", "software_consumer", "professional_services", "generic_b2b"
- buying_signals: array of up to 5 signals from: "expansion", "digital_transformation", "regulatory_pressure", "leadership_change", "market_disruption", "cost_optimization", "revenue_growth"
- company_maturity: "early_stage" | "growth_stage" | "established" | "enterprise"
- use_case_archetype: brief 1-2 sentence description of why they bought
- lookalike_indicators: 3-5 characteristics defining similar prospects
- confidence: 0.0-1.0

CRITICAL: Return one object per account. If given 15 accounts, return an array of 15 objects.`;

export interface AccountClassification {
  account_id: string;
  account_name: string;
  vertical_pattern: string;
  buying_signals: string[];
  company_maturity: string;
  use_case_archetype: string;
  lookalike_indicators: string[];
  confidence: number;
}

export async function classifyAccountsBatched(
  workspaceId: string,
  _scopeId: string = 'default',
  stepData?: Record<string, any>
): Promise<AccountClassification[]> {
  const compressed = stepData?.compressed_accounts;
  if (!compressed || !compressed.accounts || compressed.accounts.length === 0) {
    logger.warn('No compressed accounts available for classification', { workspaceId });
    return [];
  }

  const accounts: CompressedAccount[] = compressed.accounts;
  const batches: CompressedAccount[][] = [];
  for (let i = 0; i < accounts.length; i += CLASSIFY_BATCH_SIZE) {
    batches.push(accounts.slice(i, i + CLASSIFY_BATCH_SIZE));
  }

  logger.info('Classifying accounts in batches', {
    workspaceId,
    totalAccounts: accounts.length,
    batchCount: batches.length,
    batchSize: CLASSIFY_BATCH_SIZE,
  });

  const allClassifications: AccountClassification[] = [];

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const batchPrompt = batch.map((acc, i) => {
      const globalIdx = batchIdx * CLASSIFY_BATCH_SIZE + i;
      return `## Account ${globalIdx}: ${acc.name}\n- Industry: ${acc.industry}\n- Size: ${acc.employee_count || 'Unknown'} employees\n- Deal Amount: $${Math.round(acc.amount).toLocaleString()}\n- Web Signal: ${acc.research_summary || 'None'}`;
    }).join('\n\n');

    try {
      const response = await callLLM(workspaceId, 'extract', {
        messages: [{ role: 'user', content: `Classify these ${batch.length} accounts:\n\n${batchPrompt}` }],
        systemPrompt: CLASSIFICATION_SYSTEM_PROMPT,
        maxTokens: 4096,
        temperature: 0.1,
      });

      if (response.content) {
        let jsonStr = response.content.trim();
        const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenceMatch) jsonStr = fenceMatch[1].trim();

        let parsed = JSON.parse(jsonStr);
        if (!Array.isArray(parsed)) {
          if (typeof parsed === 'object') {
            const arrayVal = Object.values(parsed).find(v => Array.isArray(v));
            if (arrayVal) {
              parsed = arrayVal;
            } else {
              const requiredFields = ['account_name', 'vertical_pattern', 'confidence'];
              const matchCount = requiredFields.filter(f => f in parsed).length;
              if (matchCount >= 2) {
                parsed = [parsed];
              } else {
                logger.warn('DeepSeek batch returned unexpected shape', { batchIdx, keys: Object.keys(parsed) });
                continue;
              }
            }
          }
        }

        if (Array.isArray(parsed)) {
          allClassifications.push(...parsed);
          logger.info('Batch classified', { batchIdx, returned: parsed.length, expected: batch.length });
        }
      }
    } catch (err: any) {
      logger.warn('DeepSeek batch classification failed', { batchIdx, error: err.message });
    }
  }

  if (allClassifications.length < 3) {
    logger.error('Classification returned too few results', {
      workspaceId,
      expected: accounts.length,
      got: allClassifications.length,
    });
  }

  logger.info('Account classification complete', {
    workspaceId,
    classified: allClassifications.length,
    sent: accounts.length,
  });

  return allClassifications;
}

// ============================================================================
// Phase 3: Synthesize Taxonomy (COMPUTE + Claude)
// ============================================================================

export interface TaxonomyReport {
  icp_summary: string;
  top_dimensions: Array<{
    key: string;
    label: string;
    ideal_values: string[];
    win_rate: number;
    lift: number;
    why_it_matters: string;
    data_source: string;
  }>;
  negative_indicators: Array<{
    dimension: string;
    value: string;
    win_rate: number;
    recommendation: string;
  }>;
  archetypes: Array<{
    name: string;
    deal_count: number;
    description: string;
    example_accounts: string[];
  }>;
  confidence: string;
  confidence_notes: string;
}

function buildClassificationSummary(classifications: AccountClassification[]): Record<string, Array<{ value: string; count: number }>> {
  const dimensionCounts: Record<string, Record<string, number>> = {};

  for (const account of classifications) {
    const dims: Record<string, string | string[]> = {
      vertical_pattern: account.vertical_pattern,
      company_maturity: account.company_maturity,
      use_case_archetype: account.use_case_archetype,
      buying_signals: account.buying_signals,
      lookalike_indicators: account.lookalike_indicators,
    };

    for (const [key, value] of Object.entries(dims)) {
      if (!dimensionCounts[key]) dimensionCounts[key] = {};
      if (Array.isArray(value)) {
        for (const v of value) {
          dimensionCounts[key][v] = (dimensionCounts[key][v] || 0) + 1;
        }
      } else if (typeof value === 'string' && value) {
        dimensionCounts[key][value] = (dimensionCounts[key][value] || 0) + 1;
      }
    }
  }

  const summary: Record<string, Array<{ value: string; count: number }>> = {};
  for (const [dim, valueCounts] of Object.entries(dimensionCounts)) {
    summary[dim] = Object.entries(valueCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([value, count]) => ({ value, count }));
  }

  return summary;
}

export async function synthesizeTaxonomy(
  workspaceId: string,
  _scopeId: string = 'default',
  stepData?: Record<string, any>
): Promise<TaxonomyReport> {
  const foundation = stepData?.taxonomy_foundation as TaxonomyFoundation | undefined;
  const enrichedAccounts = stepData?.enriched_accounts as EnrichedAccountsResult | undefined;
  const accountClassifications = stepData?.account_classifications as AccountClassification[] | undefined;

  if (!foundation || !accountClassifications || accountClassifications.length === 0) {
    throw new Error('Missing foundation or classification data for synthesis');
  }

  const classificationSummary = buildClassificationSummary(accountClassifications);

  const accountSample = accountClassifications
    .slice(0, 20)
    .map(a => `${a.account_name}: ${a.vertical_pattern || ''} / ${a.use_case_archetype || ''} / maturity: ${a.company_maturity || ''}`.trim());

  const totalAccounts = accountClassifications.length;

  const crmDimensionSummary = foundation.top_industries
    .map(ind => `- ${ind.industry}: ${ind.count} deals, ${Math.round(ind.win_rate * 100)}% win rate, avg $${Math.round(ind.avg_amount).toLocaleString()}`)
    .join('\n');

  const sizeSummary = foundation.top_sizes
    .map(s => `- ${s.size_bucket} employees: ${s.count} deals, ${Math.round(s.win_rate * 100)}% win rate`)
    .join('\n');

  const workspaceResult = await query<{ name: string }>(
    `SELECT name FROM workspaces WHERE id = $1`,
    [workspaceId]
  );
  const workspaceName = workspaceResult.rows[0]?.name || 'Unknown';

  const classificationPatterns = Object.entries(classificationSummary)
    .map(([dim, values]) =>
      `${dim}:\n${values.map(v => `  - "${v.value}": ${v.count} accounts`).join('\n')}`
    ).join('\n\n');

  const prompt = `You are analyzing the ICP (Ideal Customer Profile) for ${workspaceName}.

IMPORTANT: You must derive ALL insights ONLY from the data below.
Do NOT invent categories, archetypes, or patterns not present in this data.
If you are unsure, say "insufficient data" rather than guessing.

ACTUAL ACCOUNT SAMPLE (${accountSample.length} of ${totalAccounts} won accounts):
${accountSample.map(a => `- ${a}`).join('\n')}

CLASSIFICATION PATTERNS (from analysis of all ${totalAccounts} accounts):
${classificationPatterns}

WIN RATE BY CRM INDUSTRY:
${crmDimensionSummary || 'No industry data available'}

WIN RATE BY COMPANY SIZE:
${sizeSummary || 'No size data available'}

WON DEALS: ${foundation.won_count} | LOST DEALS: ${foundation.lost_count}

Based ONLY on the above data, produce a JSON object with this exact shape.
Output ONLY valid JSON. No markdown, no explanation, no preamble.

{
  "icp_summary": "2-3 sentences describing the ideal customer in plain language, using the specific terminology visible in the account names and classifications above. Must mention the specific service type, population, or industry visible in the data.",
  "top_dimensions": [
    {
      "key": "dimension_key",
      "label": "Human readable label",
      "ideal_values": ["value1", "value2"],
      "win_rate": 0.0,
      "lift": 0.0,
      "why_it_matters": "One sentence grounded in the data above",
      "data_source": "crm | serper | conversation | synthesized"
    }
  ],
  "negative_indicators": [
    {
      "dimension": "dimension_key",
      "value": "value",
      "win_rate": 0.0,
      "recommendation": "One sentence"
    }
  ],
  "archetypes": [
    {
      "name": "Name derived from actual account patterns above",
      "deal_count": 0,
      "description": "Description using only terminology from the data above",
      "example_accounts": ["actual account names from the sample above"]
    }
  ],
  "confidence": "high | medium | low",
  "confidence_notes": "Note sample size and data coverage"
}`;

  logger.info('Synthesizing taxonomy with Claude', {
    workspaceId,
    totalAccounts,
    classificationDimensions: Object.keys(classificationSummary).length,
    sampleSize: accountSample.length,
  });

  const response = await callLLM(workspaceId, 'reason', {
    messages: [{ role: 'user', content: prompt }],
    systemPrompt: 'You are a revenue intelligence analyst. Respond with ONLY valid JSON. No markdown fences, no explanation.',
    maxTokens: 4096,
    temperature: 0.2,
  });

  if (!response.content) {
    throw new Error('Claude returned empty response for taxonomy synthesis');
  }

  let taxonomyReport: TaxonomyReport;
  try {
    const cleaned = response.content
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    taxonomyReport = JSON.parse(cleaned);
  } catch (e: any) {
    logger.error('Claude output was not valid JSON', { error: e.message, contentPreview: response.content.slice(0, 500) });
    taxonomyReport = { raw: response.content, parse_error: e.message } as any;
  }

  logger.info('Taxonomy synthesis complete', {
    workspaceId,
    hasIcpSummary: !!taxonomyReport.icp_summary,
    dimensionCount: taxonomyReport.top_dimensions?.length || 0,
    archetypeCount: taxonomyReport.archetypes?.length || 0,
  });

  return taxonomyReport;
}

// ============================================================================
// Phase 4: Persist Taxonomy (COMPUTE)
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

  if (!foundation || !taxonomyReport) {
    throw new Error('Missing required step data for taxonomy persistence (foundation or report)');
  }

  if (foundation.error) {
    throw new Error(`Taxonomy foundation failed: ${foundation.error}`);
  }

  const enrichmentFailed = !enrichedAccounts || enrichedAccounts.error || !enrichedAccounts.top_accounts;
  if (enrichmentFailed) {
    logger.warn('Enrichment data unavailable, persisting taxonomy without enrichment', {
      workspaceId, scopeId,
      reason: enrichedAccounts?.error || 'no enrichment data',
    });
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
      JSON.stringify(enrichmentFailed ? [] : enrichedAccounts.top_accounts),
      JSON.stringify(accountClassifications || []),
      JSON.stringify(taxonomyReport),
      enrichmentFailed ? 0 : enrichedAccounts.accounts_enriched,
      foundation.won_count,
      enrichmentFailed ? 0 : enrichedAccounts.serper_searches,
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
