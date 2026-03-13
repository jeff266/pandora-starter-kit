/**
 * Feedback Processor
 *
 * Converts user feedback on agent outputs into tuning pairs that improve future briefings.
 * The complete learning loop: generate → remember → receive feedback → learn → generate better.
 */

import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { saveTuningPair, removeTuningPair } from './tuning.js';

const logger = createLogger('FeedbackProcessor');

const MAX_TUNING_PAIRS = 15;

// ============================================================================
// Types
// ============================================================================

export interface AgentFeedback {
  id: string;
  workspace_id: string;
  agent_id: string;
  generation_id: string;
  user_id?: string;
  feedback_type: 'section' | 'editorial' | 'overall';
  section_id?: string;
  signal: string;
  rating?: number;
  comment?: string;
  processed: boolean;
  tuning_key?: string;
  created_at: string;
}

interface FeedbackProcessResult {
  tuningKey: string;
  tuningValue: {
    instruction: string;
    confidence: number;
    source: 'user_feedback';
    feedback_id: string;
    created_at: string;
  };
}

// ============================================================================
// Main Processing Function
// ============================================================================

/**
 * Process a feedback record: convert to tuning pair if applicable
 */
export async function processFeedback(feedback: AgentFeedback): Promise<void> {
  logger.info('[FeedbackProcessor] Processing feedback', {
    feedback_id: feedback.id,
    agent_id: feedback.agent_id,
    signal: feedback.signal,
    section_id: feedback.section_id,
  });

  const result = convertFeedbackToTuning(feedback);

  if (!result) {
    // Some feedback signals are informational only (e.g., wrong_data requires manual fix)
    logger.info('[FeedbackProcessor] Feedback is informational only, no tuning pair generated', {
      feedback_id: feedback.id,
      signal: feedback.signal,
    });
    await markFeedbackProcessed(feedback.id, null);
    return;
  }

  // Write tuning pair to context_layer
  await saveTuningPair(
    feedback.agent_id,
    feedback.workspace_id,
    result.tuningKey.replace(`${feedback.agent_id}:`, ''), // Remove agent prefix for saveTuningPair
    result.tuningValue,
    {
      source: 'user_feedback',
      confidence: result.tuningValue.confidence,
      feedback_id: feedback.id,
    }
  );

  // CRITICAL FIX: Also write to agent_tuning_pairs (the table getTuningPairs reads from)
  // This closes the feedback loop: user feedback → tuning pairs → agent improvement
  await query(
    `INSERT INTO agent_tuning_pairs
       (workspace_id, agent_id, generation_id, skill_id, source, block_id, input_context, preferred_output)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (workspace_id, agent_id, generation_id, block_id) DO UPDATE
     SET preferred_output = EXCLUDED.preferred_output,
         input_context = EXCLUDED.input_context,
         source = EXCLUDED.source`,
    [
      feedback.workspace_id,
      feedback.agent_id,
      feedback.generation_id,
      null, // skill_id - not specified in feedback, nullable
      'user_feedback', // source
      feedback.section_id || null, // block_id - use section_id if available
      result.tuningKey, // input_context - store the tuning key for context
      result.tuningValue.instruction, // preferred_output - the instruction text
    ]
  );

  logger.info('[FeedbackProcessor] Tuning pair created', {
    feedback_id: feedback.id,
    tuning_key: result.tuningKey,
    confidence: result.tuningValue.confidence,
  });

  // Mark feedback as processed
  await markFeedbackProcessed(feedback.id, result.tuningKey);

  // Enforce tuning cap (max 15 pairs per agent)
  await enforceTuningCap(feedback.workspace_id, feedback.agent_id);
}

// ============================================================================
// Feedback → Tuning Conversion Logic
// ============================================================================

/**
 * Convert a feedback signal into a tuning pair instruction
 */
