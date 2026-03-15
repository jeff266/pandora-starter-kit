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

  // ── Assemble brief ────────────────────────────────────────────────────────
  const blocks = await assembleConciergeSlackMessage(workspaceId, userId);
  if (!blocks) {
    console.log(`[concierge-push] Brief assembly returned null for workspace ${workspaceId} — skipping`);
    return;
  }

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
    console.log(`[concierge-push] Concierge brief sent to ${workspaceName} (channel: ${channelId}, ts: ${result.ts})`);
  } else {
    console.error(`[concierge-push] Failed to post to ${workspaceName}: ${result.error ?? 'unknown error'}`);
  }
}
