/**
 * Deal Insights Extraction Service
 *
 * Extracts qualification insights (MEDDPIC/BANT/SPICED) from conversation
 * transcripts using DeepSeek classification.
 *
 * Spec: PANDORA_DEAL_INSIGHTS_SPEC.md (Part 4)
 */

import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('DealInsightsExtractor');

// ============================================================================
// Types
// ============================================================================

export interface InsightConfig {
  framework: 'meddpic' | 'meddpicc' | 'bant' | 'spiced' | 'meddicc' | 'custom' | 'none';
  active_insights: InsightTypeConfig[];
  crm_field_mappings: CrmFieldMapping[];
  min_confidence: number;
  extract_from_summaries: boolean;
  extract_from_transcripts: boolean;
}

export interface InsightTypeConfig {
  insight_type: string;
  label: string;
  description: string;
  framework_source: string;
  enabled: boolean;
}

export interface CrmFieldMapping {
  insight_type: string;
  crm_object: string;
  crm_field_name: string;
  crm_field_type: string;
  source: string;
}

interface InsightCandidate {
  insight_type: string;
  value: string;
  confidence: number;
  source_quote: string;
}

interface ExtractionResult {
  conversationId: string;
  dealId: string;
  extractedCount: number;
  skippedCount: number;
  insights: InsightCandidate[];
}

// ============================================================================
// Main Extraction Flow
// ============================================================================

/**
 * Extract insights from unprocessed conversations
 * Runs after Gong/Fireflies sync or on-demand
 */
export async function extractInsightsFromConversations(
  workspaceId: string,
  options: {
    batchSize?: number;
    conversationIds?: string[]; // Optional: process specific conversations
  } = {}
): Promise<{
  processed: number;
  extracted: number;
  skipped: number;
  errors: number;
}> {
  const batchSize = options.batchSize || 20;

  logger.info('[Deal Insights] Starting extraction', {
    workspaceId,
    batchSize,
    specificConversations: options.conversationIds?.length || 0,
  });

  // Load workspace insight config
  const config = await getInsightConfig(workspaceId);

  if (!config || config.active_insights.filter(i => i.enabled).length === 0) {
    logger.info('[Deal Insights] No active insights configured, skipping extraction');
    return { processed: 0, extracted: 0, skipped: 0, errors: 0 };
  }

  // Find unprocessed conversations
  const conversations = await findUnprocessedConversations(
    workspaceId,
    batchSize,
    options.conversationIds
  );

  if (conversations.length === 0) {
    logger.info('[Deal Insights] No unprocessed conversations found');
    return { processed: 0, extracted: 0, skipped: 0, errors: 0 };
  }

  logger.info('[Deal Insights] Found unprocessed conversations', {
    count: conversations.length,
  });

  let processed = 0;
  let totalExtracted = 0;
  let totalSkipped = 0;
  let errors = 0;

  // Process each conversation
  for (const conversation of conversations) {
    try {
      const result = await extractInsightsFromConversation(
        conversation,
        config
      );

      // Store insights
      await storeInsights(workspaceId, result);

      processed++;
      totalExtracted += result.extractedCount;
      totalSkipped += result.skippedCount;

      logger.info('[Deal Insights] Processed conversation', {
        conversationId: conversation.id,
        dealId: conversation.deal_id,
        extracted: result.extractedCount,
        skipped: result.skippedCount,
      });
    } catch (error) {
      logger.error('[Deal Insights] Failed to process conversation', {
        conversationId: conversation.id,
        error,
      });
      errors++;
    }
  }

  logger.info('[Deal Insights] Extraction complete', {
    processed,
    extracted: totalExtracted,
    skipped: totalSkipped,
    errors,
  });

  return {
    processed,
    extracted: totalExtracted,
    skipped: totalSkipped,
    errors,
  };
}

// ============================================================================
// Configuration Management
// ============================================================================

/**
 * Get insight configuration from workspace context_layer
 */
