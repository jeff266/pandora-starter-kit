/**
 * Concierge Daily Slack Push
 *
 * Assembles and sends the morning Concierge brief to a workspace's
 * configured Slack channel. Called by the 8:15 AM UTC cron job and
 * by the manual POST /api/workspaces/:id/briefing/send-slack endpoint.
 *
 * Never throws — all errors are logged and the function returns early.
 */

import { query } from '../db.js';
import { assembleOpeningBrief } from '../context/opening-brief.js';
import {
  formatConciergeDaily,
  validateSlackOutput,
  extractTextFromBlocks,
} from '../skills/formatters/slack-formatter.js';
import { getSlackAppClient } from '../connectors/slack/slack-app-client.js';
import { trackPandoraPost } from './thread-tracker.js';
import { sendCrumbTrailFollowUps } from '../concierge/crumb-trail-followup.js';

// ─────────────────────────────────────────────────────────────────────────────
// PART 0 — Standing Hypothesis Monitor
// ─────────────────────────────────────────────────────────────────────────────

interface TrippedHypothesis {
  id: string;
  hypothesis: string;
  metric: string;
  currentValue: number | null;
  alertThreshold: number;
  alertDirection: 'below' | 'above';
  reviewDate: string | null;
}

/**
 * Queries active standing hypotheses and returns any whose current_value
 * has crossed the alert_threshold. Also stamps the weekly_values JSONB
 * array with today's value so the trend accumulates over time.
 *
 * Non-fatal — always resolves. Returns [] on any DB error.
 */
async function checkStandingHypotheses(workspaceId: string): Promise<TrippedHypothesis[]> {
  try {
    const result = await query<{
      id: string;
      hypothesis: string;
      metric: string;
      current_value: string | null;
      alert_threshold: string;
      alert_direction: string;
      review_date: string | null;
    }>(
      `SELECT id, hypothesis, metric, current_value, alert_threshold, alert_direction, review_date
       FROM standing_hypotheses
       WHERE workspace_id = $1
         AND status = 'active'
       ORDER BY created_at DESC`,
      [workspaceId]
    );

    if (result.rows.length === 0) return [];

    const today = new Date().toISOString().split('T')[0];
    const tripped: TrippedHypothesis[] = [];

    for (const row of result.rows) {
      const currentValue = row.current_value != null ? parseFloat(row.current_value) : null;
      const threshold = parseFloat(row.alert_threshold);
      const direction = row.alert_direction as 'below' | 'above';

      // Stamp weekly value if current_value is known
      if (currentValue != null) {
        await query(
          `UPDATE standing_hypotheses
           SET weekly_values = weekly_values || $1::jsonb,
               updated_at = now()
           WHERE id = $2`,
          [JSON.stringify({ weekOf: today, value: currentValue }), row.id]
        ).catch(err => console.warn('[hypothesis-monitor] weekly_values update failed:', err.message));
      }

      // Threshold check
      const crossed =
        currentValue != null &&
        ((direction === 'below' && currentValue < threshold) ||
         (direction === 'above' && currentValue > threshold));

      if (crossed) {
        tripped.push({
          id: row.id,
          hypothesis: row.hypothesis,
          metric: row.metric,
          currentValue,
          alertThreshold: threshold,
          alertDirection: direction,
          reviewDate: row.review_date,
        });
      }
    }

    if (tripped.length > 0) {
      console.log(`[hypothesis-monitor] ${tripped.length} threshold(s) crossed for workspace ${workspaceId}`);
    }

    return tripped;
  } catch (err: any) {
    console.warn(`[hypothesis-monitor] check failed for workspace ${workspaceId} (non-fatal):`, err.message);
    return [];
  }
}

/**
 * Formats tripped hypotheses into Slack Block Kit blocks to prepend
 * to the Concierge brief. Returns [] if no hypotheses are tripped.
 */
