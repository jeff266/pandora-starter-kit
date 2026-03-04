/**
 * Activity Signals Classification Layer
 *
 * Extracts structured signals from CRM activity body content and stores them
 * in the activity_signals table (one row per signal per activity).
 *
 * Two-pass extraction:
 * 1. Email header parsing (zero-cost): extracts untracked participants from CC/BCC
 * 2. DeepSeek body extraction: extracts framework signals, notable quotes, blockers, etc.
 *
 * Mirrors conversation_signals pattern proven by Gong call extraction.
 */

import { query } from '../db.js';
import { callLLM } from '../utils/llm-router.js';
import { getQualificationFramework } from '../context/index.js';
import {
  parseEmailHeaders,
  classifyEmailParticipants,
  cleanActivityBody,
  type EmailHeaders,
  type EmailParticipants,
} from '../utils/activity-text.js';

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 1000;
const MODEL_VERSION = 'deepseek-chat-v3-2025';
const MIN_BODY_LENGTH = 100;

// ============================================================================
// Types
// ============================================================================

export interface SignalExtractionResult {
  processed: number;
  extracted: number;
  skipped: number;
  errors: string[];
  duration_ms: number;
  tokens_used: number;
}

export interface ExtractedSignal {
  signal_type: SignalType;
  signal_value: string | null;
  framework_field: string | null;
  source_quote: string | null;
  speaker_type: 'prospect' | 'rep' | 'unknown';
  speaker_confidence: number;
  verbatim: boolean;
  confidence: number;
}

export interface ActivitySignalBatch {
  activity_id: string;
  signals: ExtractedSignal[];
}

export type SignalType =
  | 'framework_signal'
  | 'notable_quote'
  | 'blocker_mention'
  | 'buyer_signal'
  | 'timeline_mention'
  | 'stakeholder_mention'
  | 'untracked_participant'
  | 'competitor_mention';

interface ActivityRecord {
  id: string;
  workspace_id: string;
  activity_type: string;
  subject: string | null;
  body: string | null;
  timestamp: string;
  actor: string | null;
  deal_id: string | null;
  account_id: string | null;
}

interface RepDomain {
  domain: string;
}

// ============================================================================
// Main Function
// ============================================================================

export async function extractActivitySignals(
  workspaceId: string,
  options?: {
    force?: boolean;  // Re-extract even if already processed
    limit?: number;   // Max activities per run (default 100)
  }
): Promise<SignalExtractionResult> {
  const start = Date.now();
  const limit = options?.limit ?? 100;

  const result: SignalExtractionResult = {
    processed: 0,
    extracted: 0,
    skipped: 0,
    errors: [],
    duration_ms: 0,
    tokens_used: 0,
  };

  // Step 1: Find unprocessed activities
  const activities = await findUnprocessedActivities(workspaceId, limit, options?.force);

  if (activities.length === 0) {
    result.duration_ms = Date.now() - start;
    return result;
  }

  result.processed = activities.length;

  // Step 2: Get rep domain for direction classification
  const repDomain = await getRepDomain(workspaceId);

  // Step 3: Load workspace qualification framework
  const framework = await getQualificationFramework(workspaceId);

  // Step 4: Process in batches
  for (let i = 0; i < activities.length; i += BATCH_SIZE) {
    const batch = activities.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (activity) => {
      try {
        const signals: ExtractedSignal[] = [];
        let tokensUsed = 0;

        // Pass 1: Email header extraction (zero-cost)
        if (activity.activity_type === 'email' && activity.body) {
          const headerSignals = await extractEmailHeaderSignals(
            activity,
            repDomain
          );
          signals.push(...headerSignals);
        }

        // Pass 2: DeepSeek body extraction
        if (activity.body) {
          const cleaned = cleanActivityBody(activity.body, activity.activity_type);

          if (cleaned.length < MIN_BODY_LENGTH) {
            await recordSkippedRun(workspaceId, activity.id, 'body_too_short');
            result.skipped++;
            return;
          }

          const headers = parseEmailHeaders(activity.body);
          const participants = classifyEmailParticipants(headers, repDomain);

          const bodySignals = await classifySignals(
            workspaceId,
            activity,
            cleaned,
            framework,
            participants
          );

          signals.push(...bodySignals.signals);
          tokensUsed = bodySignals.tokensUsed;
        }

        if (signals.length === 0 && activity.body && activity.body.length > 0) {
          await recordSkippedRun(workspaceId, activity.id, 'no_signals_detected');
          result.skipped++;
          return;
        }

        // Insert signals into activity_signals table
        await insertSignals(workspaceId, activity, signals);

        // Record successful run
        await recordSuccessfulRun(workspaceId, activity.id, signals.length, tokensUsed);

        result.extracted += signals.length;
        result.tokens_used += tokensUsed;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`${activity.id}: ${msg}`);
        await recordErrorRun(workspaceId, activity.id, msg);
      }
    }));

    if (i + BATCH_SIZE < activities.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  result.duration_ms = Date.now() - start;

  console.log(
    `[ActivitySignals] ${workspaceId}: ${result.extracted} signals extracted from ` +
    `${result.processed - result.skipped} activities, ${result.skipped} skipped, ` +
    `${result.errors.length} errors, ${result.tokens_used} tokens (${result.duration_ms}ms)`
  );

  return result;
}