function convertFeedbackToTuning(feedback: AgentFeedback): FeedbackProcessResult | null {
  const agentId = feedback.agent_id;
  const sectionId = feedback.section_id;
  const base = {
    source: 'user_feedback' as const,
    feedback_id: feedback.id,
    created_at: new Date().toISOString(),
  };

  switch (feedback.signal) {
    // ── Section-level tuning ──

    case 'too_detailed':
      if (!sectionId) return null;
      return {
        tuningKey: `${agentId}:section_depth:${sectionId}`,
        tuningValue: {
          instruction: `Keep the "${sectionId}" section brief — 1-2 key points maximum. The reader said it was too detailed.${feedback.comment ? ` Their note: "${feedback.comment}"` : ''}`,
          confidence: 0.8,
          ...base,
        },
      };

    case 'too_brief':
      if (!sectionId) return null;
      return {
        tuningKey: `${agentId}:section_depth:${sectionId}`,
        tuningValue: {
          instruction: `Expand the "${sectionId}" section with more context and supporting data. The reader said it was too brief.${feedback.comment ? ` Their note: "${feedback.comment}"` : ''}`,
          confidence: 0.8,
          ...base,
        },
      };

    case 'wrong_emphasis':
      if (!sectionId) return null;
      return {
        tuningKey: `${agentId}:emphasis:${sectionId}`,
        tuningValue: {
          instruction: `In the "${sectionId}" section, the reader said you focused on the wrong thing.${feedback.comment ? ` They want: "${feedback.comment}"` : ' Reconsider what to highlight next time.'}`,
          confidence: 0.7,
          ...base,
        },
      };

    case 'good_insight':
      if (!sectionId) return null;
      return {
        tuningKey: `${agentId}:reinforce:${sectionId}`,
        tuningValue: {
          instruction: `The "${sectionId}" section was called out as a great insight. Continue this type of analysis — the reader finds it valuable.${feedback.comment ? ` They noted: "${feedback.comment}"` : ''}`,
          confidence: 0.9,
          ...base,
        },
      };

    case 'missing_context':
      if (!sectionId) return null;
      return {
        tuningKey: `${agentId}:context:${sectionId}`,
        tuningValue: {
          instruction: `The "${sectionId}" section was missing context the reader expected.${feedback.comment ? ` Specifically: "${feedback.comment}"` : ' Include more supporting data and background next time.'}`,
          confidence: 0.7,
          ...base,
        },
      };

    // ── Editorial-level tuning ──

    case 'wrong_lead':
      return {
        tuningKey: `${agentId}:lead_preference`,
        tuningValue: {
          instruction: `The reader said you led with the wrong section.${feedback.comment ? ` They prefer leading with: "${feedback.comment}"` : ' Reconsider your lead section choice — prioritize what the reader cares about most.'}`,
          confidence: 0.7,
          ...base,
        },
      };

    case 'wrong_order':
      return {
        tuningKey: `${agentId}:order_preference`,
        tuningValue: {
          instruction: `The section order was wrong.${feedback.comment ? ` Reader prefers: "${feedback.comment}"` : ' Reconsider the order — put the most actionable sections first.'}`,
          confidence: 0.6,
          ...base,
        },
      };

    case 'wrong_tone':
      return {
        tuningKey: `${agentId}:tone_preference`,
        tuningValue: {
          instruction: `The tone was wrong for this audience.${feedback.comment ? ` Reader says: "${feedback.comment}"` : ' Adjust formality and language to better match the audience.'}`,
          confidence: 0.6,
          ...base,
        },
      };

    case 'good_structure':
      return {
        tuningKey: `${agentId}:structure_reinforcement`,
        tuningValue: {
          instruction: `The briefing structure and flow were rated positively. Maintain this organizational approach.`,
          confidence: 0.85,
          ...base,
        },
      };

    // ── Overall tuning ──

    case 'keep_doing_this':
      return {
        tuningKey: `${agentId}:positive_reinforcement`,
        tuningValue: {
          instruction: `This briefing was rated highly overall. Maintain this approach to structure, depth, and tone.${feedback.comment ? ` Reader noted: "${feedback.comment}"` : ''}`,
          confidence: 0.9,
          ...base,
        },
      };

    // ── Informational only (no tuning pair generated) ──

    case 'wrong_data':
      // Factual errors can't be fixed via tuning — they need data/skill fixes
      // Log it but don't generate a tuning pair
      logger.warn('[FeedbackProcessor] wrong_data signal - requires manual fix', {
        feedback_id: feedback.id,
        section_id: sectionId,
        comment: feedback.comment,
      });
      return null;

    case 'useful':
    case 'not_useful':
      // Simple binary feedback — use for analytics but don't generate specific tuning
      // Unless there's a comment, in which case create a general note
      if (feedback.comment) {
        return {
          tuningKey: `${agentId}:general:${feedback.section_id || 'overall'}`,
          tuningValue: {
            instruction: `Reader feedback${feedback.section_id ? ` on "${feedback.section_id}"` : ''}: "${feedback.comment}"`,
            confidence: 0.5,
            ...base,
          },
        };
      }
      return null;

    default:
      logger.warn('[FeedbackProcessor] Unknown signal type', { signal: feedback.signal });
      return null;
  }
}

