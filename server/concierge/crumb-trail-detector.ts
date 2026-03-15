/**
 * Crumb Trail Detector
 *
 * Classifies user responses to Concierge briefings and standing hypothesis
 * alerts as affirmation, denial, or neutral — then records a soft intervention
 * timestamp in intervention_log when an actionable signal is detected.
 *
 * Non-fatal: recordCrumbTrail always resolves. Detection is pure/synchronous.
 */

import { query } from '../db.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type CrumbTrailSignal =
  | 'affirmed'        // "great idea", "we're on it", "doing this"
  | 'working_on_it'   // "we're working on it", "in progress", "started"
  | 'already_done'    // "we did this", "already implemented", "tried that"
  | 'declined'        // "not a priority", "disagree", "won't work for us"
  | 'context_added'   // "actually X is in legal review", "that deal is fine"
  | 'neutral';        // no signal — don't record anything

export interface CrumbTrailDetection {
  signal: CrumbTrailSignal;
  confidence: number;       // 0–1
  extractedContext: string; // any factual correction or added context
}

export interface CrumbTrailContext {
  workspaceId: string;
  userId?: string;                   // Slack user ID or Ask Pandora user email
  userMessage: string;
  triggerType: 'slack_reply' | 'ask_pandora';
  triggerMessageId?: string;         // Slack thread_ts or Ask Pandora thread ID
  standingHypothesisId?: string;     // which hypothesis they're responding to
  recommendationText?: string;       // the specific recommendation they responded to
}

// ─────────────────────────────────────────────────────────────────────────────
// Component 1 — Affirmation Detector
// ─────────────────────────────────────────────────────────────────────────────