async function getInsightConfig(workspaceId: string): Promise<InsightConfig | null> {
  const result = await query<{ definitions: any }>(
    `SELECT definitions FROM context_layer
     WHERE workspace_id = $1 LIMIT 1`,
    [workspaceId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const definitions = result.rows[0].definitions || {};
  const insightConfig = definitions.insight_config;

  if (!insightConfig) {
    return null;
  }

  return {
    framework: insightConfig.framework || 'none',
    active_insights: insightConfig.active_insights || [],
    crm_field_mappings: insightConfig.crm_field_mappings || [],
    min_confidence: insightConfig.min_confidence || 0.6,
    extract_from_summaries: insightConfig.extract_from_summaries ?? true,
    extract_from_transcripts: insightConfig.extract_from_transcripts ?? true,
  };
}

// ============================================================================
// Find Unprocessed Conversations
// ============================================================================

/**
 * Find conversations that need insight extraction
 */
async function findUnprocessedConversations(
  workspaceId: string,
  limit: number,
  conversationIds?: string[]
): Promise<Array<{
  id: string;
  deal_id: string;
  deal_name: string;
  deal_stage: string;
  deal_amount: number;
  account_name: string;
  title: string;
  started_at: string;
  duration_seconds: number;
  participants: any;
  transcript_text: string | null;
  summary: string | null;
}>> {
  let whereClause = `c.workspace_id = $1
    AND c.is_internal = false
    AND c.deal_id IS NOT NULL
    AND c.duration_seconds > 120`; // Skip very short calls

  const params: any[] = [workspaceId];

  if (conversationIds && conversationIds.length > 0) {
    params.push(conversationIds);
    whereClause += ` AND c.id = ANY($2::uuid[])`;
  } else {
    // Only find conversations without insights yet
    whereClause += ` AND NOT EXISTS (
      SELECT 1 FROM deal_insights di
      WHERE di.source_conversation_id = c.id
    )`;
  }

  const result = await query<{
    id: string;
    deal_id: string;
    deal_name: string;
    deal_stage: string;
    deal_amount: number;
    account_name: string;
    title: string;
    started_at: string;
    duration_seconds: number;
    participants: any;
    transcript_text: string | null;
    summary: string | null;
  }>(`
    SELECT
      c.id,
      c.deal_id,
      d.name as deal_name,
      d.stage as deal_stage,
      d.amount as deal_amount,
      a.name as account_name,
      c.title,
      c.call_date::text as started_at,
      c.duration_seconds,
      c.participants,
      c.transcript_text,
      c.summary
    FROM conversations c
    JOIN deals d ON d.id = c.deal_id AND d.workspace_id = c.workspace_id
    LEFT JOIN accounts a ON a.id = d.account_id AND a.workspace_id = d.workspace_id
    WHERE ${whereClause}
    ORDER BY c.call_date DESC
    LIMIT $${params.length + 1}
  `, [...params, limit]);

  return result.rows;
}

// ============================================================================
// DeepSeek Extraction
// ============================================================================

/**
 * Extract insights from a single conversation using DeepSeek
 */
async function extractInsightsFromConversation(
  conversation: {
    id: string;
    deal_id: string;
    deal_name: string;
    deal_stage: string;
    deal_amount: number;
    account_name: string;
    title: string;
    started_at: string;
    participants: any;
    transcript_text: string | null;
    summary: string | null;
  },
  config: InsightConfig
): Promise<ExtractionResult> {
  // Determine what text to use for extraction
  let textForExtraction: string | null = null;

  if (config.extract_from_transcripts && conversation.transcript_text) {
    textForExtraction = conversation.transcript_text;
  } else if (config.extract_from_summaries && conversation.summary) {
    textForExtraction = conversation.summary;
  }

  if (!textForExtraction) {
    logger.warn('[Deal Insights] No text available for extraction', {
      conversationId: conversation.id,
      hasTranscript: !!conversation.transcript_text,
      hasSummary: !!conversation.summary,
    });

    return {
      conversationId: conversation.id,
      dealId: conversation.deal_id,
      extractedCount: 0,
      skippedCount: 0,
      insights: [],
    };
  }

  // Build DeepSeek prompt
  const prompt = buildExtractionPrompt(conversation, textForExtraction, config);

  // TODO: Call DeepSeek API when integrated
  // For now, return empty result
  logger.info('[Deal Insights] DeepSeek extraction not yet wired', {
    conversationId: conversation.id,
    textLength: textForExtraction.length,
    activeInsights: config.active_insights.filter(i => i.enabled).length,
  });

  // Mock response structure for now
  const mockResponse = {
    insights: [],
    no_signal: config.active_insights.map(i => i.insight_type),
  };

  return {
    conversationId: conversation.id,
    dealId: conversation.deal_id,
    extractedCount: 0,
    skippedCount: mockResponse.no_signal.length,
    insights: [],
  };
}

/**
 * Build DeepSeek prompt for insight extraction
 */
function buildExtractionPrompt(
  conversation: {
    deal_name: string;
    deal_stage: string;
    deal_amount: number;
    account_name: string;
    started_at: string;
    participants: any;
  },
  text: string,
  config: InsightConfig
): string {
  const activeInsights = config.active_insights.filter(i => i.enabled);

  const participantNames = Array.isArray(conversation.participants)
    ? conversation.participants.map((p: any) => p.name || 'Unknown').join(', ')
    : 'Unknown';

  return `You are extracting qualification insights from a sales call transcript.

Deal: ${conversation.deal_name} (${conversation.deal_stage}, $${conversation.deal_amount})
Account: ${conversation.account_name}
Call date: ${conversation.started_at}
Call participants: ${participantNames}

Active insight types to extract:
${activeInsights.map(i => `- ${i.insight_type}: ${i.description}`).join('\n')}

Transcript:
${text}

For each insight type, extract the relevant information if discussed in this call.
Only extract insights you have clear evidence for — do not guess or infer.

Respond with ONLY valid JSON, no markdown:
{
  "insights": [
    {
      "insight_type": "champion",
      "value": "Sarah Chen (VP Engineering) — actively advocating internally, offered to set up meeting with CTO",
      "confidence": 0.85,
      "source_quote": "Sarah mentioned she'd already briefed the CTO and wants to get us in front of him next week"
    }
  ],
  "no_signal": ["budget", "competition"]
}

Rules:
- value: 1-2 sentences capturing the insight. Include names and specifics.
- confidence: 0.0-1.0. Higher for explicit statements, lower for inferences.
- source_quote: The most relevant 1-2 sentences from the transcript. Max 200 chars.
- no_signal: List insight types discussed but with no clear finding, OR not discussed at all.
- Do NOT extract an insight if confidence would be below ${config.min_confidence}.
- If the call is purely administrative or off-topic, return empty insights array.`;
}

// ============================================================================
// Store Insights with Versioning
// ============================================================================

/**
 * Store extracted insights in database with versioning
 */
async function storeInsights(
  workspaceId: string,
  result: ExtractionResult
): Promise<void> {
  if (result.insights.length === 0) {
    return;
  }

  for (const insight of result.insights) {
    // Check if deal already has a current insight for this type
    const existing = await query<{ id: string; value: string }>(
      `SELECT id, value FROM deal_insights
       WHERE workspace_id = $1
         AND deal_id = $2
         AND insight_type = $3
         AND is_current = true`,
      [workspaceId, result.dealId, insight.insight_type]
    );

    if (existing.rows.length > 0) {
      const existingInsight = existing.rows[0];

      // Check if value meaningfully different
      if (existingInsight.value === insight.value) {
        logger.debug('[Deal Insights] Skipping duplicate insight', {
          dealId: result.dealId,
          insightType: insight.insight_type,
        });
        continue;
      }

      // Value changed - supersede old insight
      logger.info('[Deal Insights] Superseding existing insight', {
        dealId: result.dealId,
        insightType: insight.insight_type,
        oldValue: existingInsight.value.substring(0, 50),
        newValue: insight.value.substring(0, 50),
      });

      // Insert new insight first to get its ID
      const newResult = await query<{ id: string }>(
        `INSERT INTO deal_insights (
          workspace_id, deal_id, insight_type, insight_key, value, confidence,
          source_conversation_id, source_quote, is_current
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
        RETURNING id`,
        [
          workspaceId,
          result.dealId,
          insight.insight_type,
          insight.insight_type, // Use insight_type as default key
          insight.value,
          insight.confidence,
          result.conversationId,
          insight.source_quote.substring(0, 500),
        ]
      );

      const newId = newResult.rows[0].id;

      // Mark old as superseded
      await query(
        `UPDATE deal_insights
         SET is_current = false, superseded_by = $1
         WHERE id = $2`,
        [newId, existingInsight.id]
      );
    } else {
      // No existing insight - insert new
      await query(
        `INSERT INTO deal_insights (
          workspace_id, deal_id, insight_type, insight_key, value, confidence,
          source_conversation_id, source_quote, is_current
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
        [
          workspaceId,
          result.dealId,
          insight.insight_type,
          insight.insight_type,
          insight.value,
          insight.confidence,
          result.conversationId,
          insight.source_quote.substring(0, 500),
        ]
      );

      logger.info('[Deal Insights] Inserted new insight', {
        dealId: result.dealId,
        insightType: insight.insight_type,
        confidence: insight.confidence,
      });
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get current insights for a deal
 */
export async function getCurrentInsights(
  workspaceId: string,
  dealId: string
): Promise<Array<{
  insight_type: string;
  insight_key: string;
  value: string;
  confidence: number;
  extracted_at: string;
  source_quote: string | null;
}>> {
  const result = await query<{
    insight_type: string;
    insight_key: string;
    value: string;
    confidence: number;
    extracted_at: string;
    source_quote: string | null;
  }>(
    `SELECT insight_type, insight_key, value, confidence,
            extracted_at::text as extracted_at, source_quote
     FROM deal_insights
     WHERE workspace_id = $1 AND deal_id = $2 AND is_current = true
     ORDER BY insight_type`,
    [workspaceId, dealId]
  );

  return result.rows;
}

/**
 * Calculate qualification completeness for a deal
 */
export async function calculateQualificationCompleteness(
  workspaceId: string,
  dealId: string
): Promise<{
  totalTypes: number;
  filledTypes: number;
  completionPct: number;
}> {
  const config = await getInsightConfig(workspaceId);

  if (!config) {
    return { totalTypes: 0, filledTypes: 0, completionPct: 0 };
  }

  const activeTypes = config.active_insights.filter(i => i.enabled).length;

  if (activeTypes === 0) {
    return { totalTypes: 0, filledTypes: 0, completionPct: 0 };
  }

  const insights = await getCurrentInsights(workspaceId, dealId);
  const filledTypes = insights.length;
  const completionPct = Math.round((filledTypes / activeTypes) * 100);

  return {
    totalTypes: activeTypes,
    filledTypes,
    completionPct,
  };
}
