import { query } from '../db.js';
import { NOTIFICATION_CATEGORIES } from './categories.js';

export interface CategoryRule {
  enabled: boolean;
  delivery: 'realtime' | 'digest' | 'inherit';
  min_severity?: 'critical' | 'warning' | 'info';
  min_score_change?: number;
  min_score_tier?: string;
  max_per_run?: number;
}

export interface NotificationPreferences {
  enabled: boolean;
  quiet_hours: {
    enabled: boolean;
    start: string;
    end: string;
    timezone: string;
  };
  delivery_mode: 'realtime' | 'digest' | 'smart';
  digest_schedule: {
    frequency: 'daily' | 'twice_daily';
    times: string[];
    timezone: string;
  };
  category_rules: Record<string, CategoryRule>;
  default_channel: string;
  channel_overrides: Record<string, string>;
  _paused_until?: string;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled: true,
  quiet_hours: {
    enabled: false,
    start: '22:00',
    end: '07:00',
    timezone: 'America/New_York',
  },
  delivery_mode: 'realtime',
  digest_schedule: {
    frequency: 'daily',
    times: ['08:00'],
    timezone: 'America/New_York',
  },
  category_rules: {},
  default_channel: '',
  channel_overrides: {},
};

export function getDefaultPreferences(): NotificationPreferences {
  return JSON.parse(JSON.stringify(DEFAULT_PREFERENCES));
}

export async function getNotificationPreferences(workspaceId: string): Promise<NotificationPreferences> {
  const result = await query<{ settings: any }>(
    `SELECT settings FROM workspaces WHERE id = $1`,
    [workspaceId]
  );

  const settings = result.rows[0]?.settings || {};
  const stored = settings.notification_preferences || {};

  const prefs = getDefaultPreferences();
  if (typeof stored.enabled === 'boolean') prefs.enabled = stored.enabled;
  if (stored.quiet_hours) prefs.quiet_hours = { ...prefs.quiet_hours, ...stored.quiet_hours };
  if (stored.delivery_mode) prefs.delivery_mode = stored.delivery_mode;
  if (stored.digest_schedule) prefs.digest_schedule = { ...prefs.digest_schedule, ...stored.digest_schedule };
  if (stored.category_rules) prefs.category_rules = stored.category_rules;
  if (stored.default_channel) prefs.default_channel = stored.default_channel;
  if (stored.channel_overrides) prefs.channel_overrides = stored.channel_overrides;
  if (stored._paused_until) prefs._paused_until = stored._paused_until;

  if (prefs._paused_until && new Date(prefs._paused_until) <= new Date()) {
    prefs.enabled = true;
    delete prefs._paused_until;
    await saveNotificationPreferences(workspaceId, prefs);
  }

  return prefs;
}

export async function saveNotificationPreferences(
  workspaceId: string,
  prefs: Partial<NotificationPreferences>
): Promise<void> {
  await query(
    `UPDATE workspaces
     SET settings = jsonb_set(
       COALESCE(settings, '{}'::jsonb),
       '{notification_preferences}',
       $2::jsonb
     ),
     updated_at = NOW()
     WHERE id = $1`,
    [workspaceId, JSON.stringify(prefs)]
  );
}

export function getCategoryRule(
  prefs: NotificationPreferences,
  category: string
): { enabled: boolean; delivery: 'realtime' | 'digest' | 'smart'; min_severity?: string; min_score_change?: number; min_score_tier?: string; max_per_run?: number } {
  const rule = prefs.category_rules[category];
  const def = NOTIFICATION_CATEGORIES[category];

  const enabled = rule?.enabled ?? def?.default_enabled ?? true;
  const delivery = (rule?.delivery === 'inherit' || !rule?.delivery)
    ? (def?.default_delivery || prefs.delivery_mode)
    : rule.delivery as any;

  return {
    enabled,
    delivery: delivery === 'smart' || delivery === 'digest' || delivery === 'realtime' ? delivery : prefs.delivery_mode,
    min_severity: rule?.min_severity || def?.default_min_severity,
    min_score_change: rule?.min_score_change ?? def?.default_min_score_change,
    min_score_tier: rule?.min_score_tier ?? def?.default_min_score_tier,
    max_per_run: rule?.max_per_run ?? def?.default_max_per_run,
  };
}
