# Slack Notification Controls — Build Prompt

## Context

Pandora sends Slack alerts for various skill outputs (ICP score jumps, pipeline hygiene findings, deal risk alerts, etc.). Currently these fire individually and immediately, which causes alert fatigue — a single skill run can produce 10-20 messages in quick succession.

We need workspace-level notification preferences that give users granular control over what gets sent, when, and how.

---

## Step 0: Reconnaissance

```bash
# 1. Find the current Slack posting code
grep -rn "slack\|postMessage\|webhook\|sendSlack\|SLACK" server/ --include="*.ts" | grep -v node_modules | grep -v ".d.ts" | head -30

# 2. Find where skill runs trigger Slack messages
grep -rn "channel\|notify\|alert\|deliver" server/ --include="*.ts" | grep -iv "node_modules\|test\|spec" | head -30

# 3. Check how workspace Slack config is stored
psql "$DATABASE_URL" -c "
  SELECT key, substring(value::text, 1, 200) 
  FROM context_layer 
  WHERE category IN ('slack_config', 'workspace_settings', 'notification_settings', 'credentials')
  AND key LIKE '%slack%'
  LIMIT 10;
"

# 4. Check workspace_settings or connectors table for Slack webhook
psql "$DATABASE_URL" -c "\d workspace_connectors" 2>/dev/null || echo "No workspace_connectors table"
psql "$DATABASE_URL" -c "
  SELECT column_name FROM information_schema.columns 
  WHERE table_name = 'workspaces' AND column_name LIKE '%slack%';
"

# 5. Find the ICP score jump alert specifically (what we see in the screenshot)
grep -rn "Score Jump\|score_jump\|icp.*alert\|fit.*score.*rose" server/ --include="*.ts" | head -15

# 6. Find all Slack message templates/formatters
grep -rn "blocks\|Block Kit\|mrkdwn\|section.*text" server/ --include="*.ts" | grep -i slack | head -15

# 7. Check if any notification preferences already exist
psql "$DATABASE_URL" -c "
  SELECT key, substring(value::text, 1, 300)
  FROM context_layer
  WHERE category LIKE '%notif%' OR key LIKE '%notif%' OR key LIKE '%alert%'
  LIMIT 10;
"
```

Understand:
- Where Slack messages are sent from (single function? multiple places?)
- What triggers them (skill completion? action creation? score change?)
- How the webhook/token is stored
- Whether there's already a centralized send function or if each skill posts independently

---

## Part 1: Notification Preferences Schema

Store notification preferences in `context_layer` per workspace.

**Key:** `notification_preferences`  
**Category:** `workspace_settings`

```typescript
interface NotificationPreferences {
  // Global controls
  enabled: boolean;                      // Master kill switch
  quiet_hours: {
    enabled: boolean;
    start: string;                       // "22:00" (10 PM)
    end: string;                         // "07:00" (7 AM)
    timezone: string;                    // "America/New_York"
  };
  
  // Delivery mode
  delivery_mode: 'realtime' | 'digest' | 'smart';
  // realtime = send immediately (current behavior)
  // digest = batch everything into scheduled digests
  // smart = critical sends immediately, everything else batches
  
  digest_schedule: {
    frequency: 'daily' | 'twice_daily';
    times: string[];                     // ["08:00", "16:00"]
    timezone: string;
  };
  
  // Per-category rules (override delivery_mode for specific alert types)
  category_rules: {
    [category: string]: CategoryRule;
  };
  
  // Channel routing
  default_channel: string;               // "#pandora-alerts" or webhook URL
  channel_overrides: {
    [category: string]: string;          // "#pipeline-critical" for critical alerts
  };
}

interface CategoryRule {
  enabled: boolean;                      // false = suppress entirely
  delivery: 'realtime' | 'digest' | 'inherit';  // 'inherit' uses global delivery_mode
  
  // Threshold filters (category-specific)
  min_severity?: 'critical' | 'warning' | 'info';  // suppress below this
  min_score_change?: number;             // for ICP: only alert if change >= N points
  min_score_tier?: string;               // for ICP: only alert for A/B tier, not C/D
  max_per_run?: number;                  // cap alerts per skill run (e.g., top 5 only)
}
```

