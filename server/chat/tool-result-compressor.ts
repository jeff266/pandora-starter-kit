/**
 * Tool Result Compressor
 *
 * Uses DeepSeek to compress large tool results before feeding back to Claude.
 * Reduces token costs on multi-step queries where tools return 50+ deals, 100+ signals, etc.
 *
 * Strategy:
 * - Per-tool size thresholds determine when compression kicks in
 * - DeepSeek extracts just the data needed to answer the question
 * - 5-second timeout with fallback to raw result
 * - Hard cap: Never send >40K chars to DeepSeek
 */

import { callLLM } from '../utils/llm-router.js';

// ─── Compression thresholds ───────────────────────────────────────────────────

const COMPRESSION_THRESHOLDS: Record<string, number> = {
  query_deals: 3000,
  query_accounts: 3000,
  query_conversations: 3000,
  query_contacts: 3000,
  query_activity_timeline: 4000,
  query_stage_history: 4000,
  query_field_history: 2500,
  search_transcripts: 5000,
  get_skill_evidence: 6000,
  query_conversation_signals: 3000,
  query_activity_signals: 3000,
  compute_stage_benchmarks: 4000,
  compute_metric_segmented: 3000,
  compute_close_probability: 5000,
  compute_pipeline_creation: 3000,
};

const HARD_CAP_CHARS = 40_000;
const COMPRESSION_TIMEOUT_MS = 5000;

// ─── Main API ─────────────────────────────────────────────────────────────────

export function shouldCompress(toolName: string, result: any): boolean {
  // Never compress error results
  if (!result || result.error) return false;

  // Never compress small metric results
  if (toolName === 'compute_metric' && typeof result === 'object') {
    const serialized = JSON.stringify(result);
    if (serialized.length < 1000) return false;
  }

  const threshold = COMPRESSION_THRESHOLDS[toolName];
  if (!threshold) return false;

  const serialized = JSON.stringify(result);
  return serialized.length > threshold;
}

export async function compressToolResult(
  workspaceId: string,
  toolName: string,
  result: any
): Promise<any> {
  if (!shouldCompress(toolName, result)) {
    return result;
  }

  const serialized = JSON.stringify(result);
  const originalSize = serialized.length;

  // Hard cap — if result is over 40K chars, truncate before sending to DeepSeek
  const inputForCompression = originalSize > HARD_CAP_CHARS
    ? serialized.substring(0, HARD_CAP_CHARS) + '\n... [truncated]'
    : serialized;

  try {
    const prompt = buildCompressionPrompt(toolName, inputForCompression);

    const compressionStart = Date.now();
    const response = await Promise.race([
      callLLM(workspaceId, 'compress', {
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 2000,
        temperature: 0,
        _tracking: {
          workspaceId,
          phase: 'compression',
          stepName: `compress-${toolName}`,
        },
      }),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('Compression timeout')), COMPRESSION_TIMEOUT_MS)
      ),
    ]);

    if (!response || !response.content) {
      console.warn(`[Compressor] ${toolName}: DeepSeek returned empty response, using raw result`);
      return result;
    }

    // Parse compressed result from DeepSeek
    const compressed = parseCompressedResult(response.content);
    const compressedSize = JSON.stringify(compressed).length;
    const ratio = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);
    const duration = Date.now() - compressionStart;

    console.log(
      `[Compressor] ${toolName}: ${originalSize} → ${compressedSize} chars ` +
      `(${ratio}% reduction) in ${duration}ms`
    );

    return compressed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('timeout')) {
      console.warn(`[Compressor] ${toolName}: timeout after ${COMPRESSION_TIMEOUT_MS}ms, using raw result`);
    } else {
      console.error(`[Compressor] ${toolName}: compression failed (${msg}), using raw result`);
    }
    return result;
  }
}

// ─── Compression prompts ──────────────────────────────────────────────────────

function buildCompressionPrompt(toolName: string, data: string): string {
  const prompts: Record<string, string> = {
    query_deals: `Extract a concise summary of these deal records. Include:
- total_count and total_amount
- For each deal: id, name, amount, stage, close_date, owner_name, account_name
- Remove: days_in_stage, probability, created_date, forecast_category (unless critical)
- If >20 deals, keep top 10 by amount + any with findings/risk flags

Output valid JSON only. No markdown.

Data:
${data}`,

    query_accounts: `Extract a concise summary of these account records. Include:
- total_count
- For each account: id, name, domain, total_pipeline, open_deal_count, industry, owner_email
- Remove: employee_count, last_activity unless needed

Output valid JSON only. No markdown.

Data:
${data}`,

    query_conversations: `Extract a concise summary of these conversation records. Include:
- total_count
- For each conversation: id, title, call_date, duration_minutes, account_name, rep_email, participants
- If summary exists, keep it. If transcript_text exists, truncate to 200 chars.
- Remove: source_data, detailed transcripts unless explicitly requested

Output valid JSON only. No markdown.

Data:
${data}`,

    search_transcripts: `Extract the most relevant transcript excerpts. Include:
- total_matches
- For each excerpt: conversation_title, conversation_date, speaker, excerpt (keep full quote, max 300 chars each)
- Remove metadata like conversation IDs unless needed for lookup

Output valid JSON only. No markdown.

Data:
${data}`,

    get_skill_evidence: `Summarize this skill evidence. Include:
- skill_id, last_run, total_findings
- Top 5 critical findings with: severity, title, entity_id, entity_name
- If evaluated_records exists, keep count but truncate list to top 10
- Remove: full record lists, metadata timestamps

Output valid JSON only. No markdown.

Data:
${data}`,

    query_conversation_signals: `Extract a summary of conversation signals. Include:
- total, signal_type filter (if present)
- For each signal: signal_type, signal_value, confidence, source_quote (max 200 chars), sentiment, deal_name, account_name
- If >30 signals, keep top 20 by confidence
- Remove: extraction_method, model_version, rep_email unless needed

Output valid JSON only. No markdown.

Data:
${data}`,

    query_activity_signals: `Extract a summary of activity signals. Include:
- total, signal_type filter (if present), framework_field filter (if present)
- For each signal: signal_type, signal_value, framework_field, source_quote (max 200 chars), speaker_type, confidence, verbatim, deal_name, account_name
- If >30 signals, keep top 20 by confidence
- Remove: extraction_method, model_version, activity_id, activity_type unless needed

Output valid JSON only. No markdown.

Data:
${data}`,
  };

  const prompt = prompts[toolName];
  if (!prompt) {
    return `Compress this tool result to include only essential data. Remove verbose fields, truncate long strings, keep IDs and key metrics. Output valid JSON only.\n\nData:\n${data}`;
  }

  return prompt;
}

// ─── Result parser ────────────────────────────────────────────────────────────

function parseCompressedResult(content: string): any {
  // Remove markdown fences if present
  const cleaned = content
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[Compressor] Failed to parse DeepSeek response, returning raw content');
    return { _compression_failed: true, raw: content.substring(0, 1000) };
  }
}
