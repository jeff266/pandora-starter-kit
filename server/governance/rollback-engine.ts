/**
 * Rollback Engine
 *
 * Applies and reverts governance changes.
 * Every deployed change must be rollback-able with a single API call.
 */

import { query } from '../db.js';
import { configLoader } from '../config/workspace-config-loader.js';
import { getGovernanceRecord, updateStatus } from './db.js';
import type { SkillGovernanceRecord } from './db.js';

// ===== APPLY CHANGE =====

export async function applyChange(
  workspaceId: string,
  record: SkillGovernanceRecord
): Promise<void> {
  switch (record.change_type) {
    case 'resolver_pattern':
      await applyResolverPattern(workspaceId, record.change_payload);
      break;
    case 'workspace_context':
      await applyWorkspaceContext(workspaceId, record.change_payload);
      break;
    case 'named_filter':
      await applyNamedFilter(workspaceId, record.change_payload);
      break;
    case 'skill_schedule': {
      const { skill_id, cron, enabled } = record.change_payload;
      await query(
        `INSERT INTO skill_schedules (workspace_id, skill_id, cron, enabled, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (workspace_id, skill_id)
         DO UPDATE SET cron = EXCLUDED.cron, enabled = EXCLUDED.enabled, updated_at = NOW()`,
        [workspaceId, skill_id, cron, enabled]
      );
      break;
    }
    default:
      throw new Error(`Unknown change_type: ${record.change_type}`);
  }
  configLoader.clearCache(workspaceId);
}

async function applyResolverPattern(workspaceId: string, payload: any): Promise<void> {
  // Read existing dynamic_resolvers array
  const existing = await query(
    `SELECT definitions->'dynamic_resolvers' as resolvers FROM context_layer WHERE workspace_id = $1`,
    [workspaceId]
  );
  let resolvers: any[] = existing.rows[0]?.resolvers || [];

  // Remove existing entry with same intent, then append new
  resolvers = resolvers.filter((r: any) => r.intent !== payload.intent);
  resolvers.push(payload);

  await query(
    `UPDATE context_layer
     SET definitions = jsonb_set(COALESCE(definitions, '{}'::jsonb), '{dynamic_resolvers}', $2::jsonb),
         updated_at = NOW()
     WHERE workspace_id = $1`,
    [workspaceId, JSON.stringify(resolvers)]
  );
}

async function applyWorkspaceContext(workspaceId: string, payload: any): Promise<void> {
  // Read existing injected_context object
  const existing = await query(
    `SELECT definitions->'injected_context' as ctx FROM context_layer WHERE workspace_id = $1`,
    [workspaceId]
  );
  const ctx = existing.rows[0]?.ctx || {};
  ctx[payload.context_key] = payload.context_value;

  await query(
    `UPDATE context_layer
     SET definitions = jsonb_set(COALESCE(definitions, '{}'::jsonb), '{injected_context}', $2::jsonb),
         updated_at = NOW()
     WHERE workspace_id = $1`,
    [workspaceId, JSON.stringify(ctx)]
  );
}

async function applyNamedFilter(workspaceId: string, payload: any): Promise<void> {
  const configResult = await query(
    `SELECT definitions->'workspace_config' as cfg FROM context_layer WHERE workspace_id = $1`,
    [workspaceId]
  );
  const cfg = configResult.rows[0]?.cfg || {};
  if (!cfg.named_filters) cfg.named_filters = [];

  // Remove existing filter with same slug, then append
  cfg.named_filters = cfg.named_filters.filter((f: any) => f.filter_slug !== payload.filter_slug);
  cfg.named_filters.push(payload);

  await query(
    `UPDATE context_layer
     SET definitions = jsonb_set(COALESCE(definitions, '{}'::jsonb), '{workspace_config}', $2::jsonb),
         updated_at = NOW()
     WHERE workspace_id = $1`,
    [workspaceId, JSON.stringify(cfg)]
  );
}

// ===== SNAPSHOT EXISTING (before overwrite) =====