// ============================================================================
// Query Helpers
// ============================================================================

async function findUnprocessedActivities(
  workspaceId: string,
  limit: number,
  force?: boolean
): Promise<ActivityRecord[]> {
  const whereClause = force
    ? `a.workspace_id = $1 AND a.body IS NOT NULL AND LENGTH(a.body) > 30`
    : `a.workspace_id = $1
       AND a.body IS NOT NULL
       AND LENGTH(a.body) > 30
       AND a.id NOT IN (
         SELECT activity_id FROM activity_signal_runs
         WHERE workspace_id = $1
       )`;

  const result = await query<ActivityRecord>(
    `SELECT a.id, a.workspace_id, a.activity_type, a.subject, a.body,
            a.timestamp, a.actor, a.deal_id, a.account_id
     FROM activities a
     WHERE ${whereClause}
     ORDER BY a.timestamp DESC
     LIMIT $2`,
    [workspaceId, limit]
  );

  return result.rows;
}

async function getRepDomain(workspaceId: string): Promise<string> {
  // Get rep domain from sales_reps table (has workspace scoping)
  const result = await query<RepDomain>(
    `SELECT SPLIT_PART(rep_email, '@', 2) as domain
     FROM sales_reps
     WHERE workspace_id = $1 AND rep_email IS NOT NULL AND rep_email LIKE '%@%'
     LIMIT 1`,
    [workspaceId]
  );

  if (result.rows.length > 0) {
    return result.rows[0].domain;
  }

  // Fallback: get from user_workspaces → users join
  const uwResult = await query<RepDomain>(
    `SELECT SPLIT_PART(u.email, '@', 2) as domain
     FROM user_workspaces uw
     JOIN users u ON u.id = uw.user_id
     WHERE uw.workspace_id = $1 AND u.email IS NOT NULL AND u.email LIKE '%@%'
     LIMIT 1`,
    [workspaceId]
  );

  return uwResult.rows[0]?.domain || 'unknown.com';
}

// ============================================================================
// Email Header Extraction (Zero-Cost)
// ============================================================================

async function extractEmailHeaderSignals(
  activity: ActivityRecord,
  repDomain: string
): Promise<ExtractedSignal[]> {
  const signals: ExtractedSignal[] = [];

  if (!activity.body) return signals;

  const headers = parseEmailHeaders(activity.body);

  if (!headers.hasHeaders) return signals;

  // Get all CRM contacts for this workspace
  const contactsResult = await query<{ email: string }>(
    `SELECT LOWER(email) as email FROM contacts WHERE workspace_id = $1
     UNION
     SELECT LOWER(email) as email FROM deal_contacts dc
     INNER JOIN contacts c ON c.id = dc.contact_id
     WHERE c.workspace_id = $1`,
    [activity.workspace_id]
  );

  const crmEmails = new Set(contactsResult.rows.map(r => r.email));

  // Find untracked participants in CC/BCC
  const allRecipients = [...headers.cc, ...headers.bcc];
  const repDomainLower = repDomain.toLowerCase();

  for (const email of allRecipients) {
    const emailLower = email.toLowerCase();
    const domain = email.split('@')[1]?.toLowerCase();

    // Skip internal addresses
    if (domain === repDomainLower) continue;

    // Skip if already in CRM
    if (crmEmails.has(emailLower)) continue;

    signals.push({
      signal_type: 'untracked_participant',
      signal_value: email,
      framework_field: null,
      source_quote: `CC/BCC: ${email}`,
      speaker_type: 'prospect',
      speaker_confidence: 0.9,
      verbatim: true,
      confidence: 0.95,
    });
  }

  return signals;
}

