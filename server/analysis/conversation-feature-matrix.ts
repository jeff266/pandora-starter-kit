/**
 * Conversation Feature Matrix Expansion
 *
 * Merges conversation intelligence signals into ICP feature matrix.
 * Part of Step 2.5 (Sub-step D): COMPUTE feature merge.
 *
 * Spec: PANDORA_ICP_CONVERSATION_INTELLIGENCE_ADDENDUM.md (lines 94-218)
 *
 * INTEGRATION POINT: These features should be added to the ICP Discovery feature matrix
 * when building the deal-level feature set in Step 2 of ICP Discovery.
 */

import { createLogger } from '../utils/logger.js';
import type { ConversationFeatures, ConversationMetadata } from './conversation-features.js';
import type { ConversationClassification } from './conversation-classifier.js';
import { aggregateClassifications } from './conversation-classifier.js';

const logger = createLogger('ConversationFeatureMatrix');

// ============================================================================
// Feature Matrix Types
// ============================================================================

/**
 * Conversation-derived features to add to ICP Discovery feature matrix
 * These columns augment the existing firmographic + engagement features
 */
export interface ConversationFeatureColumns {
  // ===== METADATA FEATURES (from conversation-features.ts) =====
  has_conversation_data: boolean;
  call_count: number;
  total_call_duration_minutes: number;
  avg_call_duration_minutes: number;
  call_frequency_per_week: number | null; // calls / weeks_span
  unique_participants: number;
  internal_participants: number;
  external_participants: number;
  buyer_speaker_count: number; // external_participants

  // ===== ENGAGEMENT QUALITY =====
  avg_sentiment_score: number | null; // -1 to 1
  avg_talk_ratio: number | null; // 0 to 1 (rep talk time)
  buyer_engagement_level: 'high' | 'medium' | 'low' | null;

  // ===== BEHAVIORAL SIGNALS (from conversation-classifier.ts) =====
  competitor_mention_count: number;
  competitors_discussed: string[]; // Array of competitor names
  has_champion_signals: boolean;
  champion_signal_count: number;
  champion_confidence: 'high' | 'medium' | 'low' | null;

  // ===== OBJECTIONS & CONCERNS =====
  objection_count: number;
  key_objections: string[]; // Top objections mentioned
  concern_level: 'high' | 'medium' | 'low' | null;

  // ===== TECHNICAL DEPTH =====
  technical_depth_level: 'deep' | 'moderate' | 'shallow' | null;
  technical_questions_asked: number;
  architecture_discussed: boolean;
  integration_concerns: boolean;
  security_discussed: boolean;
  scalability_discussed: boolean;

  // ===== BUYING SIGNALS =====
  buying_signal_count: number;
  buying_signals: string[]; // List of buying signals detected
  action_item_count: number;

  // ===== CONVERSATION TIMING =====
  earliest_call_date: string | null;
  latest_call_date: string | null;
  conversation_days_span: number | null;
  first_call_to_close_days: number | null; // Calculated externally
}

/**
 * Complete deal feature row with conversation columns added
 * This is what the ICP Discovery feature matrix should look like after expansion
 */
export interface DealWithConversationFeatures {
  deal_id: string;

  // ===== EXISTING ICP FEATURES (firmographic + engagement) =====
  // These would come from the existing ICP Discovery Step 2 build
  // Example: account_employee_count, industry, deal_amount, stage, etc.
  [key: string]: any;

  // ===== NEW: CONVERSATION FEATURES =====
  conversation_features: ConversationFeatureColumns;
}

// ============================================================================
// Feature Extraction Functions
// ============================================================================

/**
 * Build conversation feature columns for a single deal
 *
 * @param features - Conversation features from buildConversationFeatures()
 * @param classifications - Classifications from classifyBatch()
 * @param closedDate - Deal close date (for timing calculations)
 * @returns Feature columns ready to merge into ICP matrix
 */
