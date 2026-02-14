import { query } from '../db.js';

export interface TrackingContext {
  workspaceId: string;
  skillId?: string;
  skillRunId?: string;
  phase?: string;
  stepName?: string;
}

export interface PayloadSummary {
  totalChars: number;
  largestField: string;
  largestFieldChars: number;
  estimatedTokens: number;
  sections: Array<{
    role: string;
    chars: number;
    hasSourceData: boolean;
    hasTranscript: boolean;
    hasRawJson: boolean;
  }>;
}

export interface TokenRecord {
  workspaceId: string;
  skillId?: string;
  skillRunId?: string;
  phase?: string;
  stepName?: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  promptChars: number;
  responseChars: number;
  truncated: boolean;
  payloadSummary: PayloadSummary;
  latencyMs: number;
  recommendations?: string[];
}

const RATES: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.0 },
  'deepseek-v3p1': { input: 0.14, output: 0.28 },
  'deepseek-chat': { input: 0.14, output: 0.28 },
};

const THRESHOLDS = {
  singleCallWarning: 50000,
  singleCallCritical: 100000,
  skillRunWarning: 80000,
  skillRunCritical: 150000,
  costPerRunWarning: 0.50,
};

export function analyzePayload(messages: Array<{ role: string; content: any }>): PayloadSummary {
  const sections: PayloadSummary['sections'] = [];
  let totalChars = 0;
  let largestField = '';
  let largestFieldChars = 0;

  for (const msg of messages) {
    const content = typeof msg.content === 'string'
      ? msg.content : JSON.stringify(msg.content);
    const chars = content.length;
    totalChars += chars;

    sections.push({
      role: msg.role,
      chars,
      hasSourceData: content.includes('source_data'),
      hasTranscript: content.includes('transcript'),
      hasRawJson: (content.match(/\{/g) || []).length > 50,
    });

    if (chars > largestFieldChars) {
      largestFieldChars = chars;
      largestField = msg.role;
    }
  }

  return {
    totalChars,
    largestField,
    largestFieldChars,
    estimatedTokens: Math.ceil(totalChars / 4),
    sections,
  };
}

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rate = RATES[model] || RATES['claude-sonnet-4-5'];
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

export function generateRecommendations(
  totalTokens: number,
  costUsd: number,
  summary: PayloadSummary
): string[] {
  const recommendations: string[] = [];

  if (totalTokens <= THRESHOLDS.singleCallWarning) return recommendations;

  const hasSourceData = summary.sections.some(s => s.hasSourceData);
  const hasTranscript = summary.sections.some(s => s.hasTranscript);
  const hasRawJson = summary.sections.some(s => s.hasRawJson);

  if (hasSourceData) {
    recommendations.push(
      'source_data detected in prompt. Strip raw CRM JSON and send only computed summaries.'
    );
  }

  if (hasTranscript) {
    recommendations.push(
      'Full transcript detected in prompt. Pre-summarize in compute phase before sending to LLM.'
    );
  }

  if (hasRawJson) {
    recommendations.push(
      'Heavy JSON structure in prompt. Convert to markdown tables or flat summaries before LLM call.'
    );
  }

  if (summary.largestFieldChars > 50000) {
    recommendations.push(
      `Largest payload section is ${summary.largestFieldChars} chars. Truncate or summarize to < 10K chars.`
    );
  }

  return recommendations;
}

export async function trackTokenUsage(record: TokenRecord): Promise<void> {
  try {
    const totalTokens = record.inputTokens + record.outputTokens;

    if (totalTokens > THRESHOLDS.singleCallCritical) {
      console.error(
        `[TOKEN CRITICAL] ${record.skillId || 'unknown'}/${record.stepName || 'unknown'}: ` +
        `${totalTokens} tokens ($${record.estimatedCostUsd.toFixed(4)}). ` +
        `Payload: ${JSON.stringify({
          totalChars: record.payloadSummary.totalChars,
          largestField: record.payloadSummary.largestField,
          largestFieldChars: record.payloadSummary.largestFieldChars,
          hasSourceData: record.payloadSummary.sections.some(s => s.hasSourceData),
        })}`
      );
    } else if (totalTokens > THRESHOLDS.singleCallWarning) {
      console.warn(
        `[TOKEN ALERT] ${record.skillId || 'unknown'}/${record.stepName || 'unknown'}: ` +
        `${totalTokens} tokens ($${record.estimatedCostUsd.toFixed(4)})`
      );
    }

    await query(
      `INSERT INTO token_usage (
        workspace_id, skill_id, skill_run_id, phase, step_name,
        provider, model, input_tokens, output_tokens,
        estimated_cost_usd, prompt_chars, response_chars,
        truncated, payload_summary, latency_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        record.workspaceId,
        record.skillId || null,
        record.skillRunId || null,
        record.phase || null,
        record.stepName || null,
        record.provider,
        record.model,
        record.inputTokens,
        record.outputTokens,
        record.estimatedCostUsd,
        record.promptChars,
        record.responseChars,
        record.truncated,
        JSON.stringify({
          ...record.payloadSummary,
          recommendations: record.recommendations || [],
        }),
        record.latencyMs,
      ]
    );
  } catch (err) {
    console.warn('[Token Tracker] Failed to track:', err instanceof Error ? err.message : err);
  }
}

export { THRESHOLDS };
