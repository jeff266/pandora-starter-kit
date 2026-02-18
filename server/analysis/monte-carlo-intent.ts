/**
 * Monte Carlo Intent Classifier
 *
 * Uses DeepSeek to extract structured intent from a natural language question
 * about a Monte Carlo revenue forecast simulation.
 */

import { callLLM } from '../utils/llm-router.js';
import type { QueryType } from './monte-carlo-queries.js';
import type { HistoryTurn } from '../lib/conversation-history.js';

export interface QueryIntent {
  type: QueryType;
  params: {
    dealName?: string;
    repName?: string;
    targetRevenue?: number;
    winRateImprovement?: number;
    timeframe?: string;
    threshold?: 'top_quartile' | 'above_target' | 'bottom_quartile' | 'below_target';
  };
  confidence: number;
  rawQuestion: string;
}

export async function classifyQueryIntent(
  question: string,
  context: {
    workspaceId: string;
    pipelineType: string;
    p50: number;
    quota: number | null;
    openDealNames: string[];
    repNames: string[];
    conversationHistory?: HistoryTurn[];
  }
): Promise<QueryIntent> {
  const historyText = (context.conversationHistory ?? [])
    .slice()
    .reverse()
    .map(t => `${t.role === 'user' ? 'User' : 'Pandora'}: ${t.content.slice(0, 150)}`)
    .join('\n');

  const prompt = `You are classifying a question about a Monte Carlo revenue forecast simulation.

WORKSPACE CONTEXT:
Pipeline type: ${context.pipelineType}
P50 (most likely outcome): $${Math.round(context.p50).toLocaleString()}
Annual quota: ${context.quota ? `$${Math.round(context.quota).toLocaleString()}` : 'not set'}
Open deals: ${context.openDealNames.slice(0, 20).join(', ') || 'none'}
Reps: ${context.repNames.slice(0, 10).join(', ') || 'none'}
${historyText ? `\nCONVERSATION HISTORY (most recent first):\n${historyText}\n\nUse this to resolve pronouns and references. "that deal" → refers to the most recently mentioned deal name in history. "those three" → refers to the list most recently enumerated. If no history or no reference, classify based on the question alone.` : ''}

QUESTION: "${question}"

Classify this question into one of these types:
- deal_probability: asks about probability of a specific deal closing
- must_close: asks which deals need to close to hit a target
- what_if_win_rate: asks what happens if win rate changes (e.g. "if win rate improves to 25%")
- what_if_deal: asks what happens if a specific deal closes (e.g. "if we close Acme")
- scenario_decompose: asks what winning/losing scenarios look like, what do top/bottom scenarios have in common
- component_sensitivity: asks what happens with no new deals / if pipeline generation stops
- rep_impact: asks about impact of a specific rep leaving or changing
- pipeline_creation_target: asks how much pipeline to create, how many deals needed per month/quarter, what prospecting pace is required to hit target, what creation rate is needed
- unknown: question is about something else not covered above

Examples of pipeline_creation_target:
- "how much pipeline do I need to create per month?"
- "how many new deals do we need to hit target?"
- "what's our required pipeline creation rate?"
- "if we keep creating pipeline at this pace, do we hit the number?"
- "how much do reps need to prospect?"

Extract any named entities (deal names, rep names) and numerical values (percentages, dollar amounts).
For winRateImprovement: extract the TARGET rate, not the delta. E.g. "improve to 25%" → 0.25, "improve by 30%" → multiply current by 1.3 (return 1.3 as multiplier).
For targetRevenue: extract the dollar amount mentioned (e.g. "$2.1M" → 2100000).

Respond ONLY with valid JSON:
{
  "type": "...",
  "params": {
    "dealName": null,
    "repName": null,
    "targetRevenue": null,
    "winRateImprovement": null,
    "timeframe": null,
    "threshold": null
  },
  "confidence": 0.0
}`;

  try {
    const response = await callLLM(context.workspaceId, 'classify', {
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 300,
      temperature: 0.1,
    });

    const text = response.content.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      type: (parsed.type as QueryType) || 'unknown',
      params: {
        dealName: parsed.params?.dealName ?? undefined,
        repName: parsed.params?.repName ?? undefined,
        targetRevenue: parsed.params?.targetRevenue ?? undefined,
        winRateImprovement: parsed.params?.winRateImprovement ?? undefined,
        timeframe: parsed.params?.timeframe ?? undefined,
        threshold: parsed.params?.threshold ?? undefined,
      },
      confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.5)),
      rawQuestion: question,
    };
  } catch {
    // Graceful fallback — return unknown intent
    return {
      type: 'unknown',
      params: {},
      confidence: 0,
      rawQuestion: question,
    };
  }
}

/**
 * Fuzzy entity matching — resolve a name to an ID from a list of candidates.
 * Returns the first candidate whose name contains the query (case-insensitive),
 * or whose query contains the candidate's name.
 */
export function fuzzyMatch(
  query: string | undefined | unknown,
  candidates: { id: string; name: string }[]
): { id: string; name: string } | null {
  if (!query || typeof query !== 'string') return null;
  const q = query.toLowerCase().trim();
  if (!q) return null;

  // Exact match first
  for (const c of candidates) {
    if (c.name.toLowerCase() === q) return c;
  }

  // Contains match
  for (const c of candidates) {
    const n = c.name.toLowerCase();
    if (n.includes(q) || q.includes(n)) return c;
  }

  // Word overlap
  const queryWords = q.split(/\s+/);
  for (const c of candidates) {
    const nameWords = c.name.toLowerCase().split(/\s+/);
    const overlap = queryWords.filter(w => w.length > 2 && nameWords.some(nw => nw.includes(w) || w.includes(nw)));
    if (overlap.length >= Math.min(2, queryWords.length)) return c;
  }

  return null;
}
