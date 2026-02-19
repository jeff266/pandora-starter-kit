// server/enrichment/account-enrichment.ts
import { query as dbQuery } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { getEnrichmentConfig } from './config.js';
import type { SerperSearchResult } from './serper.js';
import { callLLM } from '../utils/llm-router.js';

const logger = createLogger('AccountEnrichment');

export interface AccountRecord {
  id: string;
  name: string;
  domain: string | null;
}

export interface EnrichmentResult {
  accountId: string;
  accountName: string;
  siteType: 'sufficient' | 'puppeteer' | 'cheerio' | 'directory' | 'failed';
  signalCount: number;
  signalScore: number;
  confidence: number;
  apolloUsed: boolean;
}

interface SerperResults {
  firmographic: SerperSearchResult[];
  signals: SerperSearchResult[];
  news: SerperSearchResult[];
}

interface AccountClassification {
  industry: string;
  businessModel: string;
  employeeRange: string;
  growthStage: string;
  confidence: number;
  signals: Array<{ type: string; signal: string; source_url: string; relevance: number; date: string | null }>;
  signalSummary: string;
  signalScore: number;
}

const DIRECTORY_DOMAINS = [
  'healthgrades.com', 'psychologytoday.com', 'yelp.com',
  'zocdoc.com', 'maps.google.com', 'yellowpages.com', 'vitals.com',
];

const CLASSIFICATION_PROMPT = `You are a B2B account intelligence analyst.

Company: {{companyName}}

Serper search results:
{{serperSnippets}}

{{scrapedContent}}

Extract structured intelligence. Respond ONLY with valid JSON (no markdown, no explanation):

{
  "industry": "behavioral_health | healthcare_tech | b2b_saas | fintech | edtech | professional_services | manufacturing | other",
  "business_model": "b2b_saas | b2b_services | b2c | marketplace | clinical_services | enterprise_software | other",
  "employee_range": "1-10 | 11-50 | 51-200 | 201-500 | 501-1000 | 1000+",
  "growth_stage": "seed | series_a | series_b | series_c_plus | bootstrapped | enterprise | small_practice | unknown",
  "confidence": 0,
  "signals": [
    {
      "type": "funding | hiring | expansion | leadership_change | partnership | product_launch | acquisition | layoff | regulatory | award | negative_press",
      "signal": "one sentence description",
      "source_url": "url or empty string",
      "relevance": 0.0,
      "date": "YYYY-MM-DD or null"
    }
  ],
  "signal_summary": "one paragraph synthesis",
  "signal_score": 0.0
}

signal_score: -1.0 to 1.0. Positive signals (funding, hiring, expansion, partnership, product_launch, award) push toward 1.0. Negative (layoff, negative_press) toward -1.0.

If the company is a small local practice (clinical, medical, dental, legal): set confidence to 20-35, business_model to clinical_services or professional_services.`;

// Raw Serper API call with custom query string
async function serperSearch(queryStr: string, apiKey: string): Promise<SerperSearchResult[]> {
  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: queryStr, num: 10 }),
    });
    if (!response.ok) return [];
    const data = await response.json() as any;
    return (data.organic || []).map((r: any) => ({
      title: r.title || '',
      link: r.link || '',
      snippet: r.snippet || '',
      date: r.date || undefined,
    }));
  } catch {
    return [];
  }
}

async function runSerperQueries(companyName: string, apiKey: string): Promise<SerperResults> {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const dateStr = oneYearAgo.toISOString().split('T')[0];

  const [firmographic, signals, news] = await Promise.all([
    serperSearch(`"${companyName}" software B2B`, apiKey),
    serperSearch(`"${companyName}" (funding OR hiring OR layoffs OR acquisition)`, apiKey),
    serperSearch(`"${companyName}" after:${dateStr}`, apiKey),
  ]);

  return { firmographic, signals, news };
}

