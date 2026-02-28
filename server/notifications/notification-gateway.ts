import { query } from '../db.js';
import { getNotificationPreferences, getCategoryRule, type NotificationPreferences } from './preferences.js';
import { NOTIFICATION_CATEGORIES } from './categories.js';
import {
  postBlocks,
  postText,
  getSlackWebhook,
  type SlackBlock,
} from '../connectors/slack/client.js';
import { getSlackAppClient } from '../connectors/slack/slack-app-client.js';

export interface NotificationPayload {
  workspace_id: string;
  category: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  body: string;
  metadata?: {
    skill_id?: string;
    skill_run_id?: string;
    entity_type?: string;
    entity_id?: string;
    entity_name?: string;
    score_change?: number;
    score_tier?: string;
    deal_amount?: number;
    [key: string]: any;
  };
  slack_blocks?: SlackBlock[];
  slack_text?: string;
  use_bot?: boolean;
  target_channel?: string;
  bot_metadata?: Record<string, any>;
}

export interface SendResult {
  status: 'sent' | 'queued' | 'suppressed' | 'failed';
  reason?: string;
  slack_message_ts?: string;
  slack_channel_id?: string;
}

export async function sendNotification(payload: NotificationPayload): Promise<SendResult> {
  try {
    const prefs = await getNotificationPreferences(payload.workspace_id);

    if (!prefs.enabled) {
      return { status: 'suppressed', reason: 'notifications_disabled' };
    }

    if (isQuietHours(prefs)) {
      await queueNotification(payload, computeDeliverAfter(prefs));
      return { status: 'queued', reason: 'quiet_hours' };
    }

    const rule = getCategoryRule(prefs, payload.category);

    if (!rule.enabled) {
      return { status: 'suppressed', reason: 'category_disabled' };
    }

    if (!passesThresholds(payload, rule)) {
      return { status: 'suppressed', reason: 'below_threshold' };
    }

    const deliveryMode = rule.delivery;

    if (deliveryMode === 'digest') {
      await queueNotification(payload);
      return { status: 'queued', reason: 'digest_mode' };
    }

    if (deliveryMode === 'smart') {
      if (payload.severity === 'critical') {
        return await dispatchToSlack(payload, prefs);
      }
      await queueNotification(payload);
      return { status: 'queued', reason: 'smart_mode_non_critical' };
    }

    return await dispatchToSlack(payload, prefs);
  } catch (err) {
    console.error('[NotificationGateway] Error:', err instanceof Error ? err.message : err);
    return { status: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}

function isQuietHours(prefs: NotificationPreferences): boolean {
  if (!prefs.quiet_hours.enabled) return false;

  try {
    const tz = prefs.quiet_hours.timezone || 'UTC';
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
    const currentMinutes = hour * 60 + minute;

    const [startH, startM] = prefs.quiet_hours.start.split(':').map(Number);
    const [endH, endM] = prefs.quiet_hours.end.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  } catch {
    return false;
  }
}

function computeDeliverAfter(prefs: NotificationPreferences): Date {
  const tz = prefs.quiet_hours.timezone || 'UTC';
  const [endH, endM] = prefs.quiet_hours.end.split(':').map(Number);
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const target = new Date(tomorrow.toLocaleDateString('en-CA', { timeZone: tz }) + `T${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00`);
  return target;
}

function passesThresholds(
  payload: NotificationPayload,
  rule: ReturnType<typeof getCategoryRule>
): boolean {
  if (rule.min_severity) {
    const severityRank: Record<string, number> = { info: 0, warning: 1, critical: 2 };
    if ((severityRank[payload.severity] ?? 0) < (severityRank[rule.min_severity] ?? 0)) {
      return false;
    }
  }

  if (rule.min_score_change !== undefined && payload.metadata?.score_change !== undefined) {
    if (Math.abs(payload.metadata.score_change) < rule.min_score_change) {
      return false;
    }
  }

  if (rule.min_score_tier && payload.metadata?.score_tier) {
    const tierRank: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };
    if ((tierRank[payload.metadata.score_tier] ?? 0) < (tierRank[rule.min_score_tier] ?? 0)) {
      return false;
    }
  }

  return true;
}

async function queueNotification(
  payload: NotificationPayload,
  deliverAfter?: Date
): Promise<void> {
  await query(
    `INSERT INTO notification_queue (workspace_id, category, severity, title, body, metadata, slack_blocks, deliver_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      payload.workspace_id,
      payload.category,
      payload.severity,
      payload.title,
      payload.body,
      JSON.stringify(payload.metadata || {}),
      payload.slack_blocks ? JSON.stringify(payload.slack_blocks) : null,
      deliverAfter || null,
    ]
  );
}

async function dispatchToSlack(
  payload: NotificationPayload,
  prefs: NotificationPreferences
): Promise<SendResult> {
  const workspaceId = payload.workspace_id;

  if (payload.use_bot && payload.target_channel) {
    try {
      const slackApp = getSlackAppClient();
      const botToken = await slackApp.getBotToken(workspaceId);
      if (botToken) {
        const blocks = payload.slack_blocks || buildDefaultBlocks(payload);
        const msgRef = await slackApp.postMessage(
          workspaceId,
          payload.target_channel,
          blocks,
          payload.bot_metadata ? { metadata: payload.bot_metadata } as any : undefined
        );
        if (msgRef.ok) {
          return {
            status: 'sent',
            slack_message_ts: msgRef.ts,
            slack_channel_id: msgRef.channel,
          };
        }
      }
    } catch (err) {
      console.warn('[NotificationGateway] Bot send failed, falling back to webhook:', err instanceof Error ? err.message : err);
    }
  }

  const webhookUrl = await getSlackWebhook(workspaceId);
  if (!webhookUrl) {
    return { status: 'failed', reason: 'no_slack_webhook' };
  }

  if (payload.slack_blocks) {
    const result = await postBlocks(webhookUrl, payload.slack_blocks);
    return result.ok ? { status: 'sent' } : { status: 'failed', reason: result.error };
  }

  if (payload.slack_text) {
    const result = await postText(webhookUrl, payload.slack_text);
    return result.ok ? { status: 'sent' } : { status: 'failed', reason: result.error };
  }

  const blocks = buildDefaultBlocks(payload);
  const result = await postBlocks(webhookUrl, blocks);
  return result.ok ? { status: 'sent' } : { status: 'failed', reason: result.error };
}

function buildDefaultBlocks(payload: NotificationPayload): SlackBlock[] {
  const severityEmoji: Record<string, string> = {
    critical: '\u{1F534}',
    warning: '\u{1F7E1}',
    info: '\u{1F535}',
  };
  const emoji = severityEmoji[payload.severity] || '\u25FE';

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *${payload.title}*\n${payload.body}`,
      },
    },
  ];
}

export { queueNotification, isQuietHours, passesThresholds };