export function detectCrumbTrail(userMessage: string): CrumbTrailDetection {
  const msg = userMessage.toLowerCase().trim();

  const affirmedPatterns = [
    /great (idea|call|point|catch)/,
    /love (that|this|it)/,
    /we('re| are) (going to|planning to|will) (do|try|implement|work on)/,
    /good (idea|suggestion|point|catch)/,
    /makes sense/,
    /let's do (that|this)/,
    /on it/,
    /agreed/,
    /absolutely/,
    /yes[,.]?\s*(let's|we'll|i'll|we should)/,
  ];

  const workingPatterns = [
    /we('re| are) (already |currently |actively )?(working on|looking at|addressing|fixing)/,
    /in progress/,
    /already (started|kicked off|underway|in flight)/,
    /we (started|kicked off|launched|rolled out)/,
    /(enablement|training|process) (session|change|update) (is |was )?(scheduled|planned|done|complete)/,
  ];

  const donePat = [
    /we (already|previously) (did|tried|implemented|rolled out|launched)/,
    /already (done|complete|implemented|in place)/,
    /we tried that/,
    /that('s| is) already/,
  ];

  const declinedPatterns = [
    /not a priority/,
    /won't work/,
    /disagree/,
    /(don't|do not|doesn't|does not) (think|believe|agree)/,
    /not (relevant|applicable|accurate)/,
    /that's (wrong|off|not right|not the issue)/,
  ];

  const contextPatterns = [
    /(actually|fyi|for context|heads up|to clarify)/,
    /that deal is/,
    /they('re| are) in (legal|procurement|security review)/,
    /(champion|contact|rep) (just |recently )?(left|changed|is)/,
    /we (just |recently )?(hired|promoted|restructured|reorganized)/,
  ];

  // Check in priority order: context > already_done > working_on_it > affirmed > declined
  for (const pattern of contextPatterns) {
    if (pattern.test(msg)) {
      return { signal: 'context_added', confidence: 0.75, extractedContext: userMessage };
    }
  }
  for (const pattern of donePat) {
    if (pattern.test(msg)) {
      return { signal: 'already_done', confidence: 0.80, extractedContext: '' };
    }
  }
  for (const pattern of workingPatterns) {
    if (pattern.test(msg)) {
      return { signal: 'working_on_it', confidence: 0.85, extractedContext: '' };
    }
  }
  for (const pattern of affirmedPatterns) {
    if (pattern.test(msg)) {
      return { signal: 'affirmed', confidence: 0.80, extractedContext: '' };
    }
  }
  for (const pattern of declinedPatterns) {
    if (pattern.test(msg)) {
      return { signal: 'declined', confidence: 0.75, extractedContext: '' };
    }
  }

  return { signal: 'neutral', confidence: 1.0, extractedContext: '' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Component 2 — Intervention Recorder
// ─────────────────────────────────────────────────────────────────────────────

const INTERVENTION_TYPE_MAP: Record<CrumbTrailSignal, string> = {
  affirmed: 'user_affirmed_recommendation',
  working_on_it: 'user_working_on_recommendation',
  already_done: 'user_already_implemented',
  declined: 'user_declined_recommendation',
  context_added: 'user_added_context',
  neutral: '',
};

/**
 * Writes an intervention_log row when the user's message carries an
 * actionable signal. Non-fatal — logs errors and returns silently.
 */
export async function recordCrumbTrail(
  ctx: CrumbTrailContext,
  detection: CrumbTrailDetection
): Promise<void> {
  if (detection.signal === 'neutral') return;
  if (detection.confidence < 0.70) return;

  try {
    const interventionType = INTERVENTION_TYPE_MAP[detection.signal];

    const followUpDate = new Date();
    followUpDate.setDate(followUpDate.getDate() + 42); // 6 weeks

    const description = ctx.recommendationText
      ? `User responded to: "${ctx.recommendationText.slice(0, 200)}"`
      : 'User responded to Concierge briefing';

    await query(
      `INSERT INTO intervention_log (
         workspace_id,
         intervention_type,
         effective_date,
         source,
         description,
         metrics_before,
         follow_up_date,
         follow_up_sent,
         linked_hypothesis_id,
         metadata
       ) VALUES ($1, $2, NOW(), $3, $4, $5, $6, false, $7, $8)`,
      [
        ctx.workspaceId,
        interventionType,
        ctx.triggerType,
        description,
        JSON.stringify({}),
        followUpDate.toISOString().split('T')[0],
        ctx.standingHypothesisId ?? null,
        JSON.stringify({
          userMessage: ctx.userMessage,
          signal: detection.signal,
          confidence: detection.confidence,
          extractedContext: detection.extractedContext,
          triggerMessageId: ctx.triggerMessageId,
          userId: ctx.userId,
        }),
      ]
    );

    console.log(
      `[crumb-trail] Recorded ${detection.signal} (confidence=${detection.confidence}) ` +
      `for workspace ${ctx.workspaceId} via ${ctx.triggerType}`
    );

    // If context_added and links to a hypothesis, annotate the hypothesis
    if (detection.signal === 'context_added' && ctx.standingHypothesisId) {
      await query(
        `UPDATE standing_hypotheses
         SET metadata = COALESCE(metadata, '{}'::jsonb) ||
           jsonb_build_object('user_context', $1::text, 'context_added_at', now()::text)
         WHERE id = $2 AND workspace_id = $3`,
        [detection.extractedContext, ctx.standingHypothesisId, ctx.workspaceId]
      ).catch(err =>
        console.warn('[crumb-trail] Failed to annotate hypothesis:', err.message)
      );
    }
  } catch (err: any) {
    console.warn('[crumb-trail] recordCrumbTrail failed (non-fatal):', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper — find which standing hypothesis (if any) a Slack thread links to
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks intervention_log for an earlier row whose metadata.triggerMessageId
 * matches this thread's parent ts. Returns the linked hypothesis id or null.
 * Always resolves — errors return null.
 */
export async function findLinkedHypothesisFromThread(
  workspaceId: string,
  threadTs: string
): Promise<string | null> {
  try {
    const result = await query<{ linked_hypothesis_id: string }>(
      `SELECT linked_hypothesis_id
       FROM intervention_log
       WHERE workspace_id = $1
         AND metadata->>'triggerMessageId' = $2
         AND linked_hypothesis_id IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [workspaceId, threadTs]
    );
    return result.rows[0]?.linked_hypothesis_id ?? null;
  } catch {
    return null;
  }
}