### Default Notification Categories

```typescript
const NOTIFICATION_CATEGORIES = {
  // ICP / Lead Scoring
  'icp_score_jump': {
    label: 'ICP Score Jumps',
    description: 'Account fit score increased significantly',
    default_enabled: true,
    default_delivery: 'smart',
    supports_threshold: true,
    default_min_score_change: 15,
    default_min_score_tier: 'B',         // Only B+ tier
    default_max_per_run: 5,
  },
  'icp_score_drop': {
    label: 'ICP Score Drops',
    description: 'Account fit score decreased significantly',
    default_enabled: true,
    default_delivery: 'digest',
    supports_threshold: true,
    default_min_score_change: 20,
  },
  'new_a_grade_lead': {
    label: 'New A-Grade Leads',
    description: 'Contact scored A-grade for the first time',
    default_enabled: true,
    default_delivery: 'realtime',
  },
  
  // Pipeline
  'deal_risk_alert': {
    label: 'Deal Risk Alerts',
    description: 'Deal flagged as at-risk by pipeline hygiene',
    default_enabled: true,
    default_delivery: 'smart',
    default_min_severity: 'warning',
  },
  'stale_deal_alert': {
    label: 'Stale Deal Alerts',
    description: 'Deal has been inactive beyond threshold',
    default_enabled: true,
    default_delivery: 'digest',
  },
  'single_thread_alert': {
    label: 'Single-Thread Alerts',
    description: 'Deal has only one contact engaged',
    default_enabled: true,
    default_delivery: 'digest',
  },
  
  // Forecast
  'forecast_variance': {
    label: 'Forecast Variance',
    description: 'Significant gap between forecast and pipeline',
    default_enabled: true,
    default_delivery: 'realtime',
    default_min_severity: 'warning',
  },
  
  // Data Quality
  'data_quality_issue': {
    label: 'Data Quality Issues',
    description: 'Missing or invalid CRM fields detected',
    default_enabled: true,
    default_delivery: 'digest',
    default_max_per_run: 10,
  },
  
  // Agent Briefings
  'agent_briefing_ready': {
    label: 'Agent Briefings',
    description: 'Scheduled agent briefing is ready to view',
    default_enabled: true,
    default_delivery: 'realtime',
  },
  
  // System
  'sync_error': {
    label: 'Sync Errors',
    description: 'CRM sync or skill run failed',
    default_enabled: true,
    default_delivery: 'realtime',
  },
  'config_drift': {
    label: 'Config Drift Detected',
    description: 'Workspace config audit found changes',
    default_enabled: true,
    default_delivery: 'digest',
  },
};
```

---

## Part 2: Centralized Notification Gateway

Create a single function that ALL Slack messages route through. No skill or feature should post to Slack directly.

**File:** `server/notifications/notification-gateway.ts`

