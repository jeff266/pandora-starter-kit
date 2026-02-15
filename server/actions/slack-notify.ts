/**
 * Slack Notification for Actions
 *
 * Sends action cards to Slack as Block Kit messages.
 * Supports posting to workspace channel or DM to rep (if bot token available).
 */

import type { Pool } from 'pg';

export async function notifyActionViaSlack(
  db: Pool,
  workspaceId: string,
  action: any,
  target: 'channel' | 'rep' | string
): Promise<{ delivered: boolean; error?: string }> {

  // Get workspace Slack config
  const wsResult = await db.query(
    `SELECT slack_webhook_url, slack_bot_token FROM workspaces WHERE id = $1`,
    [workspaceId]
  );

  const workspace = wsResult.rows[0];
  if (!workspace) return { delivered: false, error: 'Workspace not found' };

  const blocks = buildActionSlackBlocks(action);

  // Try channel webhook first (most reliable)
  const webhookUrl = workspace.slack_webhook_url;
  if (!webhookUrl) {
    return { delivered: false, error: 'No Slack webhook configured' };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { delivered: false, error: `Slack API error: ${response.status} ${text}` };
    }

    return { delivered: true };
  } catch (err) {
    return { delivered: false, error: (err as Error).message };
  }
}

function buildActionSlackBlocks(action: any): any[] {
  const severityEmoji: Record<string, string> = {
    critical: '🔴',
    warning: '🟡',
    info: '🔵',
  };

  const blocks: any[] = [];

  // Header
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `${severityEmoji[action.severity] || '⚪'} *${action.title}*`,
    },
  });

  // Summary + target
  let contextParts: string[] = [];
  if (action.target_entity_name) contextParts.push(`*${action.target_entity_name}*`);
  if (action.impact_amount) contextParts.push(`$${Number(action.impact_amount).toLocaleString()} at risk`);
  if (action.urgency_label) contextParts.push(action.urgency_label);
  if (action.owner_email) contextParts.push(`Owner: ${action.owner_email}`);

  if (contextParts.length > 0) {
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: contextParts.join('  •  '),
      }],
    });
  }

  // Summary text
  if (action.summary) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: action.summary,
      },
    });
  }

  // Recommended steps
  if (action.recommended_steps && action.recommended_steps.length > 0) {
    const steps = action.recommended_steps
      .map((s: string, i: number) => `${i + 1}. ${s}`)
      .join('\n');
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Recommended:*\n${steps}`,
      },
    });
  }

  // Action buttons
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '✅ Mark In Progress' },
        action_id: `action_in_progress_${action.id}`,
        style: 'primary',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '👁️ View in Pandora' },
        action_id: `action_view_${action.id}`,
        url: `${process.env.APP_URL || ''}/action-items/${action.id}`,
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '🚫 Dismiss' },
        action_id: `action_dismiss_${action.id}`,
      },
    ],
  });

  blocks.push({ type: 'divider' });

  return blocks;
}

/**
 * Batch notify: send all critical open actions as a digest to workspace channel.
 * Called by agent delivery or scheduler.
 */
export async function sendActionDigest(
  db: Pool,
  workspaceId: string,
  options?: { severity?: string; limit?: number }
): Promise<{ delivered: boolean; action_count: number; error?: string }> {
  const severity = options?.severity || 'critical';
  const limit = options?.limit || 10;

  const result = await db.query(`
    SELECT * FROM actions
    WHERE workspace_id = $1
      AND execution_status = 'open'
      AND severity = $2
    ORDER BY impact_amount DESC NULLS LAST
    LIMIT $3
  `, [workspaceId, severity, limit]);

  if (result.rows.length === 0) {
    return { delivered: true, action_count: 0 };
  }

  // Build digest blocks
  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `⚡ ${result.rows.length} ${severity} actions need attention`,
      },
    },
  ];

  for (const action of result.rows) {
    blocks.push(...buildActionSlackBlocks(action));
  }

  // Send via webhook
  const wsResult = await db.query(
    `SELECT slack_webhook_url FROM workspaces WHERE id = $1`,
    [workspaceId]
  );
  const webhookUrl = wsResult.rows[0]?.slack_webhook_url;
  if (!webhookUrl) {
    return { delivered: false, action_count: result.rows.length, error: 'No Slack webhook' };
  }

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
    });
    return { delivered: true, action_count: result.rows.length };
  } catch (err) {
    return { delivered: false, action_count: result.rows.length, error: (err as Error).message };
  }
}
