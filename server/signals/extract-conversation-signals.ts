/**
 * Conversation Signals Classification Layer
 *
 * Extracts structured signals from sales call transcripts/summaries and stores them
 * in the conversation_signals table (one row per signal per conversation).
 *
 * Complements the existing JSONB signal extraction in conversations table by providing:
 * - Queryable, indexed signal storage for Ask Pandora
 * - Per-signal confidence scores and source quotes
 * - UI-ready signal data for dossiers and Command Center
 *
 * Runs fire-and-forget after Gong/Fireflies sync, processing in batches.
 */

import { query } from '../db.js';
import { callLLM } from '../utils/llm-router.js';

async function loadWorkspaceExclusions(workspaceId: string): Promise<Set<string>> {
  const result = await query<{ value: string }>(
    `SELECT value FROM workspace_settings WHERE workspace_id = $1 AND key = 'competitor_exclusions'`,
    [workspaceId]
  ).catch(() => ({ rows: [] as { value: string }[] }));
  if (!result.rows[0]?.value) return new Set();
  try {
    const arr = JSON.parse(result.rows[0].value) as string[];
    return new Set(arr.map(s => s.toLowerCase().trim()));
  } catch { return new Set(); }
}

const BATCH_SIZE = 5;  // Smaller batches than JSONB extraction for precision
const BATCH_DELAY_MS = 1000;
const MODEL_VERSION = 'deepseek-chat-v3-2025';

// ============================================================================
// Types
// ============================================================================

export interface SignalExtractionResult {
  processed: number;
  extracted: number;
  skipped: number;
  errors: string[];
  duration_ms: number;
}

export interface ExtractedSignal {
  signal_type: SignalType;
  signal_value: string;
  confidence: number;
  source_quote?: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
}

export interface ConversationSignalBatch {
  conversation_id: string;
  signals: ExtractedSignal[];
  no_signal_types?: SignalType[];
}

export type SignalType =
  | 'competitor_mention'
  | 'pricing_discussed'
  | 'objection'
  | 'buying_signal'
  | 'next_steps'
  | 'risk_flag'
  | 'champion_signal'
  | 'decision_criteria'
  | 'timeline_mentioned'
  | 'budget_mentioned';

interface ConversationRecord {
  id: string;
  title: string | null;
  call_date: string | null;
  duration_seconds: number | null;
  transcript_text: string | null;
  summary: string | null;
  participants: any;
  source_data: any;
  deal_id: string | null;
  account_id: string | null;
  rep_email: string | null;
}

// ============================================================================
// Main Function
// ============================================================================

export async function extractConversationSignals(
  workspaceId: string,
  options?: {
    force?: boolean;  // Re-extract even if already processed
    limit?: number;   // Max conversations per run (default 50)
  }
): Promise<SignalExtractionResult> {
  const start = Date.now();
  const limit = options?.limit ?? 50;

  const result: SignalExtractionResult = {
    processed: 0,
    extracted: 0,
    skipped: 0,
    errors: [],
    duration_ms: 0,
  };

  // Step 1: Find unprocessed conversations
  const conversations = await findUnprocessedConversations(workspaceId, limit, options?.force);

  if (conversations.length === 0) {
    result.duration_ms = Date.now() - start;
    return result;
  }

  result.processed = conversations.length;

  // Load non-competition list once per run — signals matching these names are skipped at write time
  const nonCompetitionList = await loadWorkspaceExclusions(workspaceId);

  // Step 2: Process in batches
  for (let i = 0; i < conversations.length; i += BATCH_SIZE) {
    const batch = conversations.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (convo) => {
      try {
        // Determine content source priority: transcript_text > summary > source_data JSONB > skip
        const content = getConversationContent(convo);

        if (!content) {
          await recordSkippedRun(workspaceId, convo.id, 'no_transcript');
          result.skipped++;
          return;
        }

        if ((convo.duration_seconds ?? 0) <= 120) {
          await recordSkippedRun(workspaceId, convo.id, 'too_short');
          result.skipped++;
          return;
        }

        // Call DeepSeek for signal classification
        const signals = await classifySignals(workspaceId, convo, content);

        // Insert signals into conversation_signals table (non-competition list filtered at write time)
        await insertSignals(workspaceId, convo, signals, nonCompetitionList);

        // Record successful run
        await recordSuccessfulRun(workspaceId, convo.id, signals.length);

        result.extracted += signals.length;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`${convo.id}: ${msg}`);
        await recordErrorRun(workspaceId, convo.id, msg);
      }
    }));

    if (i + BATCH_SIZE < conversations.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  result.duration_ms = Date.now() - start;

  console.log(
    `[ConversationSignals] ${workspaceId}: ${result.extracted} signals extracted from ` +
    `${result.processed - result.skipped} conversations, ${result.skipped} skipped, ` +
    `${result.errors.length} errors (${result.duration_ms}ms)`
  );

  return result;
}

