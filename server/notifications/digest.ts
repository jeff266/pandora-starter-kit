import { query } from '../db.js';
import { getNotificationPreferences, type NotificationPreferences } from './preferences.js';
import { NOTIFICATION_CATEGORIES } from './categories.js';
import { postBlocks, getSlackWebhook, type SlackBlock } from '../connectors/slack/client.js';

interface QueuedNotification {
  id: string;
  workspace_id: string;
  category: string;
  severity: string;
  title: string;
  body: string;
  metadata: any;
  slack_blocks: any;
  queued_at: string;
}

export async function flushDigests(): Promise<void> {
  const workspaces = await query<{ workspace_id: string }>(
    `SELECT DISTINCT workspace_id
     FROM notification_queue
     WHERE delivered_at IS NULL
     AND (deliver_after IS NULL OR deliver_after <= now())`
  );

  for (const ws of workspaces.rows) {
    try {
      const prefs = await getNotificationPreferences(ws.workspace_id);
      if (!prefs.enabled) continue;

      const pending = await query<QueuedNotification>(
        `SELECT * FROM notification_queue
         WHERE workspace_id = $1 AND delivered_at IS NULL
         AND (deliver_after IS NULL OR deliver_after <= now())
         ORDER BY
           CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
           queued_at ASC`,
        [ws.workspace_id]
      );

      if (pending.rows.length === 0) continue;

      const filtered = applyPerRunCaps(pending.rows, prefs);
      const digestBlocks = buildDigestBlocks(filtered, prefs);

      const webhookUrl = await getSlackWebhook(ws.workspace_id);
      if (webhookUrl) {
        await postBlocks(webhookUrl, digestBlocks);
      }

      const ids = pending.rows.map(r => r.id);
      const digestId = `digest_${Date.now()}`;
      await query(
        `UPDATE notification_queue
         SET delivered_at = now(), digest_id = $2
         WHERE id = ANY($1::uuid[])`,
        [ids, digestId]
      );

      console.log(`[DigestFlush] Delivered ${filtered.length} notifications (${pending.rows.length} total) for workspace ${ws.workspace_id}`);
    } catch (err) {
      console.error(`[DigestFlush] Error for workspace ${ws.workspace_id}:`, err instanceof Error ? err.message : err);
    }
  }
}

function applyPerRunCaps(
  notifications: QueuedNotification[],
  prefs: NotificationPreferences
): QueuedNotification[] {
  const grouped = new Map<string, QueuedNotification[]>();
  for (const n of notifications) {
    if (!grouped.has(n.category)) grouped.set(n.category, []);
    grouped.get(n.category)!.push(n);
  }

  const result: QueuedNotification[] = [];
  for (const [category, items] of grouped) {
    const rule = prefs.category_rules[category];
    const def = NOTIFICATION_CATEGORIES[category];
    const maxPerRun = rule?.max_per_run ?? def?.default_max_per_run;

    if (maxPerRun && items.length > maxPerRun) {
      result.push(...items.slice(0, maxPerRun));
    } else {
      result.push(...items);
    }
  }

  return result;
}

function buildDigestBlocks(
  notifications: QueuedNotification[],
  prefs: NotificationPreferences
): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: 'Pandora Digest' },
  });

  const tz = prefs.digest_schedule?.timezone || 'America/New_York';
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `${notifications.length} updates \u00B7 ${new Date().toLocaleString('en-US', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' })}`,
    }],
  });

  blocks.push({ type: 'divider' });

  const grouped = new Map<string, QueuedNotification[]>();
  for (const n of notifications) {
    if (!grouped.has(n.category)) grouped.set(n.category, []);
    grouped.get(n.category)!.push(n);
  }

  const severityEmoji: Record<string, string> = {
    critical: '\u{1F534}',
    warning: '\u{1F7E1}',
    info: '\u{1F535}',
  };

  for (const [category, items] of grouped) {
    const def = NOTIFICATION_CATEGORIES[category];
    const label = def?.label || category;

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${label}* (${items.length})`,
      },
    });

    const itemLines = items.slice(0, 10).map(item => {
      const emoji = severityEmoji[item.severity] || '\u25FE';
      return `${emoji} ${item.title}`;
    });

    if (items.length > 10) {
      itemLines.push(`_...and ${items.length - 10} more_`);
    }

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: itemLines.join('\n'),
      },
    });
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: 'View in Pandora \u00B7 Manage notification preferences in Settings',
    }],
  });

  return blocks;
}

export async function getQueueStatus(workspaceId: string): Promise<{ category: string; severity: string; count: number }[]> {
  const result = await query<{ category: string; severity: string; count: string }>(
    `SELECT category, severity, COUNT(*)::text as count
     FROM notification_queue
     WHERE workspace_id = $1 AND delivered_at IS NULL
     GROUP BY category, severity
     ORDER BY severity, category`,
    [workspaceId]
  );
  return result.rows.map(r => ({ ...r, count: parseInt(r.count) }));
}

export function isDueForDigest(prefs: NotificationPreferences): boolean {
  if (prefs.delivery_mode !== 'digest' && prefs.delivery_mode !== 'smart') {
    const hasCategoryDigest = Object.values(prefs.category_rules).some(
      r => r.delivery === 'digest'
    );
    if (!hasCategoryDigest) return false;
  }

  const tz = prefs.digest_schedule?.timezone || 'UTC';
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
  const currentTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  const times = prefs.digest_schedule?.times || ['08:00'];
  for (const time of times) {
    const [th, tm] = time.split(':').map(Number);
    const targetTime = `${String(th).padStart(2, '0')}:${String(tm).padStart(2, '0')}`;
    const diffMinutes = Math.abs(
      (hour * 60 + minute) - (th * 60 + tm)
    );
    if (diffMinutes <= 15) return true;
  }

  return false;
}
