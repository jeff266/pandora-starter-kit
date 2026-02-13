import { callLLM } from '../utils/llm-router.js';
import { createLogger } from '../utils/logger.js';
import { query } from '../db.js';
import type { SerperSearchResult } from './serper.js';

const logger = createLogger('SignalClassifier');

export interface ClassifiedSignal {
  type: 'funding' | 'hiring' | 'expansion' | 'leadership_change' | 'partnership' |
        'product_launch' | 'acquisition' | 'layoff' | 'regulatory' | 'award' | 'negative_press';
  signal: string;
  source_url: string;
  relevance: number;
  date: string | null;
}

const SIGNAL_TYPES = [
  'funding', 'hiring', 'expansion', 'leadership_change', 'partnership',
  'product_launch', 'acquisition', 'layoff', 'regulatory', 'award', 'negative_press'
] as const;

function parseJsonFromResponse(content: string): any {
  let cleaned = content.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  return JSON.parse(cleaned);
}

export async function classifyAccountSignals(
  workspaceId: string,
  companyName: string,
  searchResults: SerperSearchResult[]
): Promise<{
  signals: ClassifiedSignal[];
  signal_summary: string;
  signal_score: number;
}> {
  if (searchResults.length === 0) {
    return { signals: [], signal_summary: 'No search results to classify.', signal_score: 0 };
  }

  const systemPrompt = `You are a B2B sales intelligence analyst. Classify company news signals from search results into structured categories for sales teams.

Signal types: ${SIGNAL_TYPES.join(', ')}

Respond with valid JSON only (no markdown):
{
  "signals": [
    {
      "type": "<signal_type>",
      "signal": "<brief description>",
      "source_url": "<url>",
      "relevance": <0.0-1.0>,
      "date": "<YYYY-MM-DD or null>"
    }
  ],
  "signal_summary": "<2-3 sentence summary of key signals for a sales rep>",
  "signal_score": <-1.0 to 1.0, positive = buying signals, negative = risk signals>
}`;

  const searchData = searchResults.map(r => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
    date: r.date || null,
  }));

  const userMessage = `Classify these search results for "${companyName}" into B2B sales signals:\n\n${JSON.stringify(searchData, null, 2)}`;

  try {
    const response = await callLLM(workspaceId, 'extract', {
      systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 2048,
      temperature: 0.1,
    });

    const parsed = parseJsonFromResponse(response.content);

    const signals: ClassifiedSignal[] = (parsed.signals || [])
      .filter((s: any) => SIGNAL_TYPES.includes(s.type))
      .map((s: any) => ({
        type: s.type,
        signal: String(s.signal || ''),
        source_url: String(s.source_url || ''),
        relevance: typeof s.relevance === 'number' ? Math.min(1, Math.max(0, s.relevance)) : 0.5,
        date: s.date || null,
      }));

    return {
      signals,
      signal_summary: String(parsed.signal_summary || ''),
      signal_score: typeof parsed.signal_score === 'number'
        ? Math.min(1, Math.max(-1, parsed.signal_score))
        : 0,
    };
  } catch (err) {
    logger.warn('Failed to parse signal classification response', {
      error: err instanceof Error ? err.message : String(err),
      companyName,
    });
    return { signals: [], signal_summary: '', signal_score: 0 };
  }
}

export async function enrichAccountWithSignals(
  workspaceId: string,
  accountId: string,
  companyName: string,
  serperApiKey: string,
  cacheDays: number
): Promise<{ signalCount: number; signalScore: number; cached: boolean }> {
  const cacheCheck = await query<{ enriched_at: Date; signal_score: string; signals: any[] }>(
    `SELECT enriched_at, signal_score, signals FROM account_signals
     WHERE workspace_id = $1 AND account_id = $2
       AND enriched_at > NOW() - ($3 || ' days')::interval
     ORDER BY enriched_at DESC LIMIT 1`,
    [workspaceId, accountId, cacheDays]
  );

  if (cacheCheck.rows.length > 0) {
    const cached = cacheCheck.rows[0];
    return {
      signalCount: Array.isArray(cached.signals) ? cached.signals.length : 0,
      signalScore: parseFloat(cached.signal_score) || 0,
      cached: true,
    };
  }

  const { searchCompanySignals } = await import('./serper.js');
  const searchResults = await searchCompanySignals(companyName, serperApiKey);

  const { signals, signal_summary, signal_score } = await classifyAccountSignals(
    workspaceId, companyName, searchResults
  );

  await query(
    `INSERT INTO account_signals (workspace_id, account_id, signals, signal_summary, signal_score, enriched_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (workspace_id, account_id)
     DO UPDATE SET signals = $3, signal_summary = $4, signal_score = $5, enriched_at = NOW()`,
    [workspaceId, accountId, JSON.stringify(signals), signal_summary, signal_score]
  );

  logger.info('Enriched account with signals', {
    workspaceId, accountId, companyName,
    signalCount: signals.length, signalScore: signal_score,
  });

  return { signalCount: signals.length, signalScore: signal_score, cached: false };
}
