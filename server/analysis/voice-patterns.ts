/**
 * Workspace Voice Pattern Extraction
 *
 * Mines internal sales calls (Gong / Fireflies, is_internal = true) for
 * stable language patterns and persists them into workspace_voice_patterns.
 * Used by the voice-pattern-extraction skill (monthly cron, 1st of each month).
 *
 * Three exported functions:
 *   extractInternalCallLanguage  — SQL query, returns transcripts or insufficient flag
 *   classifyVoicePatterns        — DeepSeek classification call
 *   updateWorkspaceVoicePatterns — upsert result into workspace_voice_patterns
 */

import { query } from '../db.js';
import { callLLM } from '../utils/llm-router.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface TranscriptSample {
  id: string;
  title: string;
  text: string;
  date: Date;
}

export type InternalCallLanguage =
  | { insufficient: true; callsFound: number }
  | { insufficient: false; callsFound: number; transcripts: TranscriptSample[] };

export interface VoicePatternClassification {
  risk_phrases: string[];
  urgency_phrases: string[];
  win_phrases: string[];
  pipeline_vocabulary: string[];
  common_shorthand: Record<string, string>;
  confidence: number;
  low_confidence?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 1 — extractInternalCallLanguage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Queries internal calls (is_internal = true) within the analysis window.
 * Returns insufficient flag if fewer than 5 transcripts found.
 */
export async function extractInternalCallLanguage(
  workspaceId: string,
  windowDays: number = 90
): Promise<InternalCallLanguage> {
  const result = await query<{
    id: string;
    title: string | null;
    transcript_text: string;
    call_date: Date;
  }>(
    `SELECT id, title, transcript_text, call_date
     FROM conversations
     WHERE workspace_id = $1
       AND is_internal = true
       AND call_date >= NOW() - ($2 || ' days')::INTERVAL
       AND transcript_text IS NOT NULL
       AND LENGTH(transcript_text) > 200
     ORDER BY call_date DESC
     LIMIT 50`,
    [workspaceId, String(windowDays)]
  );

  const callsFound = result.rows.length;

  if (callsFound < 5) {
    return { insufficient: true, callsFound };
  }

  const transcripts: TranscriptSample[] = result.rows.map(row => ({
    id: row.id,
    title: row.title ?? 'Untitled Call',
    text: row.transcript_text,
    date: row.call_date,
  }));

  return { insufficient: false, callsFound, transcripts };
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 2 — classifyVoicePatterns (DeepSeek)
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_CLASSIFICATION: VoicePatternClassification = {
  risk_phrases: [],
  urgency_phrases: [],
  win_phrases: [],
  pipeline_vocabulary: [],
  common_shorthand: {},
  confidence: 0,
};

/**
 * Classifies language patterns from transcript samples via DeepSeek.
 * Never throws — returns empty classification on any failure.
 */
export async function classifyVoicePatterns(
  transcripts: TranscriptSample[],
  workspaceId: string
): Promise<VoicePatternClassification> {
  // Use most recent 20 if over limit (token budget)
  const samples = transcripts.slice(0, 20);

  // Concatenate first 500 chars of each transcript, separated by "---"
  const excerpts = samples
    .map(t => `[${t.title}]\n${t.text.slice(0, 500)}`)
    .join('\n---\n');

  // Rough token estimate: ~4 chars per token; cap at ~8,000 tokens input
  const maxChars = 32_000;
  const truncated = excerpts.length > maxChars ? excerpts.slice(0, maxChars) : excerpts;

  const prompt = `Analyze these internal sales team call excerpts.
Extract the specific language patterns this team uses. Focus on:

1. How they describe deals that are at risk or going cold (risk_phrases)
2. How they express urgency or time pressure (urgency_phrases)
3. How they describe wins or positive momentum (win_phrases)
4. Domain-specific vocabulary they use for their product or process (pipeline_vocabulary)
5. Shorthand or nicknames they use for specific deals, accounts, or concepts (common_shorthand)

Return ONLY valid JSON in this exact shape:
{
  "risk_phrases": ["phrase1", "phrase2"],
  "urgency_phrases": ["phrase1", "phrase2"],
  "win_phrases": ["phrase1", "phrase2"],
  "pipeline_vocabulary": ["term1", "term2"],
  "common_shorthand": { "shorthand": "what it means" },
  "confidence": 0.0
}

Rules:
- Only include phrases that appear multiple times across different calls (not one-off language)
- Maximum 10 items per array
- Maximum 10 entries in common_shorthand
- Do not include generic business language ("pipeline", "close", "deal") — only distinctive vocabulary specific to this team
- If insufficient distinctive patterns found, return empty arrays rather than generic phrases

CALL EXCERPTS:
${truncated}`;

  try {
    const response = await callLLM(workspaceId, 'classify', {
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1024,
      temperature: 0.2,
    });

    const raw = response.content.trim();

    // Strip markdown fences if present
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.warn(`[voice-patterns] classifyVoicePatterns: JSON parse failed for workspace ${workspaceId}`, parseErr);
      return { ...EMPTY_CLASSIFICATION };
    }

    const classification: VoicePatternClassification = {
      risk_phrases: Array.isArray(parsed.risk_phrases) ? parsed.risk_phrases.slice(0, 10) : [],
      urgency_phrases: Array.isArray(parsed.urgency_phrases) ? parsed.urgency_phrases.slice(0, 10) : [],
      win_phrases: Array.isArray(parsed.win_phrases) ? parsed.win_phrases.slice(0, 10) : [],
      pipeline_vocabulary: Array.isArray(parsed.pipeline_vocabulary) ? parsed.pipeline_vocabulary.slice(0, 10) : [],
      common_shorthand: (parsed.common_shorthand && typeof parsed.common_shorthand === 'object' && !Array.isArray(parsed.common_shorthand))
        ? Object.fromEntries(Object.entries(parsed.common_shorthand).slice(0, 10))
        : {},
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    };

    if (classification.confidence < 0.5) {
      classification.low_confidence = true;
      console.warn(`[voice-patterns] classifyVoicePatterns: low confidence (${classification.confidence}) for workspace ${workspaceId}`);
    }

    return classification;
  } catch (err) {
    console.error(`[voice-patterns] classifyVoicePatterns: LLM call failed for workspace ${workspaceId}:`, err);
    return { ...EMPTY_CLASSIFICATION };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 3 — updateWorkspaceVoicePatterns
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upserts extracted voice patterns into workspace_voice_patterns.
 * Sets next_extraction_at to 30 days from now.
 */
export async function updateWorkspaceVoicePatterns(
  workspaceId: string,
  patterns: VoicePatternClassification,
  callsAnalyzed: number
): Promise<void> {
  await query(
    `INSERT INTO workspace_voice_patterns (
       workspace_id,
       risk_phrases,
       urgency_phrases,
       win_phrases,
       pipeline_vocabulary,
       common_shorthand,
       calls_analyzed,
       extraction_status,
       last_extracted_at,
       next_extraction_at,
       updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'complete', NOW(), NOW() + INTERVAL '30 days', NOW())
     ON CONFLICT (workspace_id) DO UPDATE SET
       risk_phrases = EXCLUDED.risk_phrases,
       urgency_phrases = EXCLUDED.urgency_phrases,
       win_phrases = EXCLUDED.win_phrases,
       pipeline_vocabulary = EXCLUDED.pipeline_vocabulary,
       common_shorthand = EXCLUDED.common_shorthand,
       calls_analyzed = EXCLUDED.calls_analyzed,
       extraction_status = EXCLUDED.extraction_status,
       last_extracted_at = EXCLUDED.last_extracted_at,
       next_extraction_at = EXCLUDED.next_extraction_at,
       updated_at = NOW()`,
    [
      workspaceId,
      patterns.risk_phrases,
      patterns.urgency_phrases,
      patterns.win_phrases,
      patterns.pipeline_vocabulary,
      JSON.stringify(patterns.common_shorthand),
      callsAnalyzed,
    ]
  );
}