```typescript
interface NotificationPayload {
  workspace_id: string;
  category: string;                      // matches NOTIFICATION_CATEGORIES key
  severity: 'critical' | 'warning' | 'info';
  title: string;
  body: string;
  
  // Optional enrichment
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
  
  // Pre-formatted Slack blocks (optional — gateway can format if not provided)
  slack_blocks?: any[];
}

async function sendNotification(payload: NotificationPayload): Promise<{
  status: 'sent' | 'queued' | 'suppressed';
  reason?: string;
}> {
  // 1. Load workspace notification preferences
  const prefs = await getNotificationPreferences(payload.workspace_id);
  
  // 2. Check master kill switch
  if (!prefs.enabled) {
    return { status: 'suppressed', reason: 'notifications_disabled' };
  }
  
  // 3. Check quiet hours
  if (isQuietHours(prefs)) {
    // Queue for delivery after quiet hours end
    await queueNotification(payload, prefs.quiet_hours.end, prefs.quiet_hours.timezone);
    return { status: 'queued', reason: 'quiet_hours' };
  }
  
  // 4. Check category rule
  const categoryRule = prefs.category_rules[payload.category];
  const categoryDefault = NOTIFICATION_CATEGORIES[payload.category];
  
  if (categoryRule?.enabled === false) {
    return { status: 'suppressed', reason: 'category_disabled' };
  }
  
  // 5. Check threshold filters
  if (!passesThresholds(payload, categoryRule, categoryDefault)) {
    return { status: 'suppressed', reason: 'below_threshold' };
  }
  
  // 6. Determine delivery mode
  const deliveryMode = resolveDeliveryMode(payload, categoryRule, prefs);
  
  if (deliveryMode === 'digest') {
    await queueForDigest(payload, prefs);
    return { status: 'queued', reason: 'digest_mode' };
  }
  
  if (deliveryMode === 'smart') {
    // Critical = realtime, everything else = digest
    if (payload.severity === 'critical') {
      await sendToSlack(payload, prefs);
      return { status: 'sent' };
    } else {
      await queueForDigest(payload, prefs);
      return { status: 'queued', reason: 'smart_mode_non_critical' };
    }
  }
  
  // Realtime — send now
  await sendToSlack(payload, prefs);
  return { status: 'sent' };
}
```

### Threshold Check Logic

```typescript
function passesThresholds(
  payload: NotificationPayload,
  rule: CategoryRule | undefined,
  defaults: typeof NOTIFICATION_CATEGORIES[string]
): boolean {
  // Severity filter
  const minSeverity = rule?.min_severity || defaults?.default_min_severity;
  if (minSeverity) {
    const severityRank = { info: 0, warning: 1, critical: 2 };
    if (severityRank[payload.severity] < severityRank[minSeverity]) {
      return false;
    }
  }
  
  // Score change filter (ICP alerts)
  const minScoreChange = rule?.min_score_change ?? defaults?.default_min_score_change;
  if (minScoreChange && payload.metadata?.score_change !== undefined) {
    if (Math.abs(payload.metadata.score_change) < minScoreChange) {
      return false;
    }
  }
  
  // Score tier filter (ICP alerts)
  const minTier = rule?.min_score_tier ?? defaults?.default_min_score_tier;
  if (minTier && payload.metadata?.score_tier) {
    const tierRank: Record<string, number> = { 'A': 4, 'B': 3, 'C': 2, 'D': 1, 'F': 0 };
    if ((tierRank[payload.metadata.score_tier] ?? 0) < (tierRank[minTier] ?? 0)) {
      return false;
    }
  }
  
  return true;
}
```

---

## Part 3: Digest Queue and Delivery

Store queued notifications in a lightweight table or context_layer, then flush on schedule.

### Option A: Use a table (preferred for reliability)

```sql
CREATE TABLE IF NOT EXISTS notification_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  slack_blocks JSONB,
  
  queued_at TIMESTAMPTZ DEFAULT now(),
  deliver_after TIMESTAMPTZ,             -- for quiet hours delay
  delivered_at TIMESTAMPTZ,
  digest_id TEXT,                         -- groups items into a single digest
  
  CONSTRAINT valid_severity CHECK (severity IN ('critical', 'warning', 'info'))
);

CREATE INDEX idx_notif_queue_pending ON notification_queue(workspace_id, delivered_at) 
  WHERE delivered_at IS NULL;
```

### Digest Flush Function

Add to the existing cron runner (or create a lightweight interval):

