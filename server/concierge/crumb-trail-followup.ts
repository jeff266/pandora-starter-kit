/**
 * Crumb Trail Follow-up Job
 *
 * Checks intervention_log for rows whose follow_up_date has passed and
 * follow_up_sent = false. For each due row, calls Claude to synthesize a
 * 2–3 sentence metric movement report, then posts it to the workspace's
 * Slack channel. Called from sendConciergeSlackBrief() on Monday mornings.
 *
 * Non-fatal: errors are logged; individual failures don't halt the batch.
 */

import { query } from '../db.js';
import { callLLM } from '../utils/llm-router.js';
import { getSlackAppClient } from '../connectors/slack/slack-app-client.js';
import { slackPost } from '../slack/thread-tracker.js';
import { PANDORA_VOICE_STANDARD } from '../lib/voice-standard.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface DueFollowUpRow {
  id: string;
  workspace_id: string;
  intervention_type: string;
  description: string;
  follow_up_date: string;
  linked_hypothesis_id: string | null;
  metadata: Record<string, any> | null;
  // from joined standing_hypotheses (may be null if no linked hypothesis)
  hypothesis: string | null;
  metric: string | null;
  current_value: string | null;
  alert_threshold: string | null;
  alert_direction: string | null;
  weekly_values: Array<{ weekOf: string; value: number }> | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends follow-up metric reports for all intervention_log rows that are
 * due (follow_up_date <= now) and not yet sent.
 *
 * Returns the count of follow-ups successfully sent.
 */
export async function sendCrumbTrailFollowUps(workspaceId: string): Promise<number> {
  let sent = 0;

  try {
    const due = await query<DueFollowUpRow>(
      `SELECT
         il.id,
         il.workspace_id,
         il.intervention_type,
         il.description,
         il.follow_up_date,
         il.linked_hypothesis_id,
         il.metadata,
         sh.hypothesis,
         sh.metric,
         sh.current_value::text,
         sh.alert_threshold::text,
         sh.alert_direction,
         sh.weekly_values
       FROM intervention_log il
       LEFT JOIN standing_hypotheses sh
         ON sh.id = il.linked_hypothesis_id
       WHERE il.workspace_id = $1
         AND il.follow_up_date <= NOW()
         AND il.follow_up_sent = false
         AND il.intervention_type IN (
           'user_affirmed_recommendation',
           'user_working_on_recommendation',
           'user_already_implemented'
         )
       ORDER BY il.follow_up_date ASC`,
      [workspaceId]
    );

    if (due.rows.length === 0) return 0;

    console.log(`[crumb-followup] ${due.rows.length} follow-up(s) due for workspace ${workspaceId}`);

    for (const row of due.rows) {
      try {
        await sendFollowUpMessage(workspaceId, row);

        await query(
          `UPDATE intervention_log
           SET follow_up_sent = true, follow_up_sent_at = NOW()
           WHERE id = $1`,
          [row.id]
        );

        sent++;
      } catch (err: any) {
        console.warn(`[crumb-followup] Failed for intervention ${row.id}:`, err.message);
      }
    }
  } catch (err: any) {
    console.warn('[crumb-followup] Query failed (non-fatal):', err.message);
  }

  return sent;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

async function sendFollowUpMessage(workspaceId: string, row: DueFollowUpRow): Promise<void> {
  const meta = row.metadata ?? {};
  const weeklyValues: Array<{ weekOf: string; value: number }> = row.weekly_values ?? [];
  const recentValues = weeklyValues.slice(-6);

  const hasMetricData = row.metric && row.alert_threshold && recentValues.length > 0;

  // Build synthesis prompt
  const prompt = hasMetricData
    ? `6 weeks ago, a user responded to a recommendation with: "${meta.userMessage ?? '(no message recorded)'}"

This was linked to the hypothesis: "${row.hypothesis ?? '(unknown hypothesis)'}"
Tracking metric: ${row.metric}
Alert threshold: ${row.alert_threshold} (${row.alert_direction})

Metric values over the past 6 weeks:
${recentValues.map(v => `  ${v.weekOf}: ${v.value}`).join('\n')}

In 2-3 sentences: describe what happened to the metric since the user said they'd work on it. Did it move in the right direction? By how much? Is the hypothesis resolved, still active, or getting worse? Be specific and factual. Do not use praise language or say "great job".`
    : `6 weeks ago, a user responded to a Concierge recommendation with: "${meta.userMessage ?? '(no message recorded)'}"

The recommendation was: "${row.description}"

In 1-2 sentences: acknowledge that 6 weeks have passed and invite the user to share how things are progressing, since no metric data is currently linked to this intervention.`;

  let synthesis = '';
  try {
    const llmResult = await callLLM(workspaceId, 'generate', {
      systemPrompt: PANDORA_VOICE_STANDARD,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 200,
      temperature: 0.3,
      metadata: { sourceContext: 'crumb_trail_followup' },
    });
    synthesis = llmResult.content.trim();
  } catch (err: any) {
    console.warn('[crumb-followup] LLM synthesis failed, using fallback:', err.message);
    synthesis = hasMetricData
      ? `No synthesis available — check ${row.metric} manually.`
      : 'No synthesis available — check in with your team on this recommendation.';
  }

  // Determine hypothesis health label
  let hypothesisStatus = '';
  if (row.metric && row.current_value && row.alert_threshold && row.alert_direction) {
    const current = parseFloat(row.current_value);
    const threshold = parseFloat(row.alert_threshold);
    const healthy =
      row.alert_direction === 'below'
        ? current >= threshold
        : current <= threshold;
    hypothesisStatus = healthy ? 'healthy' : 'still at risk';
  }

  const recommendationSnippet = (meta.recommendationText ?? row.description ?? '').slice(0, 120);
  const messageText = [
    `📊 *6-week check-in*`,
    ``,
    `You mentioned working on: _"${recommendationSnippet}${recommendationSnippet.length >= 120 ? '...' : ''}"_`,
    ``,
    synthesis,
    hypothesisStatus ? `\nStanding hypothesis status: *${hypothesisStatus}*` : '',
  ].filter(Boolean).join('\n');

  // Post to Slack if channel is configured
  const channelResult = await query<{ channel_id: string }>(
    `SELECT channel_id
     FROM slack_channel_config
     WHERE workspace_id = $1
       AND (is_default = true OR true)
     ORDER BY is_default DESC, created_at ASC
     LIMIT 1`,
    [workspaceId]
  ).catch(() => ({ rows: [] as any[] }));

  if (channelResult.rows.length === 0) {
    console.log(`[crumb-followup] No Slack channel for workspace ${workspaceId} — skipping Slack post`);
    return;
  }

  const channelId = channelResult.rows[0].channel_id;
  const slackClient = getSlackAppClient();
  const botToken = await slackClient.getBotToken(workspaceId).catch(() => null);

  if (!botToken) {
    console.log(`[crumb-followup] No bot token for workspace ${workspaceId} — skipping Slack post`);
    return;
  }

  await slackPost(
    'chat.postMessage',
    {
      channel: channelId,
      text: messageText,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: messageText },
        },
      ],
    },
    botToken
  );

  console.log(`[crumb-followup] Follow-up sent for intervention ${row.id} (workspace ${workspaceId})`);
}
