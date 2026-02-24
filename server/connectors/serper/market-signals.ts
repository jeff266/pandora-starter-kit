/**
 * Market Signals via Serper News API
 *
 * Fetches company news and classifies signals:
 * - Funding rounds
 * - M&A activity
 * - Executive changes
 * - Expansions
 * - Layoffs/restructuring
 *
 * By default, only checks A/B tier accounts (ICP score >= 70)
 * Cost optimization: Focus on high-value accounts
 */

import { query } from '../../db.js';
import { callLLM } from '../../utils/llm-router.js';

interface SerperNewsResult {
  title: string;
  link: string;
  snippet: string;
  date: string;
  source: string;
  imageUrl?: string;
}

interface MarketSignal {
  type: 'funding' | 'acquisition' | 'expansion' | 'layoff' | 'executive_change' | 'product_launch' | 'partnership' | 'other';
  headline: string;
  description: string;
  date: string;
  source: string;
  url: string;
  relevance: 'high' | 'medium' | 'low';
  buying_trigger: boolean;
  priority: 'critical' | 'high' | 'medium' | 'low';
  confidence: number; // 0-1
}

interface MarketSignalsResult {
  account_id: string;
  account_name: string;
  domain: string | null;
  icp_tier: string | null;
  icp_score: number | null;
  signals: MarketSignal[];
  signal_strength: 'hot' | 'warm' | 'neutral' | 'cold';
  strongest_signal: MarketSignal | null;
  checked_at: Date;
  news_articles_found: number;
}

export class MarketSignalsCollector {
  private serperApiKey: string;
  private serperBaseUrl = 'https://google.serper.dev/news';

  constructor(apiKey?: string) {
    this.serperApiKey = apiKey || process.env.SERPER_API_KEY || '';
    if (!this.serperApiKey) {
      console.warn('[MarketSignals] No SERPER_API_KEY found in environment');
    }
  }

  /**
   * Check if Serper API is configured
   */
  isConfigured(): boolean {
    return !!this.serperApiKey;
  }

  /**
   * Get market signals for an account
   * By default, only works for A/B tier accounts unless force_check=true
   */
  async getSignalsForAccount(
    workspaceId: string,
    accountId: string,
    options?: {
      force_check?: boolean;
      lookback_months?: number;
    }
  ): Promise<MarketSignalsResult> {
    const forceCheck = options?.force_check || false;
    const lookbackMonths = options?.lookback_months || 3;

    // Get account info including ICP score
    const accountResult = await query<{
      name: string;
      domain: string | null;
      icp_score: number | null;
      icp_tier: string | null;
    }>(
      `SELECT
        a.name,
        a.domain,
        s.icp_score,
        CASE
          WHEN s.icp_score >= 85 THEN 'A'
          WHEN s.icp_score >= 70 THEN 'B'
          WHEN s.icp_score >= 50 THEN 'C'
          ELSE 'D'
        END as icp_tier
      FROM accounts a
      LEFT JOIN account_scores s ON s.account_id = a.id
      WHERE a.id = $1 AND a.workspace_id = $2`,
      [accountId, workspaceId]
    );

    if (accountResult.rows.length === 0) {
      throw new Error('Account not found');
    }

    const account = accountResult.rows[0];
    const icpTier = account.icp_tier || 'D';

    // Check if account qualifies for signal checking
    if (!forceCheck && !['A', 'B'].includes(icpTier)) {
      return {
        account_id: accountId,
        account_name: account.name,
        domain: account.domain,
        icp_tier: icpTier,
        icp_score: account.icp_score,
        signals: [],
        signal_strength: 'neutral',
        strongest_signal: null,
        checked_at: new Date(),
        news_articles_found: 0,
      };
    }

    // Fetch news
    console.log(`[MarketSignals] Fetching news for account: ${account.name} (${icpTier} tier)`);
    const newsArticles = await this.fetchCompanyNews(account.name, account.domain, lookbackMonths);

    if (newsArticles.length === 0) {
      console.log(`[MarketSignals] No news found for ${account.name}`);
      return {
        account_id: accountId,
        account_name: account.name,
        domain: account.domain,
        icp_tier: icpTier,
        icp_score: account.icp_score,
        signals: [],
        signal_strength: 'neutral',
        strongest_signal: null,
        checked_at: new Date(),
        news_articles_found: 0,
      };
    }

    // Classify signals using LLM
    const signals = await this.classifySignals(newsArticles, account.name);

    // Assess overall signal strength
    const signalStrength = this.assessSignalStrength(signals);
    const strongestSignal = this.getStrongestSignal(signals);

    return {
      account_id: accountId,
      account_name: account.name,
      domain: account.domain,
      icp_tier: icpTier,
      icp_score: account.icp_score,
      signals,
      signal_strength: signalStrength,
      strongest_signal: strongestSignal,
      checked_at: new Date(),
      news_articles_found: newsArticles.length,
    };
  }