// ============================================================================
// DeepSeek Classification
// ============================================================================

async function classifySignals(
  workspaceId: string,
  activity: ActivityRecord,
  cleanedBody: string,
  framework: { framework: string; fields: Record<string, string[]> },
  participants: EmailParticipants
): Promise<{ signals: ExtractedSignal[]; tokensUsed: number }> {
  const activeFramework = framework.framework;
  const frameworkFields = framework.fields[activeFramework] || [];

  const activityInfo = buildActivityInfo(activity, cleanedBody, participants);

  const prompt = `You are a B2B sales activity analyst extracting structured signals from CRM activity content.

Activity to analyze:
${activityInfo}

Current qualification framework: ${activeFramework}
Framework fields: ${frameworkFields.join(', ')}

Respond with a JSON object:
{
  "activity_id": "${activity.id}",
  "signals": [
    {
      "signal_type": "framework_signal",
      "signal_value": "We need to be live by Q3 for annual planning",
      "framework_field": "timeline",
      "source_quote": "We need to be live by Q3 for annual planning",
      "speaker_type": "prospect",
      "speaker_confidence": 0.85,
      "verbatim": true,
      "confidence": 0.9
    },
    {
      "signal_type": "notable_quote",
      "signal_value": "This will save our team 20 hours per week",
      "framework_field": null,
      "source_quote": "This will save our team 20 hours per week",
      "speaker_type": "prospect",
      "speaker_confidence": 0.8,
      "verbatim": true,
      "confidence": 0.85
    },
    {
      "signal_type": "blocker_mention",
      "signal_value": "Need legal review before proceeding",
      "framework_field": null,
      "source_quote": "Need legal review before proceeding",
      "speaker_type": "prospect",
      "speaker_confidence": 0.9,
      "verbatim": false,
      "confidence": 0.88
    },
    {
      "signal_type": "competitor_mention",
      "signal_value": "Aspen Technology",
      "framework_field": null,
      "source_quote": "We're also evaluating Aspen Technology for this",
      "speaker_type": "prospect",
      "speaker_confidence": 0.95,
      "verbatim": true,
      "confidence": 0.92
    }
  ]
}

Signal type definitions:
- framework_signal: Content mapping to ${activeFramework} framework fields (${frameworkFields.join(', ')}). Set framework_field to the matching field name.
- notable_quote: Compelling prospect statement worth surfacing (impact, urgency, value). Keep verbatim if possible.
- blocker_mention: Concern, obstacle, or blocker preventing deal progress (legal review, security, budget freeze, etc.)
- buyer_signal: Positive purchase intent (asking about contracts, implementation, pricing, next steps)
- timeline_mention: Specific date, quarter, or deadline mentioned (Q3, Jan 15, end of year, etc.)
- stakeholder_mention: Reference to additional stakeholders not logged in CRM (VP mentioned, CFO needs to approve, etc.)
- competitor_mention: Named competitor, alternative vendor, or "do nothing" option mentioned. Set signal_value to the competitor/vendor name. Include "do nothing" or "status quo" if the prospect mentions not changing their current approach.

Speaker attribution rules:
- If direction is "inbound" (${participants.direction}), speaker_type = "prospect"
- If direction is "outbound", speaker_type = "rep"
- For notes, look for markers like "they said", "customer mentioned", "I told them" to classify
- speaker_confidence: 0-1 score for attribution certainty

Only output signals where confidence >= 0.7. Skip the rest.
Keep source_quote under 200 characters.
Respond with ONLY valid JSON.`;

  const response = await callLLM(workspaceId, 'classify', {
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 2000,
    temperature: 0.1,
    _tracking: {
      feature: 'activity_signal_extraction',
      subFeature: 'deepseek_body_extraction',
    } as any,
  });

  // Estimate tokens used (rough: prompt ~500, response ~800, total ~1300 tokens = ~0.2¢)
  const estimatedTokens = Math.ceil((prompt.length + response.content.length) / 4);

  // Parse response
  const cleaned = response.content
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as ActivitySignalBatch;
    // Guard: DeepSeek sometimes returns {} or omits "signals" key
    const signals: ExtractedSignal[] = Array.isArray(parsed.signals) ? parsed.signals : [];
    const validSignals = signals.filter(s => s.confidence >= 0.7);
    return { signals: validSignals, tokensUsed: estimatedTokens };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[ActivitySignals] JSON parse failed for ${activity.id}:`,
      cleaned.substring(0, 200)
    );
    throw new Error(`DeepSeek returned invalid JSON: ${msg}`);
  }
}

function buildActivityInfo(
  activity: ActivityRecord,
  cleanedBody: string,
  participants: EmailParticipants
): string {
  const parts: string[] = [];

  parts.push(`Type: ${activity.activity_type || 'note'}`);

  if (activity.subject) {
    parts.push(`Subject: ${activity.subject}`);
  }

  if (activity.timestamp) {
    const date = new Date(activity.timestamp).toLocaleDateString();
    parts.push(`Date: ${date}`);
  }

  if (participants.direction !== 'unknown') {
    parts.push(`Direction: ${participants.direction}`);
  }

  if (activity.actor) {
    parts.push(`Actor: ${activity.actor}`);
  }

  parts.push(`\nBody:\n${cleanedBody}`);

  return parts.join('\n');
}

// ============================================================================
// Database Operations
// ============================================================================

async function insertSignals(
  workspaceId: string,
  activity: ActivityRecord,
  signals: ExtractedSignal[]
): Promise<void> {
  if (signals.length === 0) {
    return;
  }

  // Build multi-row insert
  const values: any[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const signal of signals) {
    // Determine extraction method
    const extractionMethod = signal.signal_type === 'untracked_participant'
      ? 'header_parse'
      : 'deepseek';

    placeholders.push(
      `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7}, $${idx + 8}, $${idx + 9}, $${idx + 10}, $${idx + 11}, $${idx + 12})`
    );
    values.push(
      workspaceId,
      activity.id,
      activity.deal_id,
      activity.account_id,
      signal.signal_type,
      signal.signal_value,
      signal.framework_field,
      signal.source_quote,
      signal.speaker_type,
      signal.speaker_confidence,
      signal.verbatim,
      signal.confidence,
      extractionMethod
    );
    idx += 13;
  }

  await query(
    `INSERT INTO activity_signals
      (workspace_id, activity_id, deal_id, account_id, signal_type, signal_value,
       framework_field, source_quote, speaker_type, speaker_confidence, verbatim,
       confidence, extraction_method)
     VALUES ${placeholders.join(', ')}`,
    values
  );
}

async function recordSuccessfulRun(
  workspaceId: string,
  activityId: string,
  signalsExtracted: number,
  tokensUsed: number
): Promise<void> {
  await query(
    `INSERT INTO activity_signal_runs
      (workspace_id, activity_id, status, signals_extracted, tokens_used)
     VALUES ($1, $2, 'completed', $3, $4)
     ON CONFLICT (activity_id) DO UPDATE SET
       status = 'completed',
       signals_extracted = $3,
       tokens_used = $4,
       processed_at = NOW()`,
    [workspaceId, activityId, signalsExtracted, tokensUsed]
  );
}

async function recordSkippedRun(
  workspaceId: string,
  activityId: string,
  skipReason: string
): Promise<void> {
  await query(
    `INSERT INTO activity_signal_runs
      (workspace_id, activity_id, status, skip_reason, tokens_used)
     VALUES ($1, $2, 'skipped', $3, 0)
     ON CONFLICT (activity_id) DO UPDATE SET
       status = 'skipped',
       skip_reason = $3,
       tokens_used = 0,
       processed_at = NOW()`,
    [workspaceId, activityId, skipReason]
  );
}

async function recordErrorRun(
  workspaceId: string,
  activityId: string,
  errorMsg: string
): Promise<void> {
  await query(
    `INSERT INTO activity_signal_runs
      (workspace_id, activity_id, status, skip_reason, tokens_used)
     VALUES ($1, $2, 'failed', $3, 0)
     ON CONFLICT (activity_id) DO UPDATE SET
       status = 'failed',
       skip_reason = $3,
       tokens_used = 0,
       processed_at = NOW()`,
    [workspaceId, activityId, errorMsg.substring(0, 500)]
  );
}
