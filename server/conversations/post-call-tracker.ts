/**
 * Post-Call CRM Follow-Through Tracker
 *
 * Tracks whether the CRM was updated after a conversation:
 * - Snapshots deal state immediately after call is linked
 * - Checks 24h+ later: did stage change? was activity logged? is next meeting scheduled?
 *
 * Runs automatically after sync + link cycle.
 */

import { query, getClient } from '../db.js';
import type { PoolClient } from 'pg';

export interface PostCallCrmState {
  captured_at: string;              // ISO timestamp
  deal_stage_at_call: string;
  deal_stage_after: string | null;  // Checked 24h+ later
  deal_stage_changed: boolean;
  next_step_updated: boolean;
  close_date_changed: boolean;
  amount_changed: boolean;
  activity_logged: boolean;
  next_meeting_scheduled: boolean | null;
}

/**
 * Snapshot deal state for conversations that were just linked to a deal
 * Runs immediately after cross-entity linker completes
 */
export async function snapshotDealStateAtCall(
  workspaceId: string
): Promise<number> {
  const client = await getClient();

  try {
    // Find conversations linked to deals but without a snapshot
    const conversationsResult = await query<{
      id: string;
      call_date: string;
      deal_id: string;
    }>(
      `SELECT c.id, c.call_date, c.deal_id
       FROM conversations c
       WHERE c.workspace_id = $1
         AND c.deal_id IS NOT NULL
         AND c.post_call_crm_state IS NULL
       ORDER BY c.call_date DESC
       LIMIT 500`,
      [workspaceId]
    );

    const conversations = conversationsResult.rows;
    if (conversations.length === 0) {
      return 0;
    }

    let snapshotCount = 0;

    for (const conv of conversations) {
      // Get current deal state
      const dealResult = await client.query<{
        stage: string;
        stage_normalized: string;
        close_date: string;
        amount: number;
        health_score: number | null;
        next_step: string | null;
      }>(
        `SELECT stage, stage_normalized, close_date, amount, health_score, next_step
         FROM deals
         WHERE id = $1 AND workspace_id = $2`,
        [conv.deal_id, workspaceId]
      );

      if (dealResult.rows.length === 0) continue;

      const deal = dealResult.rows[0];

      // Check if there are activities logged after this conversation
      const activityResult = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(
           SELECT 1 FROM activities
           WHERE deal_id = $1
             AND timestamp > $2
           LIMIT 1
         ) AS exists`,
        [conv.deal_id, conv.call_date]
      );
      const activityLogged = activityResult.rows[0]?.exists || false;

      // Check if there's a next meeting scheduled (future conversation)
      const nextMeetingResult = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(
           SELECT 1 FROM conversations
           WHERE deal_id = $1
             AND call_date > $2
           LIMIT 1
         ) AS exists`,
        [conv.deal_id, conv.call_date]
      );
      const nextMeetingScheduled = nextMeetingResult.rows[0]?.exists || false;

      // Create snapshot
      const snapshot: PostCallCrmState = {
        captured_at: new Date().toISOString(),
        deal_stage_at_call: deal.stage_normalized || deal.stage,
        deal_stage_after: null,
        deal_stage_changed: false,
        next_step_updated: !!deal.next_step,
        close_date_changed: false,
        amount_changed: false,
        activity_logged: activityLogged,
        next_meeting_scheduled: nextMeetingScheduled,
      };

      // Update conversation with snapshot + health_before
      await client.query(
        `UPDATE conversations
         SET post_call_crm_state = $1,
             deal_health_before = $2,
             updated_at = NOW()
         WHERE id = $3 AND workspace_id = $4`,
        [JSON.stringify(snapshot), deal.health_score, conv.id, workspaceId]
      );

      snapshotCount++;
    }

    console.log(`[PostCallTracker] Snapshotted ${snapshotCount} conversations for workspace ${workspaceId}`);
    return snapshotCount;
  } finally {
    client.release();
  }
}

/**
 * Check CRM follow-through for conversations 24h+ after the call
 * Compares current deal state to the snapshot to detect changes
 */
