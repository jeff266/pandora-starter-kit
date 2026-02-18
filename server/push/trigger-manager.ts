/**
 * Push API — Trigger Manager
 *
 * Manages three trigger types:
 * 1. Cron — fires delivery rules on a cron schedule
 * 2. Skill Run — fires after a specific skill completes
 * 3. Threshold — polls every 15 minutes for deals breaching a score condition
 *
 * All delivery is fire-and-forget — trigger failures never throw.
 */

import cron, { type ScheduledTask } from 'node-cron';
import { query } from '../db.js';
import { assembleFindingsForRule, type DeliveryRuleRow } from './finding-assembler.js';
import { executeDelivery, type DeliveryChannelRow } from './delivery-executor.js';

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function getWorkspaceName(workspaceId: string): Promise<string> {
  try {
    const r = await query<{ name: string }>(
      'SELECT name FROM workspaces WHERE id = $1',
      [workspaceId]
    );
    return r.rows[0]?.name || 'Unknown Workspace';
  } catch {
    return 'Unknown Workspace';
  }
}

async function getChannel(channelId: string): Promise<DeliveryChannelRow | null> {
  try {
    const r = await query<any>(
      'SELECT * FROM delivery_channels WHERE id = $1 AND is_active = true',
      [channelId]
    );
    return r.rows[0] || null;
  } catch {
    return null;
  }
}

async function getActiveRules(filter: Partial<{ trigger_type: string; skill_id: string }>): Promise<DeliveryRuleRow[]> {
  const conditions = ['is_active = true'];
  const params: any[] = [];

  if (filter.trigger_type) {
    params.push(filter.trigger_type);
    conditions.push(`trigger_type = $${params.length}`);
  }
  if (filter.skill_id) {
    params.push(filter.skill_id);
    conditions.push(`trigger_config->>'skill_id' = $${params.length}`);
  }

  const r = await query<any>(
    `SELECT * FROM delivery_rules WHERE ${conditions.join(' AND ')}`,
    params
  );
  return r.rows;
}

async function fireRule(rule: DeliveryRuleRow, triggeredBy: string): Promise<void> {
  try {
    const channel = await getChannel(rule.channel_id);
    if (!channel) {
      console.warn(`[PushAPI] Channel ${rule.channel_id} not found for rule "${rule.name}" — skipping`);
      return;
    }

    const workspaceName = await getWorkspaceName(rule.workspace_id);
    const findings = await assembleFindingsForRule(rule, rule.workspace_id);

    // Mark last_triggered_at
    await query(
      'UPDATE delivery_rules SET last_triggered_at = NOW() WHERE id = $1',
      [rule.id]
    ).catch(() => {});

    await executeDelivery(rule, channel, findings, triggeredBy, workspaceName);
  } catch (err) {
    console.error(`[PushAPI] fireRule failed for "${rule.name}":`, err instanceof Error ? err.message : err);
  }
}

// ─── Trigger 1: Cron ─────────────────────────────────────────────────────────

/**
 * Called at startup. Loads all active cron-triggered rules from DB
 * and schedules them with node-cron. Re-run to reload after rule changes.
 */
export async function startCronTriggers(): Promise<ScheduledTask[]> {
  const tasks: ScheduledTask[] = [];
  try {
    const rules = await getActiveRules({ trigger_type: 'cron' });
    for (const rule of rules) {
      const schedule = rule.trigger_config?.schedule;
      if (!schedule || !(cron.validate ? cron.validate(schedule) : true)) {
        console.warn(`[PushAPI] Invalid cron schedule for rule "${rule.name}": ${schedule}`);
        continue;
      }
      const timezone = rule.trigger_config?.timezone || 'UTC';
      const task = cron.schedule(schedule, async () => {
        console.log(`[PushAPI] Cron trigger fired for rule "${rule.name}"`);
        await fireRule(rule, 'cron');
      }, { timezone });
      tasks.push(task);
      console.log(`[PushAPI] Cron rule scheduled: "${rule.name}" @ ${schedule} (${timezone})`);
    }
  } catch (err) {
    console.warn('[PushAPI] Failed to start cron triggers:', err instanceof Error ? err.message : err);
  }
  return tasks;
}

