import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { callLLM } from '../utils/llm-router.js';
import { searchCompanySignals, type SerperSearchResult } from './serper.js';
import { classifyAccountSignals } from './classify-signals.js';
import { getEnrichmentConfig } from './config.js';

const logger = createLogger('AccountEnrichment');

export interface EnrichmentResult {
  accountId: string;
  accountName: string;
  enrichmentSource: string;
  dataQuality: 'high' | 'standard' | 'limited';
  companyType: string | null;
  signalCount: number;
  signalScore: number;
  webData: WebScrapeData | null;
  cached: boolean;
}

export interface WebScrapeData {
  description: string | null;
  founded: string | null;
  headquarters: string | null;
  specialties: string[];
  companyType: string | null;
  estimatedEmployees: string | null;
  estimatedRevenue: string | null;
  socialProfiles: Record<string, string>;
}

function parseJsonFromResponse(content: string): any {
  let cleaned = content.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  return JSON.parse(cleaned);
}

async function scrapeCompanyInfo(
  companyName: string,
  domain: string | null,
  searchResults: SerperSearchResult[],
  workspaceId: string
): Promise<WebScrapeData | null> {
  if (searchResults.length === 0) return null;

  const snippets = searchResults
    .slice(0, 8)
    .map(r => `[${r.title}] ${r.snippet}`)
    .join('\n');

  const systemPrompt = `You are a company research analyst. Extract structured company data from search result snippets.
Respond with valid JSON only (no markdown):
{
  "description": "<1-2 sentence company description or null>",
  "founded": "<year or null>",
  "headquarters": "<city, state or null>",
  "specialties": ["<specialty1>", "<specialty2>"],
  "companyType": "<one of: software, services, manufacturing, healthcare_provider, directory, marketplace, consulting, financial, retail, other, or null>",
  "estimatedEmployees": "<range like '50-200' or null>",
  "estimatedRevenue": "<range like '$10M-$50M' or null>",
  "socialProfiles": {"linkedin": "<url or empty>", "twitter": "<url or empty>"}
}

If data is insufficient or the company appears to be a directory/listing site rather than a real company, set companyType to "directory" and leave other fields null.`;

  const userMessage = `Extract company info for "${companyName}"${domain ? ` (${domain})` : ''} from these search snippets:\n\n${snippets}`;

  try {
    const response = await callLLM(workspaceId, 'extract', {
      systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 1024,
      temperature: 0.1,
    });

    const parsed = parseJsonFromResponse(response.content);
    return {
      description: parsed.description || null,
      founded: parsed.founded || null,
      headquarters: parsed.headquarters || null,
      specialties: Array.isArray(parsed.specialties) ? parsed.specialties : [],
      companyType: parsed.companyType || null,
      estimatedEmployees: parsed.estimatedEmployees || null,
      estimatedRevenue: parsed.estimatedRevenue || null,
      socialProfiles: parsed.socialProfiles || {},
    };
  } catch (err) {
    logger.warn('Failed to scrape company info', {
      error: err instanceof Error ? err.message : String(err),
      companyName,
    });
    return null;
  }
}

function classifyDataQuality(
  webData: WebScrapeData | null,
  signalCount: number,
  hasApolloData: boolean,
  hasDomain: boolean
): 'high' | 'standard' | 'limited' {
  let qualityPoints = 0;

  if (hasApolloData) qualityPoints += 3;
  if (hasDomain) qualityPoints += 1;
  if (signalCount >= 3) qualityPoints += 2;
  else if (signalCount >= 1) qualityPoints += 1;

  if (webData) {
    if (webData.description) qualityPoints += 1;
    if (webData.companyType && webData.companyType !== 'directory') qualityPoints += 1;
    if (webData.estimatedEmployees) qualityPoints += 1;
  }

  if (webData?.companyType === 'directory') return 'limited';
  if (qualityPoints >= 5) return 'high';
  if (qualityPoints >= 2) return 'standard';
  return 'limited';
}

export function shouldUseApollo(
  accountId: string,
  hasActiveDeal: boolean,
  currentGrade: string | null
): boolean {
  if (!hasActiveDeal) return false;
  if (!currentGrade) return false;
  if (currentGrade === 'A' || currentGrade === 'B') return true;
  return false;
}

