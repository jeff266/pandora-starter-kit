import { Router } from 'express';
import { getNotificationPreferences, saveNotificationPreferences } from '../notifications/preferences.js';
import { NOTIFICATION_CATEGORIES } from '../notifications/categories.js';
import { getQueueStatus } from '../notifications/digest.js';

const router = Router();

router.get('/:workspaceId/notification-preferences', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const prefs = await getNotificationPreferences(workspaceId);

    const categories = Object.entries(NOTIFICATION_CATEGORIES).map(([key, def]) => ({
      id: key,
      ...def,
      rule: prefs.category_rules[key] || {
        enabled: def.default_enabled,
        delivery: 'inherit',
        min_severity: def.default_min_severity,
        min_score_change: def.default_min_score_change,
        min_score_tier: def.default_min_score_tier,
        max_per_run: def.default_max_per_run,
      },
    }));

    res.json({ ...prefs, categories });
  } catch (err) {
    console.error('[NotifPrefs] GET error:', err);
    res.status(500).json({ error: 'Failed to load notification preferences' });
  }
});

router.patch('/:workspaceId/notification-preferences', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const current = await getNotificationPreferences(workspaceId);

    const updated = { ...current };
    if (typeof req.body.enabled === 'boolean') updated.enabled = req.body.enabled;
    if (req.body.quiet_hours) updated.quiet_hours = { ...updated.quiet_hours, ...req.body.quiet_hours };
    if (req.body.delivery_mode) updated.delivery_mode = req.body.delivery_mode;
    if (req.body.digest_schedule) updated.digest_schedule = { ...updated.digest_schedule, ...req.body.digest_schedule };
    if (req.body.category_rules) updated.category_rules = { ...updated.category_rules, ...req.body.category_rules };
    if (req.body.default_channel !== undefined) updated.default_channel = req.body.default_channel;
    if (req.body.channel_overrides) updated.channel_overrides = { ...updated.channel_overrides, ...req.body.channel_overrides };

    await saveNotificationPreferences(workspaceId, updated);
    res.json(updated);
  } catch (err) {
    console.error('[NotifPrefs] PATCH error:', err);
    res.status(500).json({ error: 'Failed to update notification preferences' });
  }
});

router.post('/:workspaceId/notifications/pause', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const hours = req.body.hours || 4;
    const prefs = await getNotificationPreferences(workspaceId);
    prefs.enabled = false;
    prefs._paused_until = new Date(Date.now() + hours * 3600000).toISOString();
    await saveNotificationPreferences(workspaceId, prefs);
    res.json({ paused_until: prefs._paused_until });
  } catch (err) {
    console.error('[NotifPrefs] Pause error:', err);
    res.status(500).json({ error: 'Failed to pause notifications' });
  }
});

router.post('/:workspaceId/notifications/resume', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const prefs = await getNotificationPreferences(workspaceId);
    prefs.enabled = true;
    delete prefs._paused_until;
    await saveNotificationPreferences(workspaceId, prefs);
    res.json({ enabled: true });
  } catch (err) {
    console.error('[NotifPrefs] Resume error:', err);
    res.status(500).json({ error: 'Failed to resume notifications' });
  }
});

router.get('/:workspaceId/notifications/queue', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const pending = await getQueueStatus(workspaceId);
    res.json({ pending });
  } catch (err) {
    console.error('[NotifPrefs] Queue status error:', err);
    res.status(500).json({ error: 'Failed to get queue status' });
  }
});

export default router;
