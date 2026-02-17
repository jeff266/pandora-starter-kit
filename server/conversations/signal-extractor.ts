/**
 * Conversation Signal Extractor
 *
 * Runs a DeepSeek extraction pass over conversations that have a summary or
 * transcript but no structured signals yet. Populates call_disposition,
 * engagement_quality, pricing_signals, budget_signals, competitive_context,
 * risk_signals, next_steps, decision_makers_mentioned, timeline_signals,
 * products_mentioned, and topics columns.
 *
 * Pattern mirrors the cross-entity linker: fire-and-forget after Gong/Fireflies sync.
 * ~500 tokens per call through DeepSeek — negligible cost.
 */

import { query } from '../db.js';
import { callLLM } from '../utils/llm-router.js';

const EXTRACTION_VERSION = 'v1.0';
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 1000;

// ============================================================================
// Types
// ============================================================================

export interface ExtractionResult {
  processed: number;
  extracted: number;
  skipped: number;
  errors: string[];
  duration_ms: number;
}

interface ExtractedSignals {
  call_disposition?: string;
  engagement_quality?: string;
  pricing_discussed?: boolean;
  pricing_signals?: any[];
  products_mentioned?: any[];
  next_steps?: any[];
  budget_signals?: Record<string, any>;
  decision_makers_mentioned?: any[];
  timeline_signals?: Record<string, any>;
  competitive_context?: Record<string, any>;
  risk_signals?: any[];
  key_topics?: string[];
}

// ============================================================================
// Main Function
// ============================================================================

export async function extractConversationSignals(
  workspaceId: string,
  options?: {
    force?: boolean;   // re-extract even if already extracted
    limit?: number;    // max conversations per run (default 50)
  }
): Promise<ExtractionResult> {
  const start = Date.now();
  const limit = options?.limit ?? 50;

  const whereClause = options?.force
    ? `workspace_id = $1 AND (summary IS NOT NULL OR transcript_text IS NOT NULL)`
    : `workspace_id = $1
       AND signals_extracted_at IS NULL
       AND (summary IS NOT NULL OR transcript_text IS NOT NULL)`;

  const conversations = await query<{
    id: string;
    title: string | null;
    summary: string | null;
    transcript_text: string | null;
    participants: any;
    source: string;
    action_items: any;
    duration_seconds: number | null;
    talk_listen_ratio: any;
  }>(
    `SELECT id, title, summary, transcript_text, participants,
            source, action_items, duration_seconds, talk_listen_ratio
     FROM conversations
     WHERE ${whereClause}
       AND source_type IS DISTINCT FROM 'consultant'
     ORDER BY call_date DESC NULLS LAST
     LIMIT $2`,
    [workspaceId, limit]
  );

  const result: ExtractionResult = {
    processed: conversations.rows.length,
    extracted: 0,
    skipped: 0,
    errors: [],
    duration_ms: 0,
  };

  // Process in batches to avoid hammering DeepSeek
  for (let i = 0; i < conversations.rows.length; i += BATCH_SIZE) {
    const batch = conversations.rows.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (convo) => {
      try {
        const analysisText = buildAnalysisText(convo);
        if (!analysisText || analysisText.length < 30) {
          result.skipped++;
          return;
        }

        const signals = await callDeepSeekExtraction(workspaceId, analysisText, convo.id);
        await updateConversationSignals(convo.id, signals);
        result.extracted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`${convo.id}: ${msg}`);
      }
    }));

    if (i + BATCH_SIZE < conversations.rows.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  result.duration_ms = Date.now() - start;

  console.log(
    `[SignalExtractor] ${workspaceId}: ${result.extracted} extracted, ` +
    `${result.skipped} skipped, ${result.errors.length} errors ` +
    `(${result.duration_ms}ms)`
  );

  return result;
}

// ============================================================================
// Helpers
// ============================================================================

function buildAnalysisText(convo: {
  id: string;
  title: string | null;
  summary: string | null;
  transcript_text: string | null;
  participants: any;
  action_items: any;
  duration_seconds: number | null;
}): string {
  const parts: string[] = [];

  if (convo.title) {
    parts.push(`Call title: ${convo.title}`);
  }

  if (convo.duration_seconds) {
    parts.push(`Duration: ${Math.round(convo.duration_seconds / 60)} minutes`);
  }

  // Summary is preferred: already compressed by Gong/Fireflies AI
  if (convo.summary) {
    parts.push(`Summary: ${convo.summary}`);
  }

  // Fall back to transcript excerpt if no summary
  if (!convo.summary && convo.transcript_text) {
    const excerpt = convo.transcript_text.substring(0, 2000);
    parts.push(`Transcript excerpt: ${excerpt}`);
  }

  if (convo.participants && Array.isArray(convo.participants) && convo.participants.length > 0) {
    const names = convo.participants
      .map((p: any) => [p.name, p.title].filter(Boolean).join(' / '))
      .filter(Boolean)
      .join(', ');
    if (names) parts.push(`Participants: ${names}`);
  }

  if (Array.isArray(convo.action_items) && convo.action_items.length > 0) {
    parts.push(`Action items from recording: ${JSON.stringify(convo.action_items)}`);
  }

  return parts.join('\n');
}

