/**
 * MEDDIC Coverage — Classify Phase
 *
 * Uses DeepSeek to extract evidence for each methodology field from the activity corpus.
 * Runs field-by-field extraction with structured JSON output.
 */

import { createLogger } from '../../../utils/logger.js';
import type { ActivitySource, CorpusData } from './compute.js';

const logger = createLogger('meddic-coverage-classify');

export interface FieldExtraction {
  field: string;
  status: 'confirmed' | 'partial' | 'missing';
  confidence: 'high' | 'medium' | 'low' | null;
  evidence_source: {
    type: string;
    id: string;
    date: string;
  } | null;
  evidence_text: string | null;
  contradictions: boolean;
  contradiction_note: string | null;
  trend: 'strengthening' | 'weakening' | 'stable' | null;
}

export interface ClassifyResult {
  extractions: FieldExtraction[];
  field_count: number;
  confirmed_count: number;
  partial_count: number;
  missing_count: number;
}

/**
 * Extract evidence for all methodology fields using DeepSeek
 */
export async function classifyFields(corpus: CorpusData): Promise<ClassifyResult> {
  logger.info('Starting field classification', {
    dealId: corpus.deal.id,
    methodology: corpus.methodology.base_methodology,
    activityCount: corpus.activities.length,
  });

  // Get field list from methodology config
  const fields = Object.entries(corpus.methodology.merged_fields);

  logger.info('Extracting fields', {
    fieldCount: fields.length,
    fields: fields.map(([key]) => key),
  });

  const extractions: FieldExtraction[] = [];

  // Extract each field sequentially
  for (const [fieldKey, fieldConfig] of fields) {
    try {
      const extraction = await extractField(
        fieldKey,
        fieldConfig,
        corpus.activities,
        corpus.methodology.base_methodology
      );
      extractions.push(extraction);

      logger.info('Field extracted', {
        field: fieldKey,
        status: extraction.status,
        confidence: extraction.confidence,
      });
    } catch (error: any) {
      logger.error('Field extraction failed', {
        field: fieldKey,
        error: error.message,
      });

      // Add failed extraction as missing
      extractions.push({
        field: fieldKey,
        status: 'missing',
        confidence: null,
        evidence_source: null,
        evidence_text: null,
        contradictions: false,
        contradiction_note: null,
        trend: null,
      });
    }
  }

  // Compute stats
  const confirmedCount = extractions.filter(e => e.status === 'confirmed').length;
  const partialCount = extractions.filter(e => e.status === 'partial').length;
  const missingCount = extractions.filter(e => e.status === 'missing').length;

  return {
    extractions,
    field_count: extractions.length,
    confirmed_count: confirmedCount,
    partial_count: partialCount,
    missing_count: missingCount,
  };
}

/**
 * Extract a single field using DeepSeek
 */
async function extractField(
  fieldKey: string,
  fieldConfig: any,
  activities: ActivitySource[],
  methodology: string
): Promise<FieldExtraction> {
  // Format corpus for DeepSeek
  const formattedCorpus = formatCorpusForField(activities);

  // Build prompt
  const prompt = buildFieldExtractionPrompt(
    fieldKey,
    fieldConfig,
    formattedCorpus,
    methodology
  );

  // Call DeepSeek
  const response = await callDeepSeek(prompt);

  // Parse response
  const extraction = parseFieldExtraction(response, fieldKey, activities);

  return extraction;
}

/**
 * Format activity corpus for DeepSeek prompt
 */
function formatCorpusForField(activities: ActivitySource[]): string {
  const formatted = activities.map(activity => {
    if (activity.source_type === 'call') {
      const duration = Math.round(activity.metadata.duration_seconds / 60);
      const topics = activity.metadata.topics
        ? Array.isArray(activity.metadata.topics)
          ? activity.metadata.topics.join(', ')
          : activity.metadata.topics
        : 'N/A';
      const sentiment = activity.metadata.sentiment_score || 'N/A';

      return `[Call — ${activity.date} — ${duration}min]
Topics: ${topics}
Summary: ${activity.content}
Sentiment: ${sentiment}`;
    }

    if (activity.source_type === 'email') {
      const subject = activity.metadata.subject || '(no subject)';
      const direction = activity.metadata.direction || 'unknown';
      const contact = activity.metadata.contact_email || 'unknown';
      const bodyTruncated = activity.content.slice(0, 500);

      return `[Email — ${activity.date} — ${direction} from ${contact}]
Subject: ${subject}
Body (truncated 500 chars): ${bodyTruncated}`;
    }

    if (activity.source_type === 'note') {
      const bodyTruncated = activity.content.slice(0, 300);
      return `[Note — ${activity.date}]
${bodyTruncated}`;
    }

    return '';
  });

  return formatted.join('\n\n');
}