function formatHypothesisAlertBlocks(alerts: TrippedHypothesis[]): Array<Record<string, any>> {
  if (alerts.length === 0) return [];

  const blocks: Array<Record<string, any>> = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `⚠️ *Standing Hypothesis Alert${alerts.length > 1 ? 's' : ''}* — ${alerts.length} threshold${alerts.length > 1 ? 's' : ''} crossed`,
      },
    },
  ];

  for (const alert of alerts) {
    const dirLabel = alert.alertDirection === 'below' ? 'fell below' : 'rose above';
    const valueStr = alert.currentValue != null ? String(Math.round(alert.currentValue * 100) / 100) : 'unknown';
    const thresholdStr = String(Math.round(alert.alertThreshold * 100) / 100);

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${alert.hypothesis}*\n_${alert.metric}_ ${dirLabel} ${thresholdStr} (current: ${valueStr})`,
      },
    });
  }

  blocks.push({ type: 'divider' });

  return blocks;
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 1 — assembleConciergeSlackMessage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assembles the morning brief and formats it into Slack Block Kit.
 * Returns null if brief assembly fails or validation rejects the output.
 */
export async function assembleConciergeSlackMessage(
  workspaceId: string,
  userId: string
): Promise<Array<Record<string, any>> | null> {
  let brief: Awaited<ReturnType<typeof assembleOpeningBrief>>;

  try {
    brief = await assembleOpeningBrief(workspaceId, userId);
  } catch (err) {
    console.error(`[concierge-push] assembleConciergeSlackMessage: brief assembly failed for workspace ${workspaceId}:`, err);
    return null;
  }

  if (!brief) {
    console.error(`[concierge-push] assembleConciergeSlackMessage: brief returned null for workspace ${workspaceId}`);
    return null;
  }

  // ── Temporal context label ────────────────────────────────────────────────
  const t = brief.temporal;
  const temporalContext = [
    t.dayOfWeek,
    `${t.fiscalQuarter} ${t.fiscalYear}`,
    `Week ${t.weekOfQuarter}`,
    t.daysRemainingInQuarter > 0 ? `${t.daysRemainingInQuarter} days left` : 'Final day of quarter',
  ].join(' · ');

  // ── Target label ─────────────────────────────────────────────────────────
  const targetLabel = brief.targets.headline?.label ?? 'No target set';

  // ── Situation sentence ────────────────────────────────────────────────────
  // Derived from pipelineMovement or top findings — no 'synthesis' field on OpeningBriefData
  const situationSentence =
    brief.pipelineMovement?.primaryConcern ??
    brief.pipelineMovement?.headline ??
    brief.findings.topFindings[0]?.message ??
    '';

  // ── Overnight skill count ─────────────────────────────────────────────────
  let overnightSkillCount = 0;
  try {
    const skillResult = await query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt
       FROM skill_runs
       WHERE workspace_id = $1
         AND status = 'completed'
         AND completed_at > now() - interval '24 hours'`,
      [workspaceId]
    );
    overnightSkillCount = parseInt(skillResult.rows[0]?.cnt ?? '0', 10);
  } catch {
    // Non-fatal — leave at 0
  }

  // ── Concierge URL ─────────────────────────────────────────────────────────
  const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '');
  const conciergeUrl = appUrl
    ? `${appUrl}/workspaces/${workspaceId}/concierge`
    : `https://pandora.replit.app/workspaces/${workspaceId}/concierge`;

  // ── Build formatConciergeDaily input ─────────────────────────────────────
  const input = {
    workspaceName: brief.workspace.name,
    userName: brief.user.name,
    temporalContext,
    attainmentPct: Math.round(brief.targets.pctAttained ?? 0),
    targetLabel,
    priorityFrameLabel: brief.priorityFrame?.frameLabel ?? 'Pipeline update',
    situationSentence,
    bigDealsAtRisk: (brief.bigDealsAtRisk ?? []).slice(0, 5).map(d => ({
      name: d.name,
      amount: d.amount,
      daysSinceActivity: d.daysSinceActivity,
      isDormant: d.daysSinceActivity > 120,
    })),
    overnightSkillCount,
    pendingActionCount: 0,
    conciergeUrl,
  };

  const blocks = formatConciergeDaily(input);

  // ── Validate output ───────────────────────────────────────────────────────
  const text = extractTextFromBlocks(blocks);
  const validation = validateSlackOutput(text, blocks);
  if (!validation.valid) {
    console.error(
      `[concierge-push] validateSlackOutput failed for workspace ${workspaceId}:`,
      validation.errors
    );
    return null;
  }

  return blocks;
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 2 — sendConciergeSlackBrief
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends the morning Concierge brief to the workspace's default Slack channel.
 * Checks standing hypothesis thresholds and prepends any alerts to the brief.
 * Silently skips if Slack is not configured for the workspace.
 */