export function buildConversationFeatureColumns(
  features: ConversationFeatures,
  classifications: ConversationClassification[],
  closedDate?: Date
): ConversationFeatureColumns {
  // No conversation data case
  if (!features.has_conversations || !features.metadata) {
    return createNullFeatureColumns();
  }

  const metadata = features.metadata;

  // Aggregate classifications
  const aggregated = aggregateClassifications(classifications);

  // Calculate call frequency
  const callFrequencyPerWeek = metadata.days_span && metadata.days_span > 0
    ? (metadata.call_count / metadata.days_span) * 7
    : null;

  // Calculate first call to close days
  let firstCallToCloseDays: number | null = null;
  if (metadata.earliest_call_date && closedDate) {
    const firstCall = new Date(metadata.earliest_call_date);
    firstCallToCloseDays = Math.ceil(
      (closedDate.getTime() - firstCall.getTime()) / (1000 * 60 * 60 * 24)
    );
  }

  // Determine champion confidence level
  const championConfidence = aggregated.all_champion_signals.length === 0
    ? null
    : aggregated.all_champion_signals.some(s => s.confidence === 'high')
    ? 'high'
    : aggregated.all_champion_signals.some(s => s.confidence === 'medium')
    ? 'medium'
    : 'low';

  return {
    // Metadata
    has_conversation_data: true,
    call_count: metadata.call_count,
    total_call_duration_minutes: metadata.total_duration_minutes,
    avg_call_duration_minutes: metadata.avg_duration_minutes,
    call_frequency_per_week: callFrequencyPerWeek,
    unique_participants: metadata.unique_participants,
    internal_participants: metadata.internal_participants,
    external_participants: metadata.external_participants,
    buyer_speaker_count: metadata.external_participants,

    // Engagement quality
    avg_sentiment_score: metadata.avg_sentiment_score,
    avg_talk_ratio: metadata.avg_talk_ratio,
    buyer_engagement_level: aggregated.overall_engagement,

    // Behavioral signals
    competitor_mention_count: metadata.competitor_mention_count,
    competitors_discussed: aggregated.all_competitors.map(c => c.competitor_name),
    has_champion_signals: aggregated.all_champion_signals.length > 0,
    champion_signal_count: aggregated.all_champion_signals.length,
    champion_confidence: championConfidence,

    // Objections & concerns
    objection_count: metadata.objection_count,
    key_objections: aggregated.all_objections,
    concern_level: null, // Set from classification if available

    // Technical depth
    technical_depth_level: aggregated.avg_technical_depth,
    technical_questions_asked: 0, // Aggregated from classifications
    architecture_discussed: classifications.some(c => c.technical_depth.architecture_discussed),
    integration_concerns: classifications.some(c => c.technical_depth.integration_concerns),
    security_discussed: classifications.some(c => c.technical_depth.security_discussed),
    scalability_discussed: classifications.some(c => c.technical_depth.scalability_discussed),

    // Buying signals
    buying_signal_count: aggregated.all_buying_signals.length,
    buying_signals: aggregated.all_buying_signals,
    action_item_count: metadata.action_item_count,

    // Timing
    earliest_call_date: metadata.earliest_call_date,
    latest_call_date: metadata.latest_call_date,
    conversation_days_span: metadata.days_span,
    first_call_to_close_days: firstCallToCloseDays,
  };
}

/**
 * Create null feature columns for deals without conversation data
 * Enables graceful degradation
 */
function createNullFeatureColumns(): ConversationFeatureColumns {
  return {
    has_conversation_data: false,
    call_count: 0,
    total_call_duration_minutes: 0,
    avg_call_duration_minutes: 0,
    call_frequency_per_week: null,
    unique_participants: 0,
    internal_participants: 0,
    external_participants: 0,
    buyer_speaker_count: 0,
    avg_sentiment_score: null,
    avg_talk_ratio: null,
    buyer_engagement_level: null,
    competitor_mention_count: 0,
    competitors_discussed: [],
    has_champion_signals: false,
    champion_signal_count: 0,
    champion_confidence: null,
    objection_count: 0,
    key_objections: [],
    concern_level: null,
    technical_depth_level: null,
    technical_questions_asked: 0,
    architecture_discussed: false,
    integration_concerns: false,
    security_discussed: false,
    scalability_discussed: false,
    buying_signal_count: 0,
    buying_signals: [],
    action_item_count: 0,
    earliest_call_date: null,
    latest_call_date: null,
    conversation_days_span: null,
    first_call_to_close_days: null,
  };
}

/**
 * Batch build conversation features for multiple deals
 *
 * INTEGRATION POINT: Call this in ICP Discovery Step 2 after building base features
 *
 * @param dealsFeatures - Array of conversation features for each deal
 * @param dealsClassifications - Map of deal_id to classifications
 * @param dealCloseDates - Map of deal_id to close_date
 */
