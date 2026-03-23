/**
 * Methodology Field Extractor
 *
 * Extracts methodology field values (MEDDIC, SPICED, BANT, etc.) from call transcripts
 * and email content using workspace-specific detection hints with confidence tiers.
 */

import { createLogger } from '../utils/logger.js';
import { ALL_FRAMEWORKS } from '../config/methodology-frameworks.js';

const logger = createLogger('MethodologyFieldExtractor');

export interface ContentSource {
  text: string;
  source_type: 'call' | 'email';
  source_id: string;
}

export interface ExtractedField {
  value: string;
  confidence: 'high' | 'medium' | 'low';
  source_excerpt: string;
  source_type: 'call' | 'email';
  source_id: string;
}

export interface ExtractedFieldMap {
  [field_key: string]: ExtractedField;
}

export class MethodologyFieldExtractor {
  /**
   * Extracts methodology fields from content using LLM
   */
  async extract(
    content: ContentSource,
    frameworkKey: string,
    workspaceFieldHints: Record<string, string>
  ): Promise<ExtractedFieldMap> {
    // Get framework definition
    const framework = ALL_FRAMEWORKS.find(f => f.id === frameworkKey);
    if (!framework) {
      throw new Error(`Framework not found: ${frameworkKey}`);
    }

    // Build field list with hints
    const fieldList = framework.dimensions.map(dim => {
      const hint = workspaceFieldHints[dim.id] || '';
      return `${dim.id}: ${dim.label} - ${dim.description}${hint ? `\n  Workspace hints: ${hint}` : ''}`;
    }).join('\n');

    // Build prompt for DeepSeek
    const prompt = this.buildExtractionPrompt(
      content,
      frameworkKey,
      fieldList,
      workspaceFieldHints
    );

    // Call DeepSeek (use existing fireworks pattern from skills runtime)
    try {
      const result = await this.callDeepSeek(prompt);

      // Parse and validate result
      const extractedFields = this.parseExtractionResult(result, content);

      logger.info('Field extraction completed', {
        frameworkKey,
        contentLength: content.text.length,
        fieldsExtracted: Object.keys(extractedFields).length,
      });

      return extractedFields;
    } catch (error: any) {
      logger.error('Field extraction failed', {
        error: error.message,
        frameworkKey,
      });
      return {}; // Return empty map on failure
    }
  }

  /**
   * Build extraction prompt for DeepSeek
   */
  private buildExtractionPrompt(
    content: ContentSource,
    frameworkKey: string,
    fieldList: string,
    workspaceFieldHints: Record<string, string>
  ): string {
    const hintsList = Object.entries(workspaceFieldHints)
      .filter(([_, hint]) => hint && hint.trim())
      .map(([field, hint]) => `${field}: ${hint}`)
      .join('\n');

    return `You are extracting sales qualification data from a ${content.source_type} transcript.

Framework: ${frameworkKey}
Fields to extract:
${fieldList}

${hintsList ? `Workspace-specific detection hints:\n${hintsList}\n` : ''}
Content:
${content.text.slice(0, 8000)}

Return ONLY valid JSON. No preamble. Schema:
{
  "field_key": {
    "value": "extracted text or null",
    "confidence": "high|medium|low",
    "source_excerpt": "exact phrase from content"
  }
}

Confidence rules:
- high: Buyer explicitly stated in their own words AND matches workspace detection hints (if provided)
- medium: Implied or paraphraseable, requires light inference
- low: Directional signal only, single mention, no supporting context

Only include fields where evidence exists. Omit fields with no evidence.`;
  }

  /**
   * Call DeepSeek API
   */
  private async callDeepSeek(prompt: string): Promise<string> {
    // Use Fireworks API (same as skills runtime)
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
        max_tokens: 2000,
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
   * Parse extraction result from LLM
   */
  private parseExtractionResult(
    llmOutput: string,
    content: ContentSource
  ): ExtractedFieldMap {
    try {
      // Try to extract JSON from the response
      const jsonMatch = llmOutput.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('No JSON found in LLM output', { output: llmOutput.slice(0, 200) });
        return {};
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const result: ExtractedFieldMap = {};

      // Validate and transform each field
      for (const [fieldKey, fieldData] of Object.entries(parsed)) {
        if (typeof fieldData === 'object' && fieldData !== null) {
          const data = fieldData as any;

          // Skip if no value
          if (!data.value || data.value === 'null' || data.value.trim() === '') {
            continue;
          }

          // Validate confidence
          const confidence = ['high', 'medium', 'low'].includes(data.confidence)
            ? data.confidence
            : 'low';

          result[fieldKey] = {
            value: data.value,
            confidence,
            source_excerpt: data.source_excerpt || data.value.slice(0, 150),
            source_type: content.source_type,
            source_id: content.source_id,
          };
        }
      }

      return result;
    } catch (error: any) {
      logger.error('Failed to parse extraction result', {
        error: error.message,
        output: llmOutput.slice(0, 500),
      });
      return {};
    }
  }

  /**
   * Determine execution mode based on confidence
   */
  static getExecutionMode(confidence: 'high' | 'medium' | 'low'): 'auto' | 'queue' {
    return confidence === 'high' ? 'auto' : 'queue';
  }

  /**
   * Check if field needs rep confirmation
   */
  static needsRepConfirmation(confidence: 'high' | 'medium' | 'low'): boolean {
    return confidence === 'low';
  }
}

// Singleton instance
let extractorInstance: MethodologyFieldExtractor | null = null;

export function getMethodologyFieldExtractor(): MethodologyFieldExtractor {
  if (!extractorInstance) {
    extractorInstance = new MethodologyFieldExtractor();
  }
  return extractorInstance;
}