// ============================================================================
// Query Helpers
// ============================================================================

async function findUnprocessedConversations(
  workspaceId: string,
  limit: number,
  force?: boolean
): Promise<ConversationRecord[]> {
  const whereClause = force
    ? `c.workspace_id = $1 AND c.is_internal = FALSE AND c.duration_seconds > 120`
    : `c.workspace_id = $1
       AND c.is_internal = FALSE
       AND c.duration_seconds > 120
       AND c.id NOT IN (
         SELECT conversation_id FROM conversation_signal_runs
         WHERE workspace_id = $1
       )`;

  const result = await query<ConversationRecord>(
    `SELECT c.id, c.title, c.call_date, c.duration_seconds,
            c.transcript_text, c.summary, c.participants,
            c.source_data, c.deal_id, c.account_id,
            d.owner as rep_email
     FROM conversations c
     LEFT JOIN deals d ON d.id = c.deal_id
     WHERE ${whereClause}
     ORDER BY c.call_date DESC
     LIMIT $2`,
    [workspaceId, limit]
  );

  return result.rows;
}

function getConversationContent(convo: ConversationRecord): string | null {
  // Priority: transcript_text > summary > source_data JSONB
  if (convo.transcript_text && convo.transcript_text.length > 100) {
    // Use first 600 + last 400 tokens (approx 4000 chars + 1600 chars)
    const text = convo.transcript_text;
    if (text.length <= 5600) {
      return text;
    }
    return text.substring(0, 4000) + '\n...\n' + text.substring(text.length - 1600);
  }

  if (convo.summary && convo.summary.length > 50) {
    return convo.summary;
  }

  // Try extracting from source_data JSONB
  if (convo.source_data) {
    const sourceData = convo.source_data;
    if (sourceData.transcript) {
      return sourceData.transcript;
    }
    if (sourceData.summary) {
      return sourceData.summary;
    }
  }

  return null;
}

// ============================================================================
// DeepSeek Classification
// ============================================================================

