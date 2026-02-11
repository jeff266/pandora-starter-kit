/**
 * Conversation Intelligence Classification
 *
 * Uses DeepSeek to classify transcript excerpts and extract behavioral signals.
 * Part of Step 2.5 (Sub-step C): DEEPSEEK tier classification.
 *
 * Spec: PANDORA_ICP_CONVERSATION_INTELLIGENCE_ADDENDUM.md
 */

import { callLLM } from '../utils/llm-router.js';
import { createLogger } from '../utils/logger.js';
import type { TranscriptExcerpt } from './conversation-features.js';

const logger = createLogger('ConversationClassifier');

// ============================================================================
// Types
// ============================================================================

export interface CompetitorMention {
  competitor_name: string;
  context: string; // What was said about them
  sentiment: 'positive' | 'neutral' | 'negative';
}

export interface ChampionSignal {
  indicator_type: 'advocate_language' | 'internal_selling' | 'urgency' | 'executive_alignment';
  excerpt: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface SentimentAnalysis {
  overall_sentiment: 'very_positive' | 'positive' | 'neutral' | 'negative' | 'very_negative';
  sentiment_score: number; // -1 to 1
  buyer_engagement: 'high' | 'medium' | 'low';
  concern_level: 'high' | 'medium' | 'low';
}

export interface TechnicalDepth {
  depth_level: 'deep' | 'moderate' | 'shallow';
  technical_questions_asked: number;
  architecture_discussed: boolean;
  integration_concerns: boolean;
  security_discussed: boolean;
  scalability_discussed: boolean;
}

export interface ConversationClassification {
  conversation_id: string;
  competitors: CompetitorMention[];
  champion_signals: ChampionSignal[];
  sentiment: SentimentAnalysis;
  technical_depth: TechnicalDepth;
  key_objections: string[];
  buying_signals: string[];
}

export interface BatchClassificationResult {
  classifications: ConversationClassification[];
  total_excerpts: number;
  successful: number;
  failed: number;
  total_tokens_used: number;
}

// ============================================================================
// Classification Prompt
// ============================================================================

const CLASSIFICATION_SYSTEM_PROMPT = `You are an expert sales conversation analyzer. You extract structured behavioral signals from sales call transcripts.

Your job is to analyze transcript excerpts and identify:
1. **Competitors mentioned**: Which competitors were discussed, in what context, and with what sentiment
2. **Champion signals**: Evidence of internal champions (advocate language, internal selling, urgency)
3. **Sentiment analysis**: Overall buyer sentiment, engagement level, concern level
4. **Technical depth**: How deep/technical the conversation was
5. **Key objections**: Main concerns or blockers raised
6. **Buying signals**: Indicators of purchase intent

Return a valid JSON object with this exact structure:
{
  "competitors": [
    {
      "competitor_name": "Company Name",
      "context": "What was said about them",
      "sentiment": "positive" | "neutral" | "negative"
    }
  ],
  "champion_signals": [
    {
      "indicator_type": "advocate_language" | "internal_selling" | "urgency" | "executive_alignment",
      "excerpt": "Relevant quote from transcript",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "sentiment": {
    "overall_sentiment": "very_positive" | "positive" | "neutral" | "negative" | "very_negative",
    "sentiment_score": -1.0 to 1.0,
    "buyer_engagement": "high" | "medium" | "low",
    "concern_level": "high" | "medium" | "low"
  },
  "technical_depth": {
    "depth_level": "deep" | "moderate" | "shallow",
    "technical_questions_asked": <number>,
    "architecture_discussed": true | false,
    "integration_concerns": true | false,
    "security_discussed": true | false,
    "scalability_discussed": true | false
  },
  "key_objections": ["objection 1", "objection 2"],
  "buying_signals": ["signal 1", "signal 2"]
}

IMPORTANT:
- Return ONLY valid JSON, no markdown formatting or extra text
- Use empty arrays [] if no items found for a category
- Be precise and evidence-based
- Extract direct quotes for champion signals when possible`;

// ============================================================================
// Classification Functions
// ============================================================================

/**
 * Classify a single transcript excerpt
 */
export async function classifySingleExcerpt(
  workspaceId: string,
  excerpt: TranscriptExcerpt
): Promise<ConversationClassification> {
  logger.debug('Classifying single excerpt', {
    workspaceId,
    conversationId: excerpt.conversation_id,
    tokenCount: excerpt.token_count,
  });

  const userPrompt = `Analyze this sales call transcript excerpt and extract structured signals:

TRANSCRIPT EXCERPT:
---
${excerpt.excerpt}
---

SOURCE: ${excerpt.source}
CALL DATE: ${excerpt.call_date || 'Unknown'}

Return the classification as JSON.`;

  try {
    const response = await callLLM(workspaceId, 'classify', {
      systemPrompt: CLASSIFICATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 2000,
      temperature: 0.1,
    });

    // Parse JSON response
    const classification = parseClassificationResponse(response.content);

    logger.debug('Classified excerpt successfully', {
      workspaceId,
      conversationId: excerpt.conversation_id,
      tokensUsed: response.usage.input + response.usage.output,
    });

    return {
      conversation_id: excerpt.conversation_id,
      ...classification,
    };
  } catch (error) {
    logger.error('Failed to classify excerpt', {
      workspaceId,
      conversationId: excerpt.conversation_id,
      error: (error as Error).message,
    });

    // Return empty classification on error
    return {
      conversation_id: excerpt.conversation_id,
      competitors: [],
      champion_signals: [],
      sentiment: {
        overall_sentiment: 'neutral',
        sentiment_score: 0,
        buyer_engagement: 'medium',
        concern_level: 'medium',
      },
      technical_depth: {
        depth_level: 'moderate',
        technical_questions_asked: 0,
        architecture_discussed: false,
        integration_concerns: false,
        security_discussed: false,
        scalability_discussed: false,
      },
      key_objections: [],
      buying_signals: [],
    };
  }
}

/**
 * Classify multiple transcript excerpts in batch
 * Processes excerpts sequentially to avoid rate limits
 */
export async function classifyBatch(
  workspaceId: string,
  excerpts: TranscriptExcerpt[]
): Promise<BatchClassificationResult> {
  logger.info('Starting batch classification', {
    workspaceId,
    excerptCount: excerpts.length,
  });

  const classifications: ConversationClassification[] = [];
  let successful = 0;
  let failed = 0;
  let totalTokensUsed = 0;

  for (const excerpt of excerpts) {
    try {
      const classification = await classifySingleExcerpt(workspaceId, excerpt);
      classifications.push(classification);
      successful++;

      // Rough estimate: 1500 input + 500 output = 2000 tokens per classification
      totalTokensUsed += 2000;
    } catch (error) {
      logger.error('Failed to classify excerpt in batch', {
        workspaceId,
        conversationId: excerpt.conversation_id,
        error: (error as Error).message,
      });
      failed++;
    }

    // Rate limiting: small delay between requests
    if (excerpts.length > 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  logger.info('Batch classification complete', {
    workspaceId,
    total: excerpts.length,
    successful,
    failed,
    estimatedTokens: totalTokensUsed,
  });

  return {
    classifications,
    total_excerpts: excerpts.length,
    successful,
    failed,
    total_tokens_used: totalTokensUsed,
  };
}

/**
 * Aggregate classifications across multiple conversations for a single deal
 */
export function aggregateClassifications(
  classifications: ConversationClassification[]
): {
  all_competitors: CompetitorMention[];
  all_champion_signals: ChampionSignal[];
  avg_sentiment_score: number;
  overall_engagement: 'high' | 'medium' | 'low';
  avg_technical_depth: 'deep' | 'moderate' | 'shallow';
  all_objections: string[];
  all_buying_signals: string[];
} {
  if (classifications.length === 0) {
    return {
      all_competitors: [],
      all_champion_signals: [],
      avg_sentiment_score: 0,
      overall_engagement: 'medium',
      avg_technical_depth: 'moderate',
      all_objections: [],
      all_buying_signals: [],
    };
  }

  // Aggregate competitors (deduplicate by name)
  const competitorMap = new Map<string, CompetitorMention>();
  for (const c of classifications) {
    for (const comp of c.competitors) {
      const existing = competitorMap.get(comp.competitor_name);
      if (!existing) {
        competitorMap.set(comp.competitor_name, comp);
      }
    }
  }

  // Aggregate champion signals
  const allChampionSignals: ChampionSignal[] = [];
  for (const c of classifications) {
    allChampionSignals.push(...c.champion_signals);
  }

  // Average sentiment score
  const sentimentScores = classifications.map(c => c.sentiment.sentiment_score);
  const avgSentimentScore = sentimentScores.reduce((sum, s) => sum + s, 0) / sentimentScores.length;

  // Overall engagement (majority vote)
  const engagementCounts = { high: 0, medium: 0, low: 0 };
  for (const c of classifications) {
    engagementCounts[c.sentiment.buyer_engagement]++;
  }
  const overallEngagement =
    engagementCounts.high >= engagementCounts.medium && engagementCounts.high >= engagementCounts.low
      ? 'high'
      : engagementCounts.medium >= engagementCounts.low
      ? 'medium'
      : 'low';

  // Average technical depth (majority vote)
  const depthCounts = { deep: 0, moderate: 0, shallow: 0 };
  for (const c of classifications) {
    depthCounts[c.technical_depth.depth_level]++;
  }
  const avgTechnicalDepth =
    depthCounts.deep >= depthCounts.moderate && depthCounts.deep >= depthCounts.shallow
      ? 'deep'
      : depthCounts.moderate >= depthCounts.shallow
      ? 'moderate'
      : 'shallow';

  // Aggregate objections and buying signals (deduplicate)
  const allObjections = Array.from(
    new Set(classifications.flatMap(c => c.key_objections))
  );
  const allBuyingSignals = Array.from(
    new Set(classifications.flatMap(c => c.buying_signals))
  );

  return {
    all_competitors: Array.from(competitorMap.values()),
    all_champion_signals: allChampionSignals,
    avg_sentiment_score: Math.round(avgSentimentScore * 100) / 100,
    overall_engagement: overallEngagement,
    avg_technical_depth: avgTechnicalDepth,
    all_objections: allObjections,
    all_buying_signals: allBuyingSignals,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse LLM response into structured classification
 */
function parseClassificationResponse(content: string): Omit<ConversationClassification, 'conversation_id'> {
  try {
    // Try to extract JSON from markdown code blocks if present
    let jsonString = content.trim();

    // Remove markdown code fences if present
    const jsonMatch = jsonString.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      jsonString = jsonMatch[1];
    }

    const parsed = JSON.parse(jsonString);

    // Validate and normalize the structure
    return {
      competitors: Array.isArray(parsed.competitors) ? parsed.competitors : [],
      champion_signals: Array.isArray(parsed.champion_signals) ? parsed.champion_signals : [],
      sentiment: parsed.sentiment || {
        overall_sentiment: 'neutral',
        sentiment_score: 0,
        buyer_engagement: 'medium',
        concern_level: 'medium',
      },
      technical_depth: parsed.technical_depth || {
        depth_level: 'moderate',
        technical_questions_asked: 0,
        architecture_discussed: false,
        integration_concerns: false,
        security_discussed: false,
        scalability_discussed: false,
      },
      key_objections: Array.isArray(parsed.key_objections) ? parsed.key_objections : [],
      buying_signals: Array.isArray(parsed.buying_signals) ? parsed.buying_signals : [],
    };
  } catch (error) {
    logger.error('Failed to parse classification response', {
      error: (error as Error).message,
      content: content.substring(0, 500),
    });

    // Return empty classification on parse error
    return {
      competitors: [],
      champion_signals: [],
      sentiment: {
        overall_sentiment: 'neutral',
        sentiment_score: 0,
        buyer_engagement: 'medium',
        concern_level: 'medium',
      },
      technical_depth: {
        depth_level: 'moderate',
        technical_questions_asked: 0,
        architecture_discussed: false,
        integration_concerns: false,
        security_discussed: false,
        scalability_discussed: false,
      },
      key_objections: [],
      buying_signals: [],
    };
  }
}

// ============================================================================
// Mock Classification (for development)
// ============================================================================

/**
 * Generate mock classification for testing without LLM calls
 */
export function generateMockClassification(conversationId: string): ConversationClassification {
  const mockCompetitors: CompetitorMention[] = [
    {
      competitor_name: 'Salesforce',
      context: 'Customer mentioned they are currently using Salesforce but finding it too complex',
      sentiment: 'negative',
    },
  ];

  const mockChampionSignals: ChampionSignal[] = [
    {
      indicator_type: 'internal_selling',
      excerpt: 'I\'ve been advocating for this solution internally and my team is excited to move forward',
      confidence: 'high',
    },
    {
      indicator_type: 'urgency',
      excerpt: 'We need to get this implemented before Q4',
      confidence: 'high',
    },
  ];

  const mockSentiment: SentimentAnalysis = {
    overall_sentiment: 'positive',
    sentiment_score: 0.6,
    buyer_engagement: 'high',
    concern_level: 'low',
  };

  const mockTechnicalDepth: TechnicalDepth = {
    depth_level: 'deep',
    technical_questions_asked: 5,
    architecture_discussed: true,
    integration_concerns: true,
    security_discussed: true,
    scalability_discussed: false,
  };

  return {
    conversation_id: conversationId,
    competitors: mockCompetitors,
    champion_signals: mockChampionSignals,
    sentiment: mockSentiment,
    technical_depth: mockTechnicalDepth,
    key_objections: [
      'Integration complexity with existing Salesforce instance',
      'Implementation timeline concerns',
    ],
    buying_signals: [
      'Budget already approved',
      'Executive alignment',
      'Ready to schedule technical deep-dive',
    ],
  };
}