export async function enrichAccount(
  workspaceId: string,
  accountId: string,
  options: {
    cacheDays?: number;
    forceRefresh?: boolean;
  } = {}
): Promise<EnrichmentResult> {
  const { cacheDays = 90, forceRefresh = false } = options;

  const accountResult = await query<{
    id: string; name: string; domain: string | null;
    apollo_data: any; apollo_enriched_at: Date | null;
  }>(
    `SELECT id, name, domain, apollo_data, apollo_enriched_at
     FROM accounts WHERE id = $1 AND workspace_id = $2`,
    [accountId, workspaceId]
  );

  if (accountResult.rows.length === 0) {
    throw new Error(`Account ${accountId} not found`);
  }

  const account = accountResult.rows[0];
  const hasApolloData = !!account.apollo_data && Object.keys(account.apollo_data).length > 0;

  if (!forceRefresh) {
    const cacheCheck = await query<{
      enriched_at: Date; signal_score: string; signals: any[];
      web_scrape_data: any; data_quality: string; company_type: string;
      enrichment_source: string;
    }>(
      `SELECT enriched_at, signal_score, signals, web_scrape_data,
              data_quality, company_type, enrichment_source
       FROM account_signals
       WHERE workspace_id = $1 AND account_id = $2
         AND enriched_at > NOW() - ($3 || ' days')::interval
       ORDER BY enriched_at DESC LIMIT 1`,
      [workspaceId, accountId, cacheDays]
    );

    if (cacheCheck.rows.length > 0) {
      const cached = cacheCheck.rows[0];
      return {
        accountId,
        accountName: account.name,
        enrichmentSource: cached.enrichment_source || 'serper',
        dataQuality: (cached.data_quality as 'high' | 'standard' | 'limited') || 'standard',
        companyType: cached.company_type || null,
        signalCount: Array.isArray(cached.signals) ? cached.signals.length : 0,
        signalScore: parseFloat(cached.signal_score) || 0,
        webData: cached.web_scrape_data || null,
        cached: true,
      };
    }
  }

  const config = await getEnrichmentConfig(workspaceId);
  if (!config.serperApiKey) {
    logger.warn('No Serper API key configured', { workspaceId, accountId });
    return {
      accountId,
      accountName: account.name,
      enrichmentSource: 'none',
      dataQuality: 'limited',
      companyType: null,
      signalCount: 0,
      signalScore: 0,
      webData: null,
      cached: false,
    };
  }

  const searchResults = await searchCompanySignals(account.name, config.serperApiKey);

  const [classificationResult, webData] = await Promise.all([
    classifyAccountSignals(workspaceId, account.name, searchResults),
    scrapeCompanyInfo(account.name, account.domain, searchResults, workspaceId),
  ]);

  const dataQuality = classifyDataQuality(
    webData,
    classificationResult.signals.length,
    hasApolloData,
    !!account.domain
  );

  const companyType = webData?.companyType || null;

  await query(
    `INSERT INTO account_signals (
      workspace_id, account_id, signals, signal_summary, signal_score,
      enriched_at, enrichment_source, data_quality, web_scrape_data, company_type,
      scraped_at
    ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9, NOW())
    ON CONFLICT (workspace_id, account_id)
    DO UPDATE SET
      signals = $3, signal_summary = $4, signal_score = $5,
      enriched_at = NOW(), enrichment_source = $6, data_quality = $7,
      web_scrape_data = $8, company_type = $9, scraped_at = NOW(),
      updated_at = NOW()`,
    [
      workspaceId, accountId,
      JSON.stringify(classificationResult.signals),
      classificationResult.signal_summary,
      classificationResult.signal_score,
      'serper',
      dataQuality,
      webData ? JSON.stringify(webData) : null,
      companyType,
    ]
  );

  logger.info('Enriched account', {
    workspaceId, accountId, accountName: account.name,
    signalCount: classificationResult.signals.length,
    signalScore: classificationResult.signal_score,
    dataQuality, companyType,
  });

  return {
    accountId,
    accountName: account.name,
    enrichmentSource: 'serper',
    dataQuality,
    companyType,
    signalCount: classificationResult.signals.length,
    signalScore: classificationResult.signal_score,
    webData,
    cached: false,
  };
}