async function classifySignals(
  workspaceId: string,
  convo: ConversationRecord,
  content: string
): Promise<ExtractedSignal[]> {
  const callInfo = buildCallInfo(convo, content);

  const prompt = `You are a B2B sales call analyst extracting structured signals from call content.
For each call, identify ONLY signals with clear evidence. Do not infer.

Call to analyze:
${callInfo}

Respond with a JSON object:
{
  "conversation_id": "${convo.id}",
  "signals": [
    {
      "signal_type": "competitor_mention",
      "signal_value": "Acme Platform",
      "confidence": 0.92,
      "source_quote": "We're also evaluating Acme Platform",
      "sentiment": "neutral"
    },
    {
      "signal_type": "objection",
      "signal_value": "implementation_timeline",
      "confidence": 0.85,
      "source_quote": "We can't go live before Q3",
      "sentiment": "negative"
    }
  ],
  "no_signal_types": ["buying_signal", "champion_signal"]
}

Signal type definitions:
- competitor_mention: A competing product or vendor was named. signal_value = competitor name.
- pricing_discussed: Pricing, cost, budget number, or ROI discussed. signal_value = brief description.
- objection: A concern, blocker, or pushback raised. signal_value = objection topic (e.g. "security", "pricing", "timeline").
- buying_signal: Positive purchase intent — asking about contracts, implementation, next steps proactively. signal_value = brief description.
- next_steps: Explicit concrete next steps agreed on. signal_value = the next step described.
- risk_flag: Disengagement, stall, concern about deal health. signal_value = brief description.
- champion_signal: Customer used internal advocacy language — mentioning briefing their boss, building business case, etc. signal_value = brief description.
- decision_criteria: Buyer articulated how they'll evaluate or decide. signal_value = the criteria stated.
- timeline_mentioned: A specific date, quarter, or deadline was stated. signal_value = the timeline.
- budget_mentioned: Budget range, approval process, or spend authority discussed. signal_value = brief description.

Only output signals where confidence >= 0.65. Skip the rest.
Keep source_quote under 300 characters.
Respond with ONLY valid JSON.`;

  const response = await callLLM(workspaceId, 'classify', {
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 1500,
    temperature: 0.1,
  });

  // Parse response
  const cleaned = response.content
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as ConversationSignalBatch;
    return parsed.signals.filter(s => s.confidence >= 0.65);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[ConversationSignals] JSON parse failed for ${convo.id}:`,
      cleaned.substring(0, 200)
    );
    throw new Error(`DeepSeek returned invalid JSON: ${msg}`);
  }
}

function buildCallInfo(convo: ConversationRecord, content: string): string {
  const parts: string[] = [];

  if (convo.title) {
    parts.push(`Title: ${convo.title}`);
  }

  if (convo.call_date) {
    const date = new Date(convo.call_date).toLocaleDateString();
    parts.push(`Date: ${date}`);
  }

  if (convo.duration_seconds) {
    const minutes = Math.round(convo.duration_seconds / 60);
    parts.push(`Duration: ${minutes} minutes`);
  }

  if (convo.participants && Array.isArray(convo.participants) && convo.participants.length > 0) {
    const participantInfo = convo.participants
      .map((p: any) => {
        const name = p.name || 'Unknown';
        const role = p.title || p.role || '';
        return role ? `${name} (${role})` : name;
      })
      .filter(Boolean)
      .join(', ');
    if (participantInfo) {
      parts.push(`Participants: ${participantInfo}`);
    }
  }

  parts.push(`\nContent:\n${content}`);

  return parts.join('\n');
}

// ============================================================================
// Database Operations
// ============================================================================

async function insertSignals(
  workspaceId: string,
  convo: ConversationRecord,
  signals: ExtractedSignal[],
  nonCompetitionList: Set<string> = new Set()
): Promise<void> {
  // Filter out competitor_mention signals for names on the workspace's non-competition list
  const filtered = signals.filter(s =>
    s.signal_type !== 'competitor_mention' ||
    !nonCompetitionList.has(s.signal_value.toLowerCase().trim())
  );
  if (filtered.length === 0) {
    return;
  }
  const signals_to_insert = filtered;

  // Build multi-row insert
  const values: any[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const signal of signals_to_insert) {
    placeholders.push(
      `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7}, $${idx + 8}, $${idx + 9}, $${idx + 10})`
    );
    values.push(
      workspaceId,
      convo.id,
      signal.signal_type,
      signal.signal_value,
      signal.confidence,
      signal.source_quote || null,
      signal.sentiment || null,
      convo.deal_id,
      convo.account_id,
      convo.rep_email,
      MODEL_VERSION
    );
    idx += 11;
  }

  await query(
    `INSERT INTO conversation_signals
      (workspace_id, conversation_id, signal_type, signal_value, confidence,
       source_quote, sentiment, deal_id, account_id, rep_email, model_version)
     VALUES ${placeholders.join(', ')}`,
    values
  );
}

async function recordSuccessfulRun(
  workspaceId: string,
  conversationId: string,
  signalsExtracted: number
): Promise<void> {
  await query(
    `INSERT INTO conversation_signal_runs
      (workspace_id, conversation_id, status, signals_extracted)
     VALUES ($1, $2, 'success', $3)
     ON CONFLICT (conversation_id) DO UPDATE SET
       status = 'success',
       signals_extracted = $3,
       processed_at = NOW()`,
    [workspaceId, conversationId, signalsExtracted]
  );
}

async function recordSkippedRun(
  workspaceId: string,
  conversationId: string,
  skipReason: string
): Promise<void> {
  await query(
    `INSERT INTO conversation_signal_runs
      (workspace_id, conversation_id, status, skip_reason)
     VALUES ($1, $2, 'skipped', $3)
     ON CONFLICT (conversation_id) DO UPDATE SET
       status = 'skipped',
       skip_reason = $3,
       processed_at = NOW()`,
    [workspaceId, conversationId, skipReason]
  );
}

async function recordErrorRun(
  workspaceId: string,
  conversationId: string,
  errorMsg: string
): Promise<void> {
  await query(
    `INSERT INTO conversation_signal_runs
      (workspace_id, conversation_id, status, skip_reason)
     VALUES ($1, $2, 'error', $3)
     ON CONFLICT (conversation_id) DO UPDATE SET
       status = 'error',
       skip_reason = $3,
       processed_at = NOW()`,
    [workspaceId, conversationId, errorMsg.substring(0, 500)]
  );
}