// ============================================================================
// Database Helpers
// ============================================================================

/**
 * Mark feedback as processed
 */
async function markFeedbackProcessed(feedbackId: string, tuningKey: string | null): Promise<void> {
  await query(
    `UPDATE agent_feedback
     SET processed = true, tuning_key = $1
     WHERE id = $2`,
    [tuningKey, feedbackId]
  );

  logger.info('[FeedbackProcessor] Feedback marked as processed', { feedback_id: feedbackId, tuning_key: tuningKey });
}

/**
 * Enforce tuning cap: max 15 pairs per agent
 * Evict oldest pairs with lowest confidence when cap is exceeded
 */
async function enforceTuningCap(workspaceId: string, agentId: string): Promise<void> {
  logger.info('[FeedbackProcessor] Enforcing tuning cap', { workspace_id: workspaceId, agent_id: agentId });

  // Get all tuning pairs for this agent
  const result = await query(
    `SELECT key, value, updated_at
     FROM context_layer
     WHERE workspace_id = $1
       AND category = 'agent_tuning'
       AND key LIKE $2
     ORDER BY updated_at DESC`,
    [workspaceId, `${agentId}:%`]
  );

  const pairs = result.rows;

  logger.info('[FeedbackProcessor] Current tuning pair count', {
    workspace_id: workspaceId,
    agent_id: agentId,
    count: pairs.length,
    cap: MAX_TUNING_PAIRS,
  });

  if (pairs.length > MAX_TUNING_PAIRS) {
    // Sort by confidence (lowest first), then by age (oldest first)
    const sortedPairs = pairs
      .map(row => ({
        key: row.key,
        confidence: typeof row.value === 'string' ? JSON.parse(row.value).confidence : row.value.confidence,
        updated_at: row.updated_at,
      }))
      .sort((a, b) => {
        // Sort by confidence ascending, then by updated_at ascending
        if (a.confidence !== b.confidence) {
          return a.confidence - b.confidence;
        }
        return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      });

    // Delete the excess pairs (lowest confidence + oldest)
    const toDelete = sortedPairs.slice(0, pairs.length - MAX_TUNING_PAIRS);

    logger.info('[FeedbackProcessor] Evicting tuning pairs', {
      workspace_id: workspaceId,
      agent_id: agentId,
      evict_count: toDelete.length,
      keys: toDelete.map(p => p.key),
    });

    for (const pair of toDelete) {
      await query(
        `DELETE FROM context_layer
         WHERE workspace_id = $1 AND category = 'agent_tuning' AND key = $2`,
        [workspaceId, pair.key]
      );
    }

    logger.info('[FeedbackProcessor] Tuning cap enforced', {
      workspace_id: workspaceId,
      agent_id: agentId,
      removed: toDelete.length,
      remaining: MAX_TUNING_PAIRS,
    });
  }
}

/**
 * Get feedback summary for a generation (for viewer UI)
 */
export async function getFeedbackSummary(generationId: string): Promise<{
  generation_id: string;
  sections: Record<string, {
    has_feedback: boolean;
    signals: string[];
    rating?: number;
  }>;
  overall: {
    has_feedback: boolean;
    rating?: number;
    signals: string[];
  };
  total_feedback_count: number;
}> {
  const result = await query(
    `SELECT section_id, signal, rating, feedback_type
     FROM agent_feedback
     WHERE generation_id = $1
     ORDER BY created_at DESC`,
    [generationId]
  );

  const sections: Record<string, { has_feedback: boolean; signals: string[]; rating?: number }> = {};
  const overallSignals: string[] = [];
  let overallRating: number | undefined;

  for (const row of result.rows) {
    if (row.feedback_type === 'section' && row.section_id) {
      if (!sections[row.section_id]) {
        sections[row.section_id] = { has_feedback: true, signals: [] };
      }
      sections[row.section_id].signals.push(row.signal);
      if (row.rating && !sections[row.section_id].rating) {
        sections[row.section_id].rating = row.rating;
      }
    } else if (row.feedback_type === 'overall' || row.feedback_type === 'editorial') {
      overallSignals.push(row.signal);
      if (row.rating && !overallRating) {
        overallRating = row.rating;
      }
    }
  }

  return {
    generation_id: generationId,
    sections,
    overall: {
      has_feedback: overallSignals.length > 0,
      rating: overallRating,
      signals: overallSignals,
    },
    total_feedback_count: result.rows.length,
  };
}