export async function checkPostCallFollowThrough(
  workspaceId: string
): Promise<number> {
  const client = await getClient();

  try {
    // Find conversations ready for follow-through check:
    // - Have a snapshot (post_call_crm_state not null)
    // - Haven't been checked yet (deal_stage_after is null)
    // - Are 24h+ old
    const conversationsResult = await query<{
      id: string;
      call_date: string;
      deal_id: string;
      post_call_crm_state: PostCallCrmState;
    }>(
      `SELECT c.id, c.call_date, c.deal_id, c.post_call_crm_state
       FROM conversations c
       WHERE c.workspace_id = $1
         AND c.post_call_crm_state IS NOT NULL
         AND c.post_call_crm_state->>'deal_stage_after' IS NULL
         AND c.call_date < NOW() - INTERVAL '24 hours'
       ORDER BY c.call_date DESC
       LIMIT 500`,
      [workspaceId]
    );

    const conversations = conversationsResult.rows;
    if (conversations.length === 0) {
      return 0;
    }

    let updatedCount = 0;

    for (const conv of conversations) {
      const snapshot = conv.post_call_crm_state;

      // Get current deal state
      const dealResult = await client.query<{
        stage: string;
        stage_normalized: string;
        close_date: string;
        amount: number;
        health_score: number | null;
        next_step: string | null;
      }>(
        `SELECT stage, stage_normalized, close_date, amount, health_score, next_step
         FROM deals
         WHERE id = $1 AND workspace_id = $2`,
        [conv.deal_id, workspaceId]
      );

      if (dealResult.rows.length === 0) continue;

      const deal = dealResult.rows[0];
      const currentStage = deal.stage_normalized || deal.stage;

      // Compare to snapshot
      const stageChanged = currentStage !== snapshot.deal_stage_at_call;

      // Check if activities were logged after the call
      const activityResult = await client.query<{ count: number }>(
        `SELECT COUNT(*) as count
         FROM activities
         WHERE deal_id = $1
           AND timestamp > $2
           AND timestamp < NOW()`,
        [conv.deal_id, conv.call_date]
      );
      const activityLogged = Number(activityResult.rows[0]?.count || 0) > 0;

      // Check if next meeting was scheduled
      const nextMeetingResult = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(
           SELECT 1 FROM conversations
           WHERE deal_id = $1
             AND call_date > $2
           LIMIT 1
         ) AS exists`,
        [conv.deal_id, conv.call_date]
      );
      const nextMeetingScheduled = nextMeetingResult.rows[0]?.exists || false;

      // Get original close date from snapshot time (check field change history if available)
      // For now, we'll use a heuristic: if close_date is in the past relative to call date, it changed
      const closeDateAtCall = new Date(snapshot.captured_at);
      const currentCloseDate = new Date(deal.close_date);
      const callDate = new Date(conv.call_date);

      // Simple heuristic: close date changed if it's now later than it should have been
      const closeDateChanged = currentCloseDate > closeDateAtCall;

      // Check if amount changed (requires field change history - skip for now)
      const amountChanged = false; // TODO: implement when field change history available

      // Check if next_step was updated
      const nextStepUpdated = !!deal.next_step && deal.next_step.trim().length > 0;

      // Update snapshot with findings
      const updatedSnapshot: PostCallCrmState = {
        ...snapshot,
        deal_stage_after: currentStage,
        deal_stage_changed: stageChanged,
        next_step_updated: nextStepUpdated,
        close_date_changed: closeDateChanged,
        amount_changed: amountChanged,
        activity_logged: activityLogged,
        next_meeting_scheduled: nextMeetingScheduled,
      };

      // Update conversation with findings + health_after
      await client.query(
        `UPDATE conversations
         SET post_call_crm_state = $1,
             deal_health_after = $2,
             updated_at = NOW()
         WHERE id = $3 AND workspace_id = $4`,
        [JSON.stringify(updatedSnapshot), deal.health_score, conv.id, workspaceId]
      );

      updatedCount++;
    }

    console.log(`[PostCallTracker] Updated follow-through for ${updatedCount} conversations in workspace ${workspaceId}`);
    return updatedCount;
  } finally {
    client.release();
  }
}

/**
 * Compute hours since a conversation started
 */
export function hoursSinceCall(startedAt: string | Date): number {
  const callTime = typeof startedAt === 'string' ? new Date(startedAt) : startedAt;
  return Math.floor((Date.now() - callTime.getTime()) / (1000 * 60 * 60));
}

/**
 * Get summary statistics for CRM follow-through across workspace
 */
export async function getFollowThroughStats(
  workspaceId: string
): Promise<{
  total_conversations: number;
  with_snapshots: number;
  with_followup_checks: number;
  stage_changed_pct: number;
  activity_logged_pct: number;
  next_meeting_scheduled_pct: number;
}> {
  const result = await query<{
    total: number;
    with_snapshots: number;
    with_followup: number;
    stage_changed: number;
    activity_logged: number;
    next_meeting: number;
  }>(
    `SELECT
       COUNT(*) as total,
       COUNT(CASE WHEN post_call_crm_state IS NOT NULL THEN 1 END) as with_snapshots,
       COUNT(CASE WHEN post_call_crm_state->>'deal_stage_after' IS NOT NULL THEN 1 END) as with_followup,
       COUNT(CASE WHEN (post_call_crm_state->>'deal_stage_changed')::boolean = true THEN 1 END) as stage_changed,
       COUNT(CASE WHEN (post_call_crm_state->>'activity_logged')::boolean = true THEN 1 END) as activity_logged,
       COUNT(CASE WHEN (post_call_crm_state->>'next_meeting_scheduled')::boolean = true THEN 1 END) as next_meeting
     FROM conversations
     WHERE workspace_id = $1
       AND deal_id IS NOT NULL
       AND call_date > NOW() - INTERVAL '90 days'`,
    [workspaceId]
  );

  const row = result.rows[0];
  const withFollowup = Number(row?.with_followup || 0);

  return {
    total_conversations: Number(row?.total || 0),
    with_snapshots: Number(row?.with_snapshots || 0),
    with_followup_checks: withFollowup,
    stage_changed_pct: withFollowup > 0 ? Math.round((Number(row?.stage_changed || 0) / withFollowup) * 100) : 0,
    activity_logged_pct: withFollowup > 0 ? Math.round((Number(row?.activity_logged || 0) / withFollowup) * 100) : 0,
    next_meeting_scheduled_pct: withFollowup > 0 ? Math.round((Number(row?.next_meeting || 0) / withFollowup) * 100) : 0,
  };
}