function extractAllSnippets(results: SerperResults): string[] {
  return [
    ...results.firmographic.map(r => `${r.title} ${r.snippet}`),
    ...results.signals.map(r => `${r.title} ${r.snippet}`),
    ...results.news.map(r => `${r.title} ${r.snippet}`),
  ];
}

function countDomainHits(results: SerperResults, domains: string[]): number {
  const allLinks = [
    ...results.firmographic.map(r => r.link),
    ...results.signals.map(r => r.link),
    ...results.news.map(r => r.link),
  ];
  return allLinks.filter(link => domains.some(d => link.includes(d))).length;
}

function hasProductLanguage(snippets: string[]): boolean {
  const productTerms = /platform|software|saas|api|dashboard|solution|automate|workflow|integration|cloud/i;
  return snippets.some(s => productTerms.test(s));
}

function hasTechMentions(results: SerperResults, techTerms: string[]): boolean {
  const allText = extractAllSnippets(results).join(' ').toLowerCase();
  return techTerms.some(t => allText.includes(t));
}

function detectSiteType(serperResults: SerperResults): 'sufficient' | 'puppeteer' | 'cheerio' | 'directory' {
  const snippets = extractAllSnippets(serperResults);
  const totalLength = snippets.join(' ').length;
  const directoryHits = countDomainHits(serperResults, DIRECTORY_DOMAINS);

  if (directoryHits >= 3) return 'directory';
  if (totalLength > 800 && hasProductLanguage(snippets)) return 'sufficient';

  const techSignals = ['react', 'next.js', 'vercel', 'spa', 'angular', 'vue', 'webpack'];
  if (hasTechMentions(serperResults, techSignals)) return 'puppeteer';
  if (totalLength < 400) return 'cheerio';

  return 'sufficient';
}

function findTopDirectoryUrl(results: SerperResults): string | null {
  const allResults = [...results.firmographic, ...results.signals, ...results.news];
  for (const r of allResults) {
    if (DIRECTORY_DOMAINS.some(d => r.link.includes(d))) return r.link;
  }
  return null;
}

