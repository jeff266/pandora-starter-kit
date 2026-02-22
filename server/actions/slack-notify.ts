/**
 * Slack Notification for Actions
 *
 * Sends action cards to Slack as Block Kit messages via the notification gateway.
 * Supports posting to workspace channel or DM to rep (if bot token available).
 */

import type { Pool } from 'pg';
import { sendNotification } from '../notifications/notification-gateway.js';

export async function notifyActionViaSlack(
  db: Pool,
  workspaceId: string,
  action: any,
  target: 'channel' | 'rep' | string
): Promise<{ delivered: boolean; error?: string }> {
  const blocks = buildActionSlackBlocks(action);

  try {
    const result = await sendNotification({
      workspace_id: workspaceId,
      category: 'action_created',
      severity: action.severity || 'info',
      title: action.title || 'New Action',
      body: action.summary || '',
      metadata: {
        entity_type: action.target_entity_type,
        entity_id: action.target_entity_id,
        entity_name: action.target_entity_name,
        deal_amount: action.impact_amount ? Number(action.impact_amount) : undefined,
      },
      slack_blocks: blocks,
    });

    return {
      delivered: result.status === 'sent',
      error: result.status === 'failed' ? result.reason : undefined,
    };
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

  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `\u26A1 ${result.rows.length} ${severity} actions need attention`,
      },
    },
  ];

  for (const action of result.rows) {
    blocks.push(...buildActionSlackBlocks(action));
  }

  try {
    const sendResult = await sendNotification({
      workspace_id: workspaceId,
      category: 'action_created',
      severity: (severity as 'critical' | 'warning' | 'info') || 'critical',
      title: `${result.rows.length} ${severity} actions need attention`,
      body: `${result.rows.length} open ${severity} actions require your attention`,
      slack_blocks: blocks,
    });

    return {
      delivered: sendResult.status === 'sent',
      action_count: result.rows.length,
      error: sendResult.status === 'failed' ? sendResult.reason : undefined,
    };
  } catch (err) {
    return { delivered: false, action_count: result.rows.length, error: (err as Error).message };
  }
}