async function callDeepSeekExtraction(
  workspaceId: string,
  analysisText: string,
  conversationId: string
): Promise<ExtractedSignals> {
  const prompt = `Analyze this sales call and extract structured signals. Return ONLY valid JSON, no other text.

${analysisText}

Extract the following. If a signal is not present, use the default value shown. Do not invent signals that are not clearly supported by the text.

{
  "call_disposition": "discovery|demo|proposal_review|negotiation|technical_deep_dive|check_in|onboarding|escalation|closing|other",
  "engagement_quality": "strong|neutral|disengaged",
  "pricing_discussed": false,
  "pricing_signals": [],
  "products_mentioned": [],
  "next_steps": [],
  "budget_signals": {"mentioned": false},
  "decision_makers_mentioned": [],
  "timeline_signals": {"urgency": "none"},
  "competitive_context": {"evaluating_others": false, "competitors_named": []},
  "risk_signals": [],
  "key_topics": []
}

Rules:
- pricing_signals: only if pricing, cost, budget, discount, or ROI was specifically discussed. Each entry: {"type": "objection|question|comparison|approval", "summary": "brief description", "speaker_role": "prospect|rep"}
- products_mentioned: specific products, features, or capabilities discussed. Each entry: {"product": "name", "feature": "name or null", "context": "brief"}
- next_steps: concrete actions agreed to. Each entry: {"action": "what", "owner": "rep|prospect|unknown", "deadline": "YYYY-MM-DD or null", "status": "committed|tentative"}
- budget_signals: {"mentioned": true/false, "range_low": number|null, "range_high": number|null, "confidence": "stated|inferred|none", "context": "brief"}
- decision_makers_mentioned: people referenced who influence the deal. Each entry: {"title": "role", "name": "name or null", "context": "brief", "involvement": "blocker|champion|influencer|evaluator"}
- timeline_signals: {"urgency": "high|medium|low|none", "target_date": "YYYY-MM-DD or null", "driver": "contract_expiry|budget_cycle|internal_deadline|competitive_pressure|null", "context": "brief or null"}
- competitive_context: {"evaluating_others": true/false, "competitors_named": ["name"], "our_position": "preferred|shortlisted|behind|unknown", "context": "brief or null"}
- risk_signals: deal risks surfaced in the call. Each entry: {"type": "champion_leaving|budget_cut|priority_shift|competitor_preferred|stalling|org_change|technical_blocker", "summary": "brief", "severity": "high|medium|low"}
- key_topics: top 3-5 topics discussed, as short strings
- engagement_quality: "strong" if prospect asked questions, showed enthusiasm, committed to next steps. "disengaged" if short answers, non-committal. "neutral" otherwise.

Return ONLY the JSON object.`;

  const response = await callLLM(workspaceId, 'extract', {
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 1000,
    temperature: 0.1,
  });

  // Parse — handle potential markdown wrapping
  const cleaned = response.content
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  try {
    return JSON.parse(cleaned) as ExtractedSignals;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[SignalExtractor] JSON parse failed for conversation ${conversationId}:`,
      cleaned.substring(0, 200)
    );
    throw new Error(`DeepSeek returned invalid JSON: ${msg}`);
  }
}

async function updateConversationSignals(
  conversationId: string,
  signals: ExtractedSignals
): Promise<void> {
  await query(
    `UPDATE conversations SET
      call_disposition = $2,
      engagement_quality = $3,
      pricing_discussed = $4,
      pricing_signals = $5,
      products_mentioned = $6,
      next_steps = $7,
      budget_signals = $8,
      decision_makers_mentioned = $9,
      timeline_signals = $10,
      competitive_context = $11,
      risk_signals = $12,
      topics = $13,
      signals_extracted_at = NOW(),
      signals_extraction_version = $14
     WHERE id = $1`,
    [
      conversationId,
      signals.call_disposition || null,
      signals.engagement_quality || null,
      signals.pricing_discussed ?? false,
      JSON.stringify(signals.pricing_signals || []),
      JSON.stringify(signals.products_mentioned || []),
      JSON.stringify(signals.next_steps || []),
      JSON.stringify(signals.budget_signals || {}),
      JSON.stringify(signals.decision_makers_mentioned || []),
      JSON.stringify(signals.timeline_signals || {}),
      JSON.stringify(signals.competitive_context || {}),
      JSON.stringify(signals.risk_signals || []),
      JSON.stringify(signals.key_topics || []),
      EXTRACTION_VERSION,
    ]
  );

  // Also update the existing objections column with pricing objections
  const objections = (signals.pricing_signals || [])
    .filter((s: any) => s.type === 'objection')
    .map((s: any) => s.summary);

  if (objections.length > 0) {
    await query(
      `UPDATE conversations SET objections = $2
       WHERE id = $1 AND (objections IS NULL OR objections = '[]'::jsonb)`,
      [conversationId, JSON.stringify(objections)]
    );
  }
}
