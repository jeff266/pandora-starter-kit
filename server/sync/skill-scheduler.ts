/**
 * Skill Scheduler
 *
 * Cron-based autonomous skill execution across all connected workspaces.
 * Runs skills on schedule with staggered execution to avoid API rate limits.
 */

import cron from 'node-cron';
import { query } from '../db.js';
import { getSkillRegistry } from '../skills/registry.js';
import { getSkillRuntime } from '../skills/runtime.js';
import { syncWorkspace } from './orchestrator.js';
import type { SkillDefinition } from '../skills/types.js';

interface ScheduledSkill {
  skillId: string;
  cronExpression: string;
  job: cron.ScheduledTask;
}

const scheduledSkills: ScheduledSkill[] = [];

/**
 * Check if skill has run recently (last 6 hours) to prevent duplicate executions
 */
async function hasRecentRun(workspaceId: string, skillId: string): Promise<boolean> {
  const result = await query<{ id: string }>(
    `SELECT id FROM skill_runs
     WHERE skill_id = $1 AND workspace_id = $2
       AND started_at > now() - interval '6 hours'
       AND status IN ('running', 'completed')
     LIMIT 1`,
    [skillId, workspaceId]
  );

  return result.rows.length > 0;
}

/**
 * Execute a single skill for a workspace
 */