export async function sendConciergeSlackBrief(workspaceId: string): Promise<void> {
  // ── Resolve Slack channel ─────────────────────────────────────────────────
  const channelResult = await query<{ channel_id: string; workspace_id: string }>(
    `SELECT channel_id, workspace_id
     FROM slack_channel_config
     WHERE workspace_id = $1
       AND (is_default = true OR true)
     ORDER BY is_default DESC, created_at ASC
     LIMIT 1`,
    [workspaceId]
  ).catch(err => {
    console.error(`[concierge-push] Channel lookup failed for workspace ${workspaceId}:`, err);
    return { rows: [] as any[] };
  });

  if (channelResult.rows.length === 0) {
    console.log(`[concierge-push] Workspace ${workspaceId} has no Slack channel configured — skipping`);
    return;
  }

  const channelId = channelResult.rows[0].channel_id;

  // ── Resolve bot token ─────────────────────────────────────────────────────
  const slackClient = getSlackAppClient();
  const botToken = await slackClient.getBotToken(workspaceId).catch(() => null);

  if (!botToken) {
    console.log(`[concierge-push] Workspace ${workspaceId} has no Slack bot token configured — skipping`);
    return;
  }

  // ── Resolve admin user ────────────────────────────────────────────────────
  const adminResult = await query<{ user_id: string }>(
    `SELECT user_id
     FROM workspace_members
     WHERE workspace_id = $1
       AND pandora_role = 'admin'
       AND status = 'active'
     ORDER BY accepted_at ASC NULLS LAST
     LIMIT 1`,
    [workspaceId]
  ).catch(err => {
    console.error(`[concierge-push] Admin user lookup failed for workspace ${workspaceId}:`, err);
    return { rows: [] as any[] };
  });

  if (adminResult.rows.length === 0) {
    console.log(`[concierge-push] Workspace ${workspaceId} has no admin user — skipping`);
    return;
  }

  const userId = adminResult.rows[0].user_id;

  // ── Check standing hypothesis thresholds ──────────────────────────────────
  const trippedHypotheses = await checkStandingHypotheses(workspaceId);
  const alertBlocks = formatHypothesisAlertBlocks(trippedHypotheses);

  // ── Send crumb trail follow-ups (6-week check-ins) ────────────────────────
  const followUpsSent = await sendCrumbTrailFollowUps(workspaceId);
  if (followUpsSent > 0) {
    console.log(`[concierge-push] Sent ${followUpsSent} crumb trail follow-up(s) for workspace ${workspaceId}`);
  }

  // ── Assemble brief ────────────────────────────────────────────────────────
  const briefBlocks = await assembleConciergeSlackMessage(workspaceId, userId);
  if (!briefBlocks) {
    console.log(`[concierge-push] Brief assembly returned null for workspace ${workspaceId} — skipping`);
    return;
  }

  // Prepend hypothesis alerts before the brief (if any thresholds tripped)
  const blocks = alertBlocks.length > 0
    ? [...alertBlocks, ...briefBlocks]
    : briefBlocks;

  // ── Post to Slack ─────────────────────────────────────────────────────────
  const { slackPost } = await import('./thread-tracker.js');
  const result = await slackPost('chat.postMessage', {
    channel: channelId,
    blocks,
    text: 'Pandora morning brief',
  }, botToken);

  // ── Get workspace name for logging ────────────────────────────────────────
  const wsRow = await query<{ name: string }>(
    `SELECT name FROM workspaces WHERE id = $1`,
    [workspaceId]
  ).catch(() => ({ rows: [] as any[] }));
  const workspaceName = wsRow.rows[0]?.name ?? workspaceId;

  if (result.ok && result.ts) {
    trackPandoraPost(channelId, result.ts, workspaceId);
    console.log(`[concierge-push] Concierge brief sent to ${workspaceName} (channel: ${channelId}, ts: ${result.ts})${trippedHypotheses.length > 0 ? ` — ${trippedHypotheses.length} hypothesis alert(s) prepended` : ''}`);
  } else {
    console.error(`[concierge-push] Failed to post to ${workspaceName}: ${result.error ?? 'unknown error'}`);
  }
}