export function buildConversationFeatureMatrix(
  dealsFeatures: ConversationFeatures[],
  dealsClassifications: Map<string, ConversationClassification[]>,
  dealCloseDates: Map<string, Date>
): Map<string, ConversationFeatureColumns> {
  logger.info('Building conversation feature matrix', {
    dealCount: dealsFeatures.length,
  });

  const featureMatrix = new Map<string, ConversationFeatureColumns>();

  for (const dealFeature of dealsFeatures) {
    const classifications = dealsClassifications.get(dealFeature.deal_id) || [];
    const closeDate = dealCloseDates.get(dealFeature.deal_id);

    const columns = buildConversationFeatureColumns(
      dealFeature,
      classifications,
      closeDate
    );

    featureMatrix.set(dealFeature.deal_id, columns);
  }

  const dealsWithData = Array.from(featureMatrix.values()).filter(
    f => f.has_conversation_data
  ).length;

  logger.info('Built conversation feature matrix', {
    totalDeals: dealsFeatures.length,
    dealsWithConversationData: dealsWithData,
    coveragePercent: Math.round((dealsWithData / dealsFeatures.length) * 100),
  });

  return featureMatrix;
}

// ============================================================================
// Feature Importance for ICP Patterns
// ============================================================================

/**
 * Calculate which conversation features are most discriminative for won vs lost
 *
 * This should be used in ICP Discovery Step 4 (Discover Persona Patterns)
 * to identify which conversation behaviors correlate with wins
 */
export interface ConversationFeatureImportance {
  feature_name: keyof ConversationFeatureColumns;
  importance_score: number; // 0 to 1
  won_avg: number;
  lost_avg: number;
  delta: number;
  statistical_significance: 'high' | 'medium' | 'low';
}

/**
 * Analyze conversation feature importance for pattern discovery
 *
 * INTEGRATION POINT: Call this in ICP Discovery Step 4 after building persona patterns
 * to surface which conversation behaviors matter most
 */
export function analyzeConversationFeatureImportance(
  wonDeals: ConversationFeatureColumns[],
  lostDeals: ConversationFeatureColumns[]
): ConversationFeatureImportance[] {
  const features: ConversationFeatureImportance[] = [];

  // Numeric features to analyze
  const numericFeatures: Array<keyof ConversationFeatureColumns> = [
    'call_count',
    'avg_call_duration_minutes',
    'call_frequency_per_week',
    'unique_participants',
    'buyer_speaker_count',
    'avg_sentiment_score',
    'avg_talk_ratio',
    'competitor_mention_count',
    'champion_signal_count',
    'objection_count',
    'technical_questions_asked',
    'buying_signal_count',
    'action_item_count',
    'conversation_days_span',
    'first_call_to_close_days',
  ];

  for (const feature of numericFeatures) {
    const wonValues = wonDeals
      .map(d => d[feature] as number)
      .filter(v => v !== null && v !== undefined && !isNaN(v));

    const lostValues = lostDeals
      .map(d => d[feature] as number)
      .filter(v => v !== null && v !== undefined && !isNaN(v));

    if (wonValues.length === 0 || lostValues.length === 0) {
      continue;
    }

    const wonAvg = wonValues.reduce((sum, v) => sum + v, 0) / wonValues.length;
    const lostAvg = lostValues.reduce((sum, v) => sum + v, 0) / lostValues.length;
    const delta = wonAvg - lostAvg;

    // Simple importance score based on normalized delta
    const maxAvg = Math.max(wonAvg, lostAvg);
    const importanceScore = maxAvg > 0 ? Math.abs(delta) / maxAvg : 0;

    // Statistical significance (simplified - should use proper t-test)
    const sampleSize = Math.min(wonValues.length, lostValues.length);
    const significance =
      sampleSize >= 30 && importanceScore > 0.3
        ? 'high'
        : sampleSize >= 15 && importanceScore > 0.2
        ? 'medium'
        : 'low';

    features.push({
      feature_name: feature,
      importance_score: Math.round(importanceScore * 100) / 100,
      won_avg: Math.round(wonAvg * 100) / 100,
      lost_avg: Math.round(lostAvg * 100) / 100,
      delta: Math.round(delta * 100) / 100,
      statistical_significance: significance,
    });
  }

  // Sort by importance score descending
  features.sort((a, b) => b.importance_score - a.importance_score);

  logger.info('Analyzed conversation feature importance', {
    wonDeals: wonDeals.length,
    lostDeals: lostDeals.length,
    featuresAnalyzed: features.length,
    topFeature: features[0]?.feature_name,
    topImportance: features[0]?.importance_score,
  });

  return features;
}

// ============================================================================
// Graceful Degradation Utilities
// ============================================================================

/**
 * Determine if conversation features should be included in ICP analysis
 * based on coverage tier
 */