async function executeSkill(
  workspaceId: string,
  skill: SkillDefinition,
  triggerType: 'scheduled' | 'manual_batch'
): Promise<{ success: boolean; runId?: string; duration_ms?: number; error?: string }> {
  const startTime = Date.now();

  try {
    // Check for duplicate run
    const isDuplicate = await hasRecentRun(workspaceId, skill.id);
    if (isDuplicate) {
      console.log(`[Skill Scheduler] Skipping ${skill.id} for workspace ${workspaceId} (run within last 6 hours)`);
      return { success: false, error: 'Duplicate run prevented' };
    }

    // Run incremental sync before skill execution (fresh data)
    console.log(`[Skill Scheduler] Pre-skill sync for workspace ${workspaceId}`);
    try {
      await syncWorkspace(workspaceId, { mode: 'incremental' });
      console.log(`[Skill Scheduler] Pre-skill sync completed for workspace ${workspaceId}`);
    } catch (syncErr) {
      console.warn(`[Skill Scheduler] Pre-skill sync failed for workspace ${workspaceId}:`, syncErr);
      // Continue with skill execution even if sync fails (stale data is better than no data)
    }

    // Execute the skill
    const runtime = getSkillRuntime();
    const result = await runtime.executeSkill(skill, workspaceId, {});

    // Log to database with trigger type
    await query(
      `INSERT INTO skill_runs (
        run_id, workspace_id, skill_id, status, trigger_type, params,
        result, output, output_text, steps, token_usage, duration_ms,
        error, started_at, completed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (run_id) DO UPDATE SET
        status = EXCLUDED.status,
        result = EXCLUDED.result,
        output = EXCLUDED.output,
        output_text = EXCLUDED.output_text,
        steps = EXCLUDED.steps,
        token_usage = EXCLUDED.token_usage,
        duration_ms = EXCLUDED.duration_ms,
        error = EXCLUDED.error,
        completed_at = EXCLUDED.completed_at`,
      [
        result.runId,
        workspaceId,
        skill.id,
        result.status,
        triggerType,
        JSON.stringify({}),
        result.stepData ? JSON.stringify(result.stepData) : null,
        result.output ? JSON.stringify(result.output) : null,
        typeof result.output === 'string' ? result.output : null,
        JSON.stringify(result.steps),
        JSON.stringify(result.totalTokenUsage),
        result.totalDuration_ms,
        result.errors && result.errors.length > 0 ? result.errors.map(e => `${e.step}: ${e.error}`).join('; ') : null,
        result.completedAt,
        result.completedAt,
      ]
    );

    const duration = Date.now() - startTime;
    console.log(`[Skill Scheduler] ✓ ${skill.id} completed for workspace ${workspaceId} in ${duration}ms`);

    return {
      success: result.status === 'completed',
      runId: result.runId,
      duration_ms: result.totalDuration_ms,
      error: result.errors?.[0]?.error,
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Skill Scheduler] ✗ ${skill.id} failed for workspace ${workspaceId}:`, errorMsg);

    return {
      success: false,
      duration_ms: duration,
      error: errorMsg,
    };
  }
}

/**
 * Run all scheduled skills for a workspace with staggered execution
 */
export async function runScheduledSkills(
  workspaceId: string,
  skillIds: string[],
  triggerType: 'scheduled' | 'manual_batch' = 'scheduled'
): Promise<Array<{ skillId: string; success: boolean; runId?: string; duration_ms?: number; error?: string }>> {
  const registry = getSkillRegistry();
  const results: Array<{ skillId: string; success: boolean; runId?: string; duration_ms?: number; error?: string }> = [];

  console.log(`[Skill Scheduler] Running ${skillIds.length} skills for workspace ${workspaceId}`);

  for (const skillId of skillIds) {
    const skill = registry.get(skillId);
    if (!skill) {
      console.error(`[Skill Scheduler] Skill not found: ${skillId}`);
      results.push({ skillId, success: false, error: 'Skill not found' });
      continue;
    }

    const result = await executeSkill(workspaceId, skill, triggerType);
    results.push({ skillId, ...result });

    // Wait 30 seconds before next skill (unless it's the last one)
    if (skillId !== skillIds[skillIds.length - 1]) {
      console.log(`[Skill Scheduler] Waiting 30s before next skill...`);
      await new Promise(resolve => setTimeout(resolve, 30_000));
    }
  }

  return results;
}

/**
 * Start the skill scheduler
 */
export function startSkillScheduler(): void {
  const registry = getSkillRegistry();
  const allSkills = registry.getAll();

  // Group skills by cron expression
  const cronGroups = new Map<string, string[]>();

  for (const skill of allSkills) {
    if (skill.schedule?.cron) {
      const cron = skill.schedule.cron;
      if (!cronGroups.has(cron)) {
        cronGroups.set(cron, []);
      }
      cronGroups.get(cron)!.push(skill.id);
    }
  }

  // Create cron jobs for each unique schedule
  for (const [cronExpression, skillIds] of cronGroups.entries()) {
    const job = cron.schedule(
      cronExpression,
      async () => {
        console.log(`[Skill Scheduler] Cron triggered: ${cronExpression} (${skillIds.length} skills)`);

        // Get all workspaces with connected sources
        const workspacesResult = await query<{ id: string; name: string }>(
          `SELECT DISTINCT w.id, w.name
           FROM workspaces w
           INNER JOIN connections c ON c.workspace_id = w.id
           WHERE c.status IN ('connected', 'synced', 'error')
           ORDER BY w.name`
        );

        const workspaces = workspacesResult.rows;

        if (workspaces.length === 0) {
          console.log('[Skill Scheduler] No workspaces with connected sources — skipping');
          return;
        }

        console.log(`[Skill Scheduler] Running ${skillIds.length} skills for ${workspaces.length} workspace(s)`);

        // Run skills for each workspace sequentially
        for (const workspace of workspaces) {
          console.log(`[Skill Scheduler] Processing workspace: ${workspace.name} (${workspace.id})`);
          await runScheduledSkills(workspace.id, skillIds, 'scheduled');
        }

        console.log(`[Skill Scheduler] Cron batch complete: ${cronExpression}`);
      },
      {
        timezone: 'UTC',
      }
    );

    scheduledSkills.push({
      skillId: skillIds.join(','),
      cronExpression,
      job,
    });

    console.log(`[Skill Scheduler] Registered ${skillIds.join(', ')} on cron ${cronExpression}`);
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log(`[Skill Scheduler] Server timezone: ${timezone}`);
  console.log(`[Skill Scheduler] Cron expressions use UTC timezone`);
  console.log(`[Skill Scheduler] ${scheduledSkills.length} cron schedule(s) registered`);
}

/**
 * Stop the skill scheduler (graceful shutdown)
 */
export function stopSkillScheduler(): void {
  scheduledSkills.forEach(s => s.job.stop());
  scheduledSkills.length = 0;
  console.log('[Skill Scheduler] Stopped all cron jobs');
}