// ─── Trigger 2: Skill Run ─────────────────────────────────────────────────────

/**
 * Called by skill runtime after a skill completes successfully.
 * Fire-and-forget — never awaited by the runtime.
 */
export function onSkillRunCompleted(workspaceId: string, skillId: string, runId: string): void {
  setImmediate(async () => {
    try {
      const rules = await getActiveRules({ trigger_type: 'skill_run', skill_id: skillId });
      if (rules.length === 0) return;

      console.log(`[PushAPI] Skill run trigger: ${rules.length} rule(s) for skill "${skillId}"`);
      for (const rule of rules) {
        if (rule.workspace_id !== workspaceId) continue; // scope to workspace
        await fireRule(rule, `skill_run:${runId}`);
      }
    } catch (err) {
      console.error('[PushAPI] Skill run trigger failed:', err instanceof Error ? err.message : err);
    }
  });
}

// ─── Trigger 3: Threshold ─────────────────────────────────────────────────────

/**
 * Polls every 15 minutes. Fires rules when new deals breach their threshold
 * condition since last_triggered_at. Only fires on NEW breaches.
 */
export function startThresholdPoller(): ScheduledTask {
  const task = cron.schedule('*/15 * * * *', async () => {
    try {
      const rules = await getActiveRules({ trigger_type: 'threshold' });
      for (const rule of rules) {
        await evaluateThresholdRule(rule);
      }
    } catch (err) {
      console.error('[PushAPI] Threshold poller error:', err instanceof Error ? err.message : err);
    }
  });
  console.log('[PushAPI] Threshold poller started (every 15 min)');
  return task;
}

async function evaluateThresholdRule(rule: DeliveryRuleRow): Promise<void> {
  try {
    const tc = rule.trigger_config;
    if (!tc?.field || !tc?.operator || tc?.value === undefined) return;

    const sinceDate = rule.last_triggered_at
      ? new Date(rule.last_triggered_at).toISOString()
      : new Date(Date.now() - 60 * 60 * 1000).toISOString(); // default: last 1 hour

    // Build threshold query — currently supports ai_score on deals table
    let sql: string;
    let params: any[];

    if (tc.field === 'ai_score') {
      const op = tc.operator === '<' ? '<' : tc.operator === '>' ? '>' : '<';
      sql = `
        SELECT COUNT(*)::int as breach_count
        FROM deals
        WHERE workspace_id = $1
          AND ai_score ${op} $2
          AND ai_score_updated_at > $3
          AND stage_normalized NOT IN ('closed_won', 'closed_lost')
      `;
      params = [rule.workspace_id, tc.value, sinceDate];
    } else {
      return; // Unsupported field — skip
    }

    const r = await query<{ breach_count: number }>(sql, params);
    const breachCount = r.rows[0]?.breach_count || 0;

    if (breachCount > 0) {
      console.log(`[PushAPI] Threshold breach: ${breachCount} deals match rule "${rule.name}"`);
      await fireRule(rule, 'threshold');
    }
  } catch (err) {
    console.warn(`[PushAPI] Threshold evaluation failed for rule "${rule.name}":`, err instanceof Error ? err.message : err);
  }
}

// ─── Global state ─────────────────────────────────────────────────────────────

let cronTasks: ScheduledTask[] = [];
let thresholdTask: ScheduledTask | null = null;

export async function startPushTriggers(): Promise<void> {
  cronTasks = await startCronTriggers();
  thresholdTask = startThresholdPoller();
  console.log(`[PushAPI] Push trigger system started (${cronTasks.length} cron rules, threshold poller active)`);
}

export function stopPushTriggers(): void {
  for (const t of cronTasks) t.stop();
  thresholdTask?.stop();
  cronTasks = [];
  thresholdTask = null;
  console.log('[PushAPI] Push trigger system stopped');
}

/**
 * Call this after creating/updating/deleting a delivery rule to reload cron schedules.
 */
export async function reloadCronTriggers(): Promise<void> {
  for (const t of cronTasks) t.stop();
  cronTasks = await startCronTriggers();
}