```typescript
// Runs every 15 minutes, checks if any workspace is due for a digest
async function flushDigests() {
  const workspaces = await db.query(`
    SELECT DISTINCT workspace_id 
    FROM notification_queue 
    WHERE delivered_at IS NULL 
    AND deliver_after IS NULL OR deliver_after <= now()
  `);
  
  for (const ws of workspaces.rows) {
    const prefs = await getNotificationPreferences(ws.workspace_id);
    
    // Check if it's time for this workspace's digest
    if (!isDueForDigest(prefs)) continue;
    
    // Pull all pending notifications
    const pending = await db.query(`
      SELECT * FROM notification_queue
      WHERE workspace_id = $1 AND delivered_at IS NULL
      ORDER BY severity DESC, queued_at ASC
    `, [ws.workspace_id]);
    
    if (pending.rows.length === 0) continue;
    
    // Apply max_per_run caps per category
    const filtered = applyPerRunCaps(pending.rows, prefs);
    
    // Build digest message
    const digestBlocks = buildDigestBlocks(filtered, prefs);
    
    // Send single digest message to Slack
    await postToSlack(ws.workspace_id, digestBlocks, prefs);
    
    // Mark as delivered
    const ids = pending.rows.map(r => r.id);
    await db.query(`
      UPDATE notification_queue 
      SET delivered_at = now(), digest_id = $2
      WHERE id = ANY($1)
    `, [ids, `digest_${Date.now()}`]);
  }
}
```

### Digest Message Format

```typescript
function buildDigestBlocks(notifications: any[], prefs: NotificationPreferences): any[] {
  const blocks: any[] = [];
  
  // Header
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: '📋 Pandora Digest' },
  });
  
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `${notifications.length} updates · ${new Date().toLocaleString('en-US', { 
        timeZone: prefs.digest_schedule.timezone 
      })}`,
    }],
  });
  
  blocks.push({ type: 'divider' });
  
  // Group by category
  const grouped = groupBy(notifications, 'category');
  
  for (const [category, items] of Object.entries(grouped)) {
    const categoryDef = NOTIFICATION_CATEGORIES[category];
    const label = categoryDef?.label || category;
    const severityEmoji = {
      critical: '🔴',
      warning: '🟡',
      info: '🔵',
    };
    
    // Category header
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${label}* (${items.length})`,
      },
    });
    
    // Individual items (compact format)
    const itemLines = items.slice(0, 10).map((item: any) => {
      const emoji = severityEmoji[item.severity] || '◾';
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
  
  // Footer with link to Pandora
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: '📊 <https://app.pandora.dev|View in Pandora> · Reply to adjust notification preferences',
    }],
  });
  
  return blocks;
}
```

---

## Part 4: Refactor Existing Slack Posts

Find every place in the codebase that currently posts to Slack and route it through the gateway.

### Before (current pattern — posting directly):

```typescript
// Inside ICP scoring skill or wherever the score jump alert fires
await postToSlackChannel(workspaceId, {
  text: `📈 Account Score Jump: ${accountName}`,
  blocks: [/* ... */],
});
```

### After (route through gateway):

```typescript
import { sendNotification } from '../notifications/notification-gateway';

await sendNotification({
  workspace_id: workspaceId,
  category: 'icp_score_jump',
  severity: 'info',
  title: `Account Score Jump: ${accountName}`,
  body: `${accountName}'s ICP fit score rose to ${newScore} (${tier}) — ${reason}`,
  metadata: {
    skill_id: 'lead-scoring',
    entity_type: 'account',
    entity_name: accountName,
    score_change: scoreDelta,
    score_tier: tier,
  },
});
```

Do this for EVERY Slack post in the codebase. Common locations to check:
- ICP/Lead Scoring skill output
- Pipeline Hygiene findings
- Single-Thread alerts
- Deal risk alerts
- Forecast variance alerts
- Data quality issues
- Agent briefing completions
- Sync errors
- Config audit results

If a skill currently builds its own Block Kit message, pass those blocks as `slack_blocks` in the payload so the gateway can use them.

---

## Part 5: API Endpoints for Preferences

```typescript
// GET notification preferences for a workspace
router.get('/api/workspaces/:workspaceId/notification-preferences', async (req, res) => {
  const prefs = await getNotificationPreferences(req.params.workspaceId);
  
  // Merge with category defaults for UI display
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
  
  res.json({
    ...prefs,
    categories,
  });
});