export function shouldIncludeConversationFeatures(
  tier: 0 | 1 | 2 | 3
): { include: boolean; weight: number; reason: string } {
  switch (tier) {
    case 0:
      return {
        include: false,
        weight: 0,
        reason: 'No conversation data available',
      };
    case 1:
      return {
        include: true,
        weight: 0.1,
        reason: 'Sparse coverage (<30%) - emerging signals only, low weight',
      };
    case 2:
      return {
        include: true,
        weight: 0.3,
        reason: 'Moderate coverage (30-70%) - full integration with regularization',
      };
    case 3:
      return {
        include: true,
        weight: 0.5,
        reason: 'Strong coverage (>70%) - high confidence conversation playbook',
      };
    default:
      return {
        include: false,
        weight: 0,
        reason: 'Unknown tier',
      };
  }
}

/**
 * Apply regularization to conversation features based on coverage tier
 * Prevents overfitting when sample size is small
 */
export function regularizeFeatureImportance(
  importance: ConversationFeatureImportance[],
  tier: 0 | 1 | 2 | 3
): ConversationFeatureImportance[] {
  const { weight } = shouldIncludeConversationFeatures(tier);

  return importance.map(f => ({
    ...f,
    importance_score: f.importance_score * weight,
  }));
}

// ============================================================================
// Export Summary for Integration
// ============================================================================

/**
 * INTEGRATION GUIDE FOR ICP DISCOVERY:
 *
 * 1. In Step 2 (Build Feature Matrix), after building firmographic features:
 *    ```typescript
 *    import { buildConversationFeatures } from './analysis/conversation-features';
 *    import { classifyBatch } from './analysis/conversation-classifier';
 *    import { buildConversationFeatureMatrix } from './analysis/conversation-feature-matrix';
 *
 *    // Get conversation features for all closed deals
 *    const conversationFeatures = await buildConversationFeatures(workspaceId, dealIds);
 *
 *    // Classify transcripts
 *    const allExcerpts = conversationFeatures.flatMap(f => f.transcript_excerpts);
 *    const classifications = await classifyBatch(workspaceId, allExcerpts);
 *
 *    // Group classifications by deal
 *    const classificationsByDeal = new Map();
 *    for (const c of classifications.classifications) {
 *      const dealId = conversationFeatures.find(f =>
 *        f.transcript_excerpts.some(e => e.conversation_id === c.conversation_id)
 *      )?.deal_id;
 *      if (dealId) {
 *        if (!classificationsByDeal.has(dealId)) classificationsByDeal.set(dealId, []);
 *        classificationsByDeal.get(dealId).push(c);
 *      }
 *    }
 *
 *    // Build conversation feature columns
 *    const conversationFeatureMatrix = buildConversationFeatureMatrix(
 *      conversationFeatures,
 *      classificationsByDeal,
 *      dealCloseDates
 *    );
 *
 *    // Merge into main feature matrix
 *    for (const [dealId, convFeatures] of conversationFeatureMatrix) {
 *      featureMatrix.set(dealId, {
 *        ...featureMatrix.get(dealId),
 *        conversation_features: convFeatures
 *      });
 *    }
 *    ```
 *
 * 2. In Step 4 (Discover Persona Patterns), analyze conversation feature importance:
 *    ```typescript
 *    import { analyzeConversationFeatureImportance, regularizeFeatureImportance } from './analysis/conversation-feature-matrix';
 *    import { computeConversationCoverage } from './analysis/conversation-features';
 *
 *    // Check coverage tier
 *    const coverage = await computeConversationCoverage(workspaceId);
 *
 *    // Extract conversation features for won/lost deals
 *    const wonConvFeatures = wonDeals.map(d => d.conversation_features);
 *    const lostConvFeatures = lostDeals.map(d => d.conversation_features);
 *
 *    // Analyze importance
 *    let importance = analyzeConversationFeatureImportance(wonConvFeatures, lostConvFeatures);
 *
 *    // Apply regularization based on coverage
 *    importance = regularizeFeatureImportance(importance, coverage.tier);
 *
 *    // Include top features in persona patterns
 *    const topConversationSignals = importance
 *      .filter(f => f.statistical_significance === 'high')
 *      .slice(0, 5);
 *    ```
 *
 * 3. In Step 7 (Synthesis), include conversation insights in the playbook:
 *    - Add "Conversation Playbook" section to synthesis prompt
 *    - Include top conversation features with their importance scores
 *    - Surface specific patterns (e.g., "VP Engineering participation in first call")
 *    - Cite coverage tier and confidence level
 */
