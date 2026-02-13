/**
 * DeepSeek Transcript Classification for Conversation Intelligence
 *
 * Classifies conversation content to extract signals:
 * - Competitor mentions
 * - Pricing/budget discussions
 * - Champion language
 * - Technical depth
 * - Sentiment trajectory
 * - Decision criteria
 *
 * Spec: PANDORA_ICP_CONVERSATION_INTELLIGENCE_ADDENDUM.md (Step 2.5C)
 */

import type { TranscriptExcerpt } from './conversation-features.js';
import { createLogger } from '../../utils/logger.js';

// Export the signal type
export interface ConversationSignal {
  dealId: string;
  competitor_mentions: string[];
  pricing_discussed: boolean;
  budget_mentioned: boolean;
  timeline_discussed: boolean;
  objection_topics: string[];
  champion_language: boolean;
  champion_evidence: string | null;
  technical_depth: number;
  sentiment_overall: 'positive' | 'neutral' | 'negative';
  sentiment_trajectory: 'improving' | 'stable' | 'declining';
  next_steps_explicit: boolean;
  decision_criteria_surfaced: string[];
}

const logger = createLogger('ConversationClassification');

// ============================================================================
// DeepSeek Classification
// ============================================================================

/**
 * Build DeepSeek prompt for conversation content classification
 * Processes up to 10 deals per batch to stay within token budget
 */
export function buildConversationClassificationPrompt(
  excerpts: TranscriptExcerpt[]
): string {
  const dealExcerpts = groupExcerptsByDeal(excerpts);

  const excerptTexts = Array.from(dealExcerpts.entries())
    .map(([dealId, convs]) => {
      const conversationTexts = convs
        .map((conv, idx) => {
          const text = conv.fullSummary || `[START]\n${conv.excerptStart}\n...\n[END]\n${conv.excerptEnd}`;
          return `### Conversation ${idx + 1}: ${conv.title}\n${text}`;
        })
        .join('\n\n');

      return `## Deal ID: ${dealId}\n${conversationTexts}`;
    })
    .join('\n\n---\n\n');

  return `You are a B2B sales call analyst. For each deal's conversation excerpts, classify the following signals. Respond with ONLY a JSON array.

For each deal, output:
{
  "deal_id": "uuid",
  "competitor_mentions": ["competitor_name", ...],  // empty array if none
  "pricing_discussed": true/false,
  "budget_mentioned": true/false,
  "timeline_discussed": true/false,
  "objection_topics": ["topic", ...],               // e.g., "security", "pricing", "integration"
  "champion_language": true/false,                   // customer used advocacy language internally
  "champion_evidence": "quote or null",              // brief evidence if true
  "technical_depth": 0-5,                            // 0=no technical, 5=deep architecture discussion
  "sentiment_overall": "positive" | "neutral" | "negative",
  "sentiment_trajectory": "improving" | "stable" | "declining",  // across multiple calls
  "next_steps_explicit": true/false,                 // were concrete next steps stated?
  "decision_criteria_surfaced": ["criterion", ...]   // what the buyer cares about
}

Deal excerpts:

${excerptTexts}

Respond with a JSON array of classification objects, one per deal.`;
}

/**
 * Parse DeepSeek response into ConversationSignal objects
 */
export function parseConversationClassifications(
  response: any[]
): Map<string, ConversationSignal> {
  const signals = new Map<string, ConversationSignal>();

  for (const item of response) {
    const signal: ConversationSignal = {
      dealId: item.deal_id,
      competitor_mentions: Array.isArray(item.competitor_mentions) ? item.competitor_mentions : [],
      pricing_discussed: item.pricing_discussed === true,
      budget_mentioned: item.budget_mentioned === true,
      timeline_discussed: item.timeline_discussed === true,
      objection_topics: Array.isArray(item.objection_topics) ? item.objection_topics : [],
      champion_language: item.champion_language === true,
      champion_evidence: item.champion_evidence || null,
      technical_depth: typeof item.technical_depth === 'number' ? item.technical_depth : 0,
      sentiment_overall: item.sentiment_overall || 'neutral',
      sentiment_trajectory: item.sentiment_trajectory || 'stable',
      next_steps_explicit: item.next_steps_explicit === true,
      decision_criteria_surfaced: Array.isArray(item.decision_criteria_surfaced)
        ? item.decision_criteria_surfaced
        : [],
    };

    signals.set(signal.dealId, signal);
  }

  logger.info('Parsed conversation classifications', { count: signals.size });

  return signals;
}

/**
 * DeepSeek JSON schema for conversation classification
 */
export const conversationClassificationSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      deal_id: { type: 'string' },
      competitor_mentions: {
        type: 'array',
        items: { type: 'string' },
      },
      pricing_discussed: { type: 'boolean' },
      budget_mentioned: { type: 'boolean' },
      timeline_discussed: { type: 'boolean' },
      objection_topics: {
        type: 'array',
        items: { type: 'string' },
      },
      champion_language: { type: 'boolean' },
      champion_evidence: { type: ['string', 'null'] },
      technical_depth: {
        type: 'number',
        minimum: 0,
        maximum: 5,
      },
      sentiment_overall: {
        type: 'string',
        enum: ['positive', 'neutral', 'negative'],
      },
      sentiment_trajectory: {
        type: 'string',
        enum: ['improving', 'stable', 'declining'],
      },
      next_steps_explicit: { type: 'boolean' },
      decision_criteria_surfaced: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: [
      'deal_id',
      'competitor_mentions',
      'pricing_discussed',
      'budget_mentioned',
      'timeline_discussed',
      'objection_topics',
      'champion_language',
      'champion_evidence',
      'technical_depth',
      'sentiment_overall',
      'sentiment_trajectory',
      'next_steps_explicit',
      'decision_criteria_surfaced',
    ],
  },
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Group excerpts by deal ID
 */
function groupExcerptsByDeal(
  excerpts: TranscriptExcerpt[]
): Map<string, TranscriptExcerpt[]> {
  const grouped = new Map<string, TranscriptExcerpt[]>();

  for (const excerpt of excerpts) {
    if (!grouped.has(excerpt.dealId)) {
      grouped.set(excerpt.dealId, []);
    }
    grouped.get(excerpt.dealId)!.push(excerpt);
  }

  return grouped;
}

/**
 * Batch excerpts for DeepSeek processing (max 10 deals per batch)
 */
export function batchExcerptsForDeepSeek(
  excerpts: TranscriptExcerpt[],
  maxDealsPerBatch: number = 10
): TranscriptExcerpt[][] {
  const dealGroups = groupExcerptsByDeal(excerpts);
  const dealIds = Array.from(dealGroups.keys());

  const batches: TranscriptExcerpt[][] = [];

  for (let i = 0; i < dealIds.length; i += maxDealsPerBatch) {
    const batchDealIds = dealIds.slice(i, i + maxDealsPerBatch);
    const batchExcerpts = batchDealIds.flatMap(dealId => dealGroups.get(dealId) || []);
    batches.push(batchExcerpts);
  }

  logger.info('Created DeepSeek batches', {
    totalDeals: dealIds.length,
    batchCount: batches.length,
  });

  return batches;
}