  /**
   * Fetch company news from Serper API
   */
  private async fetchCompanyNews(
    companyName: string,
    domain: string | null,
    lookbackMonths: number
  ): Promise<SerperNewsResult[]> {
    if (!this.serperApiKey) {
      throw new Error('SERPER_API_KEY not configured');
    }

    try {
      // Build search query - focus on high-signal events
      const searchQuery = `"${companyName}" AND (funding OR acquisition OR "Series A" OR "Series B" OR "Series C" OR expansion OR layoff OR CEO OR CFO OR merger OR partnership)`;

      // Calculate date range for recency filter
      const sinceDate = new Date();
      sinceDate.setMonth(sinceDate.getMonth() - lookbackMonths);
      const dateFilter = `qdr:m${lookbackMonths}`; // Last N months

      const requestBody = {
        q: searchQuery,
        num: 10, // Max results
        tbs: dateFilter,
      };

      console.log(`[MarketSignals] Serper query: ${searchQuery.substring(0, 80)}...`);

      const response = await fetch(this.serperBaseUrl, {
        method: 'POST',
        headers: {
          'X-API-KEY': this.serperApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[MarketSignals] Serper API error (${response.status}):`, errorText);

        if (response.status === 401) {
          throw new Error('Invalid Serper API key');
        }
        if (response.status === 429) {
          throw new Error('Rate limit exceeded');
        }

        throw new Error(`Serper API error: ${response.status}`);
      }

      const result = await response.json();

      // Extract news articles
      const news: SerperNewsResult[] = (result.news || []).map((article: any) => ({
        title: article.title,
        link: article.link,
        snippet: article.snippet || '',
        date: article.date || '',
        source: article.source || 'Unknown',
        imageUrl: article.imageUrl,
      }));

      console.log(`[MarketSignals] Found ${news.length} articles for ${companyName}`);

      return news;
    } catch (error: any) {
      console.error('[MarketSignals] Error fetching news:', error.message);
      throw error;
    }
  }

  /**
   * Classify news articles into structured signals using LLM
   */
  private async classifySignals(
    newsArticles: SerperNewsResult[],
    companyName: string
  ): Promise<MarketSignal[]> {
    if (newsArticles.length === 0) {
      return [];
    }

    // Prepare news summary for LLM
    const newsSummary = newsArticles
      .map((article, i) => `${i + 1}. ${article.title}\n   ${article.snippet}\n   Source: ${article.source} (${article.date})`)
      .join('\n\n');

    const prompt = `Analyze these news articles about ${companyName} and extract market signals.

NEWS ARTICLES:
${newsSummary}

Classify each significant event into structured signals. For each signal, determine:

1. TYPE: funding, acquisition, expansion, layoff, executive_change, product_launch, partnership, or other
2. RELEVANCE: high (directly impacts buying decisions), medium (notable but indirect), low (minimal impact)
3. BUYING_TRIGGER: true if this creates a buying opportunity (funding = expansion budget, new exec = fresh evaluation, expansion = new needs)
4. PRIORITY: critical (act within 24h), high (act within week), medium (monitor), low (FYI only)
5. CONFIDENCE: 0-1 score on classification accuracy

Return JSON array of signals:
[
  {
    "type": "funding",
    "headline": "Acme Corp raises $50M Series B",
    "description": "Company raised $50M led by Sequoia to expand product line and enter new markets",
    "date": "2024-01-15",
    "source": "TechCrunch",
    "url": "https://...",
    "relevance": "high",
    "buying_trigger": true,
    "priority": "high",
    "confidence": 0.95
  }
]

IMPORTANT:
- Only extract signals with relevance "high" or "medium"
- Ignore generic press releases, awards, blog posts
- Focus on events that impact company strategy, budget, or decision-making
- If no significant signals found, return empty array []`;

    try {
      const response = await callLLM({
        model: 'deepseek',
        systemPrompt: 'You are a market intelligence analyst. Extract and classify company signals from news articles. Return valid JSON only.',
        prompt,
        options: {
          temperature: 0.1, // Low temperature for consistent classification
          max_tokens: 2000,
        },
      });

      // Parse LLM response
      const content = response.content || '';

      // Extract JSON from response (handle markdown code blocks)
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?$/g, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```\n?/g, '');
      }

      const parsed = JSON.parse(jsonStr);

      if (!Array.isArray(parsed)) {
        console.warn('[MarketSignals] LLM returned non-array, wrapping');
        return [];
      }

      // Map to MarketSignal interface with URLs from original articles
      const signals: MarketSignal[] = parsed
        .map((s: any, index: number) => ({
          type: s.type || 'other',
          headline: s.headline || newsArticles[index]?.title || 'Unknown',
          description: s.description || s.headline || '',
          date: s.date || newsArticles[index]?.date || new Date().toISOString(),
          source: s.source || newsArticles[index]?.source || 'Unknown',
          url: s.url || newsArticles[index]?.link || '',
          relevance: s.relevance || 'medium',
          buying_trigger: s.buying_trigger === true,
          priority: s.priority || 'medium',
          confidence: s.confidence || 0.5,
        }))
        .filter((s) => s.relevance === 'high' || s.relevance === 'medium'); // Only keep high/medium relevance

      console.log(`[MarketSignals] Classified ${signals.length} signals for ${companyName}`);

      return signals;
    } catch (error: any) {
      console.error('[MarketSignals] Error classifying signals:', error.message);

      // Fallback: return basic signals from headlines
      return newsArticles.slice(0, 5).map((article) => ({
        type: 'other' as const,
        headline: article.title,
        description: article.snippet,
        date: article.date,
        source: article.source,
        url: article.link,
        relevance: 'medium' as const,
        buying_trigger: false,
        priority: 'medium' as const,
        confidence: 0.3,
      }));
    }
  }

  /**
   * Assess overall signal strength based on signals found
   */
  private assessSignalStrength(signals: MarketSignal[]): 'hot' | 'warm' | 'neutral' | 'cold' {
    if (signals.length === 0) return 'neutral';

    const criticalCount = signals.filter((s) => s.priority === 'critical').length;
    const highCount = signals.filter((s) => s.priority === 'high').length;
    const buyingTriggers = signals.filter((s) => s.buying_trigger).length;

    // Hot: Multiple high-priority signals or any critical signal
    if (criticalCount > 0 || highCount >= 2 || buyingTriggers >= 2) {
      return 'hot';
    }

    // Warm: At least one high-priority or buying trigger
    if (highCount > 0 || buyingTriggers > 0) {
      return 'warm';
    }

    // Neutral: Some signals but low priority
    return 'neutral';
  }

  /**
   * Get the strongest/most relevant signal
   */
  private getStrongestSignal(signals: MarketSignal[]): MarketSignal | null {
    if (signals.length === 0) return null;

    // Priority: critical > high > medium > low
    const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };

    return signals.reduce((strongest, signal) => {
      const currentPriority = priorityOrder[signal.priority] || 0;
      const strongestPriority = priorityOrder[strongest.priority] || 0;

      if (currentPriority > strongestPriority) return signal;
      if (currentPriority === strongestPriority && signal.confidence > strongest.confidence) return signal;

      return strongest;
    });
  }