export async function snapshotExisting(
  workspaceId: string,
  changeType: string,
  payload: any
): Promise<any> {
  try {
    switch (changeType) {
      case 'resolver_pattern': {
        const result = await query(
          `SELECT definitions->'dynamic_resolvers' as resolvers FROM context_layer WHERE workspace_id = $1`,
          [workspaceId]
        );
        const resolvers: any[] = result.rows[0]?.resolvers || [];
        return resolvers.find((r: any) => r.intent === payload.intent) || null;
      }
      case 'workspace_context': {
        const result = await query(
          `SELECT definitions->'injected_context'->>$2 as val FROM context_layer WHERE workspace_id = $1`,
          [workspaceId, payload.context_key]
        );
        return result.rows[0]?.val ? { key: payload.context_key, value: result.rows[0].val } : null;
      }
      case 'named_filter': {
        const result = await query(
          `SELECT definitions->'workspace_config'->'named_filters' as filters FROM context_layer WHERE workspace_id = $1`,
          [workspaceId]
        );
        const filters: any[] = result.rows[0]?.filters || [];
        return filters.find((f: any) => f.filter_slug === payload.filter_slug) || null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// ===== ROLLBACK =====

export async function rollbackChange(
  workspaceId: string,
  governanceId: string,
  rolledBackBy: string,
  reason: string
): Promise<{ success: boolean; restored: string; error?: string }> {
  const record = await getGovernanceRecord(governanceId);

  if (!record || record.workspace_id !== workspaceId) {
    return { success: false, restored: '', error: 'Governance record not found' };
  }
  if (!['deployed', 'monitoring'].includes(record.status)) {
    return { success: false, restored: '', error: `Cannot rollback — status is "${record.status}"` };
  }

  try {
    // Execute type-specific reversal
    switch (record.change_type) {
      case 'resolver_pattern':
        await removeResolverPattern(workspaceId, record.change_payload.intent, record.supersedes_snapshot);
        break;
      case 'workspace_context':
        await removeWorkspaceContext(workspaceId, record.change_payload.context_key, record.supersedes_snapshot);
        break;
      case 'named_filter':
        await removeNamedFilter(workspaceId, record.change_payload.filter_slug, record.supersedes_snapshot);
        break;
      case 'skill_schedule': {
        const { skill_id } = record.change_payload;
        const snapshot = record.supersedes_snapshot;
        if (snapshot === null) {
          await query(
            `DELETE FROM skill_schedules WHERE workspace_id = $1 AND skill_id = $2`,
            [workspaceId, skill_id]
          );
        } else {
          await query(
            `INSERT INTO skill_schedules (workspace_id, skill_id, cron, enabled, updated_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (workspace_id, skill_id)
             DO UPDATE SET cron = EXCLUDED.cron, enabled = EXCLUDED.enabled, updated_at = NOW()`,
            [workspaceId, skill_id, snapshot.cron, snapshot.enabled]
          );
        }
        break;
      }
    }

    // Update governance record
    await query(
      `UPDATE skill_governance
       SET status = 'rolled_back',
           rolled_back_at = NOW(),
           rolled_back_by = $2,
           rollback_reason = $3,
           status_history = status_history || $4::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [
        governanceId,
        rolledBackBy,
        reason,
        JSON.stringify([{
          status: 'rolled_back',
          timestamp: new Date().toISOString(),
          actor: rolledBackBy,
          reason,
        }]),
      ]
    );

    configLoader.clearCache(workspaceId);

    return {
      success: true,
      restored: record.supersedes_snapshot
        ? `Restored previous ${record.change_type}`
        : `Removed ${record.change_type} (no previous version to restore)`,
    };
  } catch (error) {
    console.error(`[Rollback] Failed for ${governanceId}:`, error);
    return { success: false, restored: '', error: String(error) };
  }
}

async function removeResolverPattern(workspaceId: string, intent: string, snapshot: any): Promise<void> {
  const existing = await query(
    `SELECT definitions->'dynamic_resolvers' as resolvers FROM context_layer WHERE workspace_id = $1`,
    [workspaceId]
  );
  let resolvers: any[] = existing.rows[0]?.resolvers || [];
  resolvers = resolvers.filter((r: any) => r.intent !== intent);
  if (snapshot) resolvers.push(snapshot);

  await query(
    `UPDATE context_layer
     SET definitions = jsonb_set(COALESCE(definitions, '{}'::jsonb), '{dynamic_resolvers}', $2::jsonb),
         updated_at = NOW()
     WHERE workspace_id = $1`,
    [workspaceId, JSON.stringify(resolvers)]
  );
}

async function removeWorkspaceContext(workspaceId: string, key: string, snapshot: any): Promise<void> {
  const existing = await query(
    `SELECT definitions->'injected_context' as ctx FROM context_layer WHERE workspace_id = $1`,
    [workspaceId]
  );
  const ctx = existing.rows[0]?.ctx || {};
  delete ctx[key];
  if (snapshot?.key && snapshot?.value) {
    ctx[snapshot.key] = snapshot.value;
  }

  await query(
    `UPDATE context_layer
     SET definitions = jsonb_set(COALESCE(definitions, '{}'::jsonb), '{injected_context}', $2::jsonb),
         updated_at = NOW()
     WHERE workspace_id = $1`,
    [workspaceId, JSON.stringify(ctx)]
  );
}

async function removeNamedFilter(workspaceId: string, filterSlug: string, snapshot: any): Promise<void> {
  const cfgResult = await query(
    `SELECT definitions->'workspace_config' as cfg FROM context_layer WHERE workspace_id = $1`,
    [workspaceId]
  );
  const cfg = cfgResult.rows[0]?.cfg || {};
  cfg.named_filters = (cfg.named_filters || []).filter((f: any) => f.filter_slug !== filterSlug);
  if (snapshot) cfg.named_filters.push(snapshot);

  await query(
    `UPDATE context_layer
     SET definitions = jsonb_set(COALESCE(definitions, '{}'::jsonb), '{workspace_config}', $2::jsonb),
         updated_at = NOW()
     WHERE workspace_id = $1`,
    [workspaceId, JSON.stringify(cfg)]
  );
}

// ===== AUTO-ROLLBACK MONITOR =====

export async function checkForAutoRollback(workspaceId: string): Promise<void> {
  try {
    const monitoring = await query(
      `SELECT * FROM skill_governance
       WHERE workspace_id = $1 AND status = 'monitoring'`,
      [workspaceId]
    );

    for (const record of monitoring.rows) {
      const deployedAt = new Date(record.deployed_at);
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

      // Count thumbs-down before deployment (7-day window)
      const beforeResult = await query(
        `SELECT
           COUNT(*) FILTER (WHERE signal = 'thumbs_down') as thumbs_down,
           COUNT(*) as total
         FROM agent_feedback
         WHERE workspace_id = $1
           AND created_at > $2 AND created_at < $3`,
        [
          workspaceId,
          new Date(deployedAt.getTime() - sevenDaysMs),
          deployedAt,
        ]
      );

      // Count thumbs-down after deployment (up to now)
      const afterResult = await query(
        `SELECT
           COUNT(*) FILTER (WHERE signal = 'thumbs_down') as thumbs_down,
           COUNT(*) as total
         FROM agent_feedback
         WHERE workspace_id = $1 AND created_at > $2`,
        [workspaceId, deployedAt]
      );

      // Use Number() with explicit fallback for safe arithmetic — COUNT(*) always returns
      // a row, but we guard against any null/NaN edge case explicitly.
      const beforeDown = Math.max(Number(beforeResult.rows[0]?.thumbs_down) || 0, 0);
      const beforeTotal = Math.max(Number(beforeResult.rows[0]?.total) || 0, 0);
      const afterDown = Math.max(Number(afterResult.rows[0]?.thumbs_down) || 0, 0);
      const afterTotal = Math.max(Number(afterResult.rows[0]?.total) || 0, 0);

      // Rates: if no feedback at all in a window, rate = 0 (not NaN)
      const beforeRate = beforeTotal > 0 ? beforeDown / beforeTotal : 0;
      const afterRate = afterTotal > 0 ? afterDown / afterTotal : 0;

      // Need at least 5 total signals after deployment before considering rollback
      // This prevents noise from small-N feedback windows
      if (afterTotal >= 5 && afterRate > beforeRate * 1.5) {
        console.log(`[Governance] Auto-rolling back ${record.id}: feedback degraded (${(beforeRate * 100).toFixed(0)}% → ${(afterRate * 100).toFixed(0)}%, n=${afterTotal})`);
        await rollbackChange(
          workspaceId,
          record.id,
          'auto_rollback',
          `Feedback degraded: thumbs-down rate went from ${(beforeRate * 100).toFixed(0)}% to ${(afterRate * 100).toFixed(0)}% (${afterTotal} signals)`
        );
      } else if (record.trial_expires_at && new Date() > new Date(record.trial_expires_at)) {
        if (afterRate <= beforeRate * 1.1) {
          await query(
            `UPDATE skill_governance
             SET status = 'stable',
                 monitoring_verdict = 'improved',
                 status_history = status_history || $2::jsonb,
                 updated_at = NOW()
             WHERE id = $1`,
            [record.id, JSON.stringify([{
              status: 'stable',
              timestamp: new Date().toISOString(),
              actor: 'auto_monitor',
              reason: 'Trial period passed, feedback stable',
            }])]
          );
        }
      }
    }
  } catch (err) {
    console.error(`[Governance] Auto-rollback check failed for ${workspaceId}:`, err);
  }
}