// UPDATE notification preferences
router.patch('/api/workspaces/:workspaceId/notification-preferences', async (req, res) => {
  const current = await getNotificationPreferences(req.params.workspaceId);
  const updated = deepMerge(current, req.body);
  
  await saveNotificationPreferences(req.params.workspaceId, updated);
  
  res.json(updated);
});

// Quick actions
router.post('/api/workspaces/:workspaceId/notifications/pause', async (req, res) => {
  // Pause all notifications for N hours (default 4)
  const hours = req.body.hours || 4;
  const prefs = await getNotificationPreferences(req.params.workspaceId);
  prefs.enabled = false;
  prefs._paused_until = new Date(Date.now() + hours * 3600000).toISOString();
  await saveNotificationPreferences(req.params.workspaceId, prefs);
  res.json({ paused_until: prefs._paused_until });
});

router.post('/api/workspaces/:workspaceId/notifications/resume', async (req, res) => {
  const prefs = await getNotificationPreferences(req.params.workspaceId);
  prefs.enabled = true;
  delete prefs._paused_until;
  await saveNotificationPreferences(req.params.workspaceId, prefs);
  res.json({ enabled: true });
});

// Get digest queue status
router.get('/api/workspaces/:workspaceId/notifications/queue', async (req, res) => {
  const pending = await db.query(`
    SELECT category, severity, COUNT(*) as count
    FROM notification_queue
    WHERE workspace_id = $1 AND delivered_at IS NULL
    GROUP BY category, severity
    ORDER BY severity, category
  `, [req.params.workspaceId]);
  
  res.json({ pending: pending.rows });
});
```

---

## Part 6: Settings UI Component

Add a notification preferences section to the workspace settings page.

Key UI elements:
1. **Master toggle** — enable/disable all notifications
2. **Delivery mode selector** — Realtime / Smart / Digest with explanation text
3. **Digest schedule** — time picker for digest delivery times
4. **Quiet hours** — toggle + start/end time pickers
5. **Category table** — each notification type as a row with:
   - Toggle (enabled/disabled)
   - Delivery override dropdown (Inherit / Realtime / Digest)
   - Threshold sliders where applicable (min score change, min tier, max per run)
6. **Pause button** — "Pause for 4 hours" quick action

The UI should show the current queue count if in digest mode ("12 notifications pending, next digest at 4:00 PM").

---

## Testing Checklist

After implementation:

- [ ] Existing Slack messages still send when preferences are default
- [ ] Setting `enabled: false` suppresses ALL Slack messages
- [ ] Setting a category to `enabled: false` suppresses only that category
- [ ] Setting `delivery_mode: 'digest'` queues messages instead of sending
- [ ] Digest flush sends a single grouped message at scheduled time
- [ ] ICP score jump with `min_score_change: 20` suppresses +17 point changes but sends +28
- [ ] ICP score jump with `min_score_tier: 'A'` suppresses B-tier alerts
- [ ] `max_per_run: 5` caps alerts from a single skill run at 5
- [ ] Quiet hours queue messages and deliver after quiet hours end
- [ ] Smart mode sends critical immediately, queues warning/info
- [ ] Pause/resume endpoints work
- [ ] Queue status endpoint shows pending count
- [ ] Settings UI reflects current preferences and saves changes
- [ ] No skill or feature posts to Slack directly — all go through gateway

## DO NOT:
- Remove or modify existing Slack Block Kit message formats — the gateway wraps them, doesn't replace them
- Break existing Slack delivery when preferences haven't been configured — defaults should match current behavior (realtime, all enabled)
- Store notification preferences in a new table — use context_layer
- Send digest messages to Slack if the queue is empty
- Process digest flushes for workspaces that have notifications disabled