  /**
   * Store signals in database for future reference
   */
  async storeSignals(workspaceId: string, accountId: string, signals: MarketSignal[]): Promise<void> {
    for (const signal of signals) {
      try {
        await query(
          `INSERT INTO account_signals (
            workspace_id,
            account_id,
            signal_type,
            signal_category,
            headline,
            description,
            source,
            source_url,
            signal_date,
            priority,
            relevance,
            buying_trigger,
            confidence,
            metadata
          ) VALUES ($1, $2, 'market_news', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          ON CONFLICT (workspace_id, account_id, signal_type, headline, signal_date)
          DO UPDATE SET
            description = EXCLUDED.description,
            priority = EXCLUDED.priority,
            relevance = EXCLUDED.relevance,
            updated_at = now()`,
          [
            workspaceId,
            accountId,
            signal.type,
            signal.headline,
            signal.description,
            signal.source,
            signal.url,
            signal.date,
            signal.priority,
            signal.relevance,
            signal.buying_trigger,
            signal.confidence,
            JSON.stringify({ type: signal.type }),
          ]
        );
      } catch (error: any) {
        console.error(`[MarketSignals] Error storing signal:`, error.message);
      }
    }
  }
}

// Singleton instance
let marketSignalsCollector: MarketSignalsCollector | null = null;

export function getMarketSignalsCollector(): MarketSignalsCollector {
  if (!marketSignalsCollector) {
    marketSignalsCollector = new MarketSignalsCollector();
  }
  return marketSignalsCollector;
}