/**
 * Build DeepSeek extraction prompt for a field
 */
function buildFieldExtractionPrompt(
  fieldKey: string,
  fieldConfig: any,
  formattedCorpus: string,
  methodology: string
): string {
  const detectionHints = fieldConfig.detection_hints || 'None';
  const description = fieldConfig.description || 'No description';

  return `Workspace methodology: ${methodology}
Field: ${fieldKey}
Definition: ${description}
Detection hints: ${detectionHints}

Activity corpus (chronological):
${formattedCorpus}

Extract evidence for this field and respond in JSON only:
{
  "field": "${fieldKey}",
  "status": "confirmed" | "partial" | "missing",
  "confidence": "high" | "medium" | "low" | null,
  "evidence_source": { "type": string, "id": string, "date": string } | null,
  "evidence_text": string | null,
  "contradictions": boolean,
  "contradiction_note": string | null,
  "trend": "strengthening" | "weakening" | "stable" | null
}

Status rules:
- confirmed: Clear evidence found, field is well-covered
- partial: Some evidence found, but incomplete or vague
- missing: No evidence found

Confidence rules:
- high: Buyer explicitly stated in their own words, matches detection hints
- medium: Implied or paraphrased, requires light inference
- low: Directional signal only, single mention, no supporting context
- null: Missing status

Evidence text: Max 100 words, direct quote or paraphrase from corpus
Contradictions: true if different activities show conflicting information
Trend: strengthening/weakening if multiple activities show progression, stable if consistent, null if single mention or missing

Return ONLY valid JSON. No preamble.`;
}

/**
 * Call DeepSeek API
 */
async function callDeepSeek(prompt: string): Promise<string> {
  const FIREWORKS_API_KEY = process.env.FIREWORKS_API_KEY;
  if (!FIREWORKS_API_KEY) {
    throw new Error('FIREWORKS_API_KEY not configured');
  }

  const response = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIREWORKS_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'accounts/fireworks/models/deepseek-v3',
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API error: ${response.status} ${errorText}`);
  }

  const data = await response.json() as any;
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Parse field extraction from DeepSeek response
 */
function parseFieldExtraction(
  llmOutput: string,
  fieldKey: string,
  activities: ActivitySource[]
): FieldExtraction {
  try {
    // Extract JSON from response
    const jsonMatch = llmOutput.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('No JSON found in LLM output', {
        field: fieldKey,
        output: llmOutput.slice(0, 200),
      });

      return {
        field: fieldKey,
        status: 'missing',
        confidence: null,
        evidence_source: null,
        evidence_text: null,
        contradictions: false,
        contradiction_note: null,
        trend: null,
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and normalize
    const extraction: FieldExtraction = {
      field: parsed.field || fieldKey,
      status: validateStatus(parsed.status),
      confidence: validateConfidence(parsed.confidence),
      evidence_source: parsed.evidence_source || null,
      evidence_text: parsed.evidence_text || null,
      contradictions: parsed.contradictions === true,
      contradiction_note: parsed.contradiction_note || null,
      trend: validateTrend(parsed.trend),
    };

    // If status is missing, set confidence to null
    if (extraction.status === 'missing') {
      extraction.confidence = null;
    }

    return extraction;
  } catch (error: any) {
    logger.error('Failed to parse field extraction', {
      field: fieldKey,
      error: error.message,
      output: llmOutput.slice(0, 500),
    });

    return {
      field: fieldKey,
      status: 'missing',
      confidence: null,
      evidence_source: null,
      evidence_text: null,
      contradictions: false,
      contradiction_note: null,
      trend: null,
    };
  }
}

/**
 * Validate status value
 */
function validateStatus(status: any): 'confirmed' | 'partial' | 'missing' {
  if (['confirmed', 'partial', 'missing'].includes(status)) {
    return status;
  }
  return 'missing';
}

/**
 * Validate confidence value
 */
function validateConfidence(confidence: any): 'high' | 'medium' | 'low' | null {
  if (['high', 'medium', 'low'].includes(confidence)) {
    return confidence;
  }
  return null;
}

/**
 * Validate trend value
 */
function validateTrend(trend: any): 'strengthening' | 'weakening' | 'stable' | null {
  if (['strengthening', 'weakening', 'stable'].includes(trend)) {
    return trend;
  }
  return null;
}