async function scrapeWithPuppeteer(url: string): Promise<string | null> {
  try {
    const { default: puppeteer } = await import('puppeteer');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (compatible; Pandora/1.0)');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = await page.evaluate("document.body ? document.body.innerText : ''") as string;
    await browser.close();
    return text.slice(0, 5000) || null;
  } catch (err) {
    logger.warn('Puppeteer scrape failed', { url, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

async function scrapeWithFetch(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Pandora/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    // Extract text from <p> tags
    const paragraphs: string[] = [];
    const pRegex = /<p[^>]*>([^<]+)<\/p>/gi;
    let match: RegExpExecArray | null;
    while ((match = pRegex.exec(html)) !== null && paragraphs.join(' ').length < 3000) {
      paragraphs.push(match[1].trim());
    }
    return paragraphs.join(' ').slice(0, 3000) || null;
  } catch {
    return null;
  }
}

async function classifyAccount(
  workspaceId: string,
  companyName: string,
  serperResults: SerperResults,
  scrapedText: string | null
): Promise<AccountClassification> {
  const snippets = [
    ...serperResults.firmographic.map(r => `[Firmographic] ${r.title}: ${r.snippet}`),
    ...serperResults.signals.map(r => `[Signal] ${r.title}: ${r.snippet}`),
    ...serperResults.news.map(r => `[News] ${r.title}: ${r.snippet}`),
  ].join('\n');

  const prompt = CLASSIFICATION_PROMPT
    .replace('{{companyName}}', companyName)
    .replace('{{serperSnippets}}', snippets.slice(0, 3000))
    .replace('{{scrapedContent}}', scrapedText ? `Additional page content:\n${scrapedText.slice(0, 1500)}` : '');

  try {
    const response = await callLLM(workspaceId, 'extract', {
      systemPrompt: 'You are a B2B account intelligence analyst. Return only valid JSON.',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1024,
      temperature: 0.1,
    });

    let parsed: any;
    const content = response.content || '';
    const fenceMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    parsed = JSON.parse(fenceMatch ? fenceMatch[1] : content.trim());

    return {
      industry: String(parsed.industry || 'other'),
      businessModel: String(parsed.business_model || 'other'),
      employeeRange: String(parsed.employee_range || 'unknown'),
      growthStage: String(parsed.growth_stage || 'unknown'),
      confidence: typeof parsed.confidence === 'number' ? Math.min(100, Math.max(0, parsed.confidence)) : 30,
      signals: Array.isArray(parsed.signals) ? parsed.signals.slice(0, 20) : [],
      signalSummary: String(parsed.signal_summary || ''),
      signalScore: typeof parsed.signal_score === 'number' ? Math.min(1, Math.max(-1, parsed.signal_score)) : 0,
    };
  } catch (err) {
    logger.warn('Account classification failed, using defaults', { companyName, error: err instanceof Error ? err.message : String(err) });
    return {
      industry: 'other', businessModel: 'other', employeeRange: 'unknown',
      growthStage: 'unknown', confidence: 0, signals: [], signalSummary: '', signalScore: 0,
    };
  }
}

async function shouldUseApollo(workspaceId: string, accountId: string): Promise<boolean> {
  const hasActiveDeal = await dbQuery(
    `SELECT 1 FROM deals
     WHERE workspace_id = $1 AND account_id = $2
       AND stage_normalized NOT IN ('closed_won', 'closed_lost')
     LIMIT 1`,
    [workspaceId, accountId]
  );
  if (!hasActiveDeal.rows.length) return false;

  const score = await dbQuery(
    `SELECT total_score, grade FROM account_scores WHERE workspace_id = $1 AND account_id = $2`,
    [workspaceId, accountId]
  );
  if (score.rows.length && ['A', 'B'].includes(score.rows[0].grade)) return true;
  return false;
}

async function upsertAccountSignals(
  workspaceId: string,
  accountId: string,
  data: {
    scrapeStatus: string;
    enrichmentMethod: string;
    rawSerperData: SerperResults;
    industry: string;
    businessModel: string;
    employeeRange: string;
    growthStage: string;
    classificationConfidence: number;
    signals: any[];
    signalSummary: string;
    signalScore: number;
    scrapedText: string | null;
    scrapedUrl: string | null;
  }
): Promise<void> {
  await dbQuery(
    `INSERT INTO account_signals (
       workspace_id, account_id, scrape_status, enrichment_method, raw_serper_data,
       industry, business_model, employee_range, growth_stage, classification_confidence,
       signals, signal_summary, signal_score, scraped_text, scraped_url,
       enriched_at, stale_after, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW() + INTERVAL '180 days', NOW())
     ON CONFLICT (workspace_id, account_id) DO UPDATE SET
       scrape_status = EXCLUDED.scrape_status,
       enrichment_method = EXCLUDED.enrichment_method,
       raw_serper_data = EXCLUDED.raw_serper_data,
       industry = EXCLUDED.industry,
       business_model = EXCLUDED.business_model,
       employee_range = EXCLUDED.employee_range,
       growth_stage = EXCLUDED.growth_stage,
       classification_confidence = EXCLUDED.classification_confidence,
       signals = EXCLUDED.signals,
       signal_summary = EXCLUDED.signal_summary,
       signal_score = EXCLUDED.signal_score,
       scraped_text = EXCLUDED.scraped_text,
       scraped_url = EXCLUDED.scraped_url,
       enriched_at = NOW(),
       stale_after = NOW() + INTERVAL '180 days',
       updated_at = NOW()`,
    [
      workspaceId, accountId,
      data.scrapeStatus, data.enrichmentMethod, JSON.stringify(data.rawSerperData),
      data.industry, data.businessModel, data.employeeRange, data.growthStage,
      data.classificationConfidence,
      JSON.stringify(data.signals), data.signalSummary, data.signalScore,
      data.scrapedText, data.scrapedUrl,
    ]
  );
}

export async function enrichAccount(
  workspaceId: string,
  accountId: string,
  options?: { forceApollo?: boolean }
): Promise<EnrichmentResult> {
  const accountResult = await dbQuery<AccountRecord>(
    `SELECT id, name, domain FROM accounts WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, accountId]
  );
  if (!accountResult.rows.length) throw new Error(`Account ${accountId} not found`);
  const account = accountResult.rows[0];

  const config = await getEnrichmentConfig(workspaceId);
  if (!config.serperApiKey) {
    logger.warn('No Serper API key configured', { workspaceId });
    await upsertAccountSignals(workspaceId, accountId, {
      scrapeStatus: 'serper_failed', enrichmentMethod: 'none',
      rawSerperData: { firmographic: [], signals: [], news: [] },
      industry: 'other', businessModel: 'other', employeeRange: 'unknown', growthStage: 'unknown',
      classificationConfidence: 0, signals: [], signalSummary: '', signalScore: 0,
      scrapedText: null, scrapedUrl: null,
    });
    return { accountId, accountName: account.name, siteType: 'failed', signalCount: 0, signalScore: 0, confidence: 0, apolloUsed: false };
  }

  // Tier 1: Serper — 3 parallel queries
  const serperResults = await runSerperQueries(account.name, config.serperApiKey);
  const siteType = detectSiteType(serperResults);

  let scrapedText: string | null = null;
  let scrapedUrl: string | null = null;
  const enrichmentMethod: string = siteType;

  // Tier 2/3: Escalate if needed
  const websiteUrl = account.domain ? `https://${account.domain}` : null;

  if (siteType === 'puppeteer' && websiteUrl) {
    scrapedText = await scrapeWithPuppeteer(websiteUrl);
    scrapedUrl = websiteUrl;
  } else if (siteType === 'cheerio' && websiteUrl) {
    scrapedText = await scrapeWithFetch(websiteUrl);
    scrapedUrl = websiteUrl;
  } else if (siteType === 'directory') {
    const dirUrl = findTopDirectoryUrl(serperResults);
    if (dirUrl) {
      scrapedText = await scrapeWithFetch(dirUrl);
      scrapedUrl = dirUrl;
    }
  }

  // LLM classification
  const classification = await classifyAccount(workspaceId, account.name, serperResults, scrapedText);

  // Apollo gate (gated — account-level Apollo not yet implemented)
  const useApollo = options?.forceApollo || await shouldUseApollo(workspaceId, accountId);
  if (useApollo) {
    logger.info('Apollo gate passed — account-level Apollo enrichment not yet implemented', { accountId });
  }

  const scrapeStatus = siteType === 'sufficient' ? 'serper_complete'
    : siteType === 'puppeteer' ? 'puppeteer_complete'
    : siteType === 'cheerio' ? 'cheerio_complete'
    : siteType === 'directory' ? 'serper_complete'
    : 'serper_failed';

  await upsertAccountSignals(workspaceId, accountId, {
    scrapeStatus,
    enrichmentMethod,
    rawSerperData: serperResults,
    industry: classification.industry,
    businessModel: classification.businessModel,
    employeeRange: classification.employeeRange,
    growthStage: classification.growthStage,
    classificationConfidence: classification.confidence,
    signals: classification.signals,
    signalSummary: classification.signalSummary,
    signalScore: classification.signalScore,
    scrapedText,
    scrapedUrl,
  });

  logger.info('Account enriched', {
    accountId, accountName: account.name, siteType,
    signalCount: classification.signals.length, confidence: classification.confidence,
  });

  return {
    accountId,
    accountName: account.name,
    siteType,
    signalCount: classification.signals.length,
    signalScore: classification.signalScore,
    confidence: classification.confidence,
    apolloUsed: false,
  };
}
