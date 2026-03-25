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
import { getAgentRegistry } from '../agents/registry.js';
import { getAgentRuntime } from '../agents/runtime.js';
import { runDealScoreSnapshots } from '../scoring/deal-score-snapshot.js';
import { getActiveScopes, DEFAULT_SCOPE, type ActiveScope } from '../config/scope-loader.js';
import { registerCustomSkill } from '../skills/index.js';
import { SCHEDULED_INVESTIGATIONS } from '../briefing/scheduled-investigations.js';
import { getJobQueue } from '../jobs/queue.js';

interface ScheduledSkill {
  skillId: string;
  cronExpression: string;
  job: cron.ScheduledTask;
}

const scheduledSkills: ScheduledSkill[] = [];

const customSkillCrons = new Map<string, cron.ScheduledTask>();

// Workspace-level cron overrides for built-in skills: key = `${workspaceId}::${skillId}`
const workspaceCronJobs = new Map<string, cron.ScheduledTask>();

/**
 * Register (or replace) a workspace-specific cron job for a built-in skill.
 * Pass cronExpr=null to remove any existing job (on-demand only / reset).
 */
export function updateWorkspaceSkillCron(
  workspaceId: string,
  skillId: string,
  cronExpr: string | null
): void {
  const key = `${workspaceId}::${skillId}`;
  const existing = workspaceCronJobs.get(key);
  if (existing) {
    existing.stop();
    workspaceCronJobs.delete(key);
  }
  if (!cronExpr) return;

  const task = cron.schedule(
    cronExpr,
    async () => {
      console.log(`[WS Cron] Workspace ${workspaceId} skill ${skillId} triggered by custom schedule`);
      try {
        const { runScheduledSkills } = await import('./skill-scheduler.js');
        await runScheduledSkills(workspaceId, [skillId], 'workspace_cron');
      } catch (err: any) {
        console.error(`[WS Cron] Error running ${skillId} for workspace ${workspaceId}:`, err.message);
      }
    },
    { timezone: 'UTC' }
  );
  workspaceCronJobs.set(key, task);
  console.log(`[WS Cron] Registered skill ${skillId} for workspace ${workspaceId} on "${cronExpr}"`);
}

async function loadWorkspaceCronOverrides(): Promise<void> {
  try {
    const rows = await query<{ workspace_id: string; skill_id: string; cron: string }>(
      `SELECT workspace_id, skill_id, cron FROM skill_schedules WHERE cron IS NOT NULL AND enabled = false`
    );
    for (const row of rows.rows) {
      updateWorkspaceSkillCron(row.workspace_id, row.skill_id, row.cron);
    }
    if (rows.rows.length > 0) {
      console.log(`[WS Cron] Loaded ${rows.rows.length} workspace cron override(s) at startup`);
    }
  } catch (err: any) {
    console.error('[WS Cron] Failed to load workspace cron overrides:', err.message);
  }
}

export interface CustomSkillCronRow {
  skill_id: string;
  workspace_id: string;
  schedule_cron: string;
  name: string;
}

export function registerCustomSkillCron(row: CustomSkillCronRow): void {
  if (!row.schedule_cron) return;
  unregisterCustomSkillCron(row.skill_id);

  const task = cron.schedule(
    row.schedule_cron,
    async () => {
      console.log(`[Custom Skill Scheduler] Cron triggered for "${row.name}" (${row.skill_id})`);
      try {
        const { runScheduledSkills } = await import('./skill-scheduler.js');
        await runScheduledSkills(row.workspace_id, [row.skill_id], 'scheduled');
      } catch (err: any) {
        console.error(`[Custom Skill Scheduler] Error running ${row.skill_id}:`, err.message);
      }
    },
    { timezone: 'UTC' }
  );

  customSkillCrons.set(row.skill_id, task);
  console.log(`[Custom Skill Scheduler] Registered "${row.name}" on cron ${row.schedule_cron}`);
}

export function unregisterCustomSkillCron(skillId: string): void {
  const existing = customSkillCrons.get(skillId);
  if (existing) {
    existing.stop();
    customSkillCrons.delete(skillId);
  }
}

async function loadAndScheduleCustomSkills(): Promise<void> {
  try {
    const rows = await query<CustomSkillCronRow>(
      `SELECT skill_id, workspace_id, schedule_cron, name
       FROM custom_skills
       WHERE status = 'active' AND schedule_cron IS NOT NULL`
    );
    for (const row of rows.rows) {
      registerCustomSkillCron(row);
    }
    if (rows.rows.length > 0) {
      console.log(`[Custom Skill Scheduler] Scheduled ${rows.rows.length} custom skill cron(s)`);
    }
  } catch (err: any) {
    console.error('[Custom Skill Scheduler] Failed to load custom skill crons:', err.message);
  }
}

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
  triggerType: 'scheduled' | 'manual_batch' | 'workspace_cron',
  scope?: ActiveScope
): Promise<{ success: boolean; runId?: string; duration_ms?: number; error?: string }> {
  const startTime = Date.now();

  try {
    // Skip the workspace override check when execution originates from a workspace-specific
    // cron job — the cron IS the override, so applying the guard would prevent it from running.
    if (triggerType !== 'workspace_cron') {
      // Check per-workspace schedule override — skip if disabled or has custom cron
      const overrideResult = await query<{ enabled: boolean; cron: string | null }>(
        `SELECT enabled, cron FROM skill_schedules WHERE workspace_id = $1 AND skill_id = $2`,
        [workspaceId, skill.id]
      ).catch(() => ({ rows: [] as { enabled: boolean; cron: string | null }[] }));
      if (overrideResult.rows.length > 0) {
        const override = overrideResult.rows[0];
        if (override.enabled === false && override.cron === null) {
          // On-demand only: no automatic runs for this workspace
          console.log(`[Skill Scheduler] Skipping ${skill.id} for workspace ${workspaceId} (on-demand only override)`);
          return { success: false, error: 'Skill set to on-demand for this workspace' };
        }
        if (override.enabled === false && override.cron !== null) {
          // Custom cron: workspace-specific job handles execution
          console.log(`[Skill Scheduler] Skipping ${skill.id} for workspace ${workspaceId} (handled by workspace cron)`);
          return { success: false, error: 'Handled by workspace-specific cron schedule' };
        }
      }
    }

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

    // Execute the skill — pass scope so tools can filter their SQL queries
    const scopeParams = scope
      ? { scopeId: scope.scope_id, scopeName: scope.name }
      : { scopeId: 'default', scopeName: 'All Deals' };

    const runtime = getSkillRuntime();
    const result = await runtime.executeSkill(skill, workspaceId, scopeParams);

    // Log to database with trigger type and scope metadata
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
        JSON.stringify(scopeParams),
        result.stepData ? JSON.stringify(result.stepData) : null,
        result.output ? JSON.stringify(result.output) : null,
        result.output ? (typeof result.output === 'string' ? result.output : JSON.stringify(result.output)) : null,
        JSON.stringify(result.steps),
        JSON.stringify(result.totalTokenUsage),
        result.totalDuration_ms,
        result.errors && result.errors.length > 0 ? result.errors.map(e => `${e.step}: ${e.error}`).join('; ') : null,
        result.completedAt,
        result.completedAt,
      ]
    );

    // For custom skills: track successful runs so the override guard can activate.
    // Only increment run_count on 'completed' — a failed scheduled run must not
    // suppress the built-in skill the custom skill is set to override.
    if (skill.isCustom) {
      try {
        if (result.status === 'completed') {
          await query(
            `UPDATE custom_skills SET last_run_at = now(), run_count = run_count + 1 WHERE skill_id = $1 AND workspace_id = $2`,
            [skill.id, workspaceId]
          );
          await registerCustomSkill(skill.id, workspaceId).catch(() => {});
        } else {
          await query(
            `UPDATE custom_skills SET last_run_at = now() WHERE skill_id = $1 AND workspace_id = $2`,
            [skill.id, workspaceId]
          );
        }
      } catch (updateErr) {
        console.warn(`[Skill Scheduler] Failed to update run_count for ${skill.id}:`, updateErr);
      }
    }

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
  triggerType: 'scheduled' | 'manual_batch' | 'workspace_cron' = 'scheduled',
  scope?: ActiveScope
): Promise<Array<{ skillId: string; success: boolean; runId?: string; duration_ms?: number; error?: string }>> {
  const registry = getSkillRegistry();
  const results: Array<{ skillId: string; success: boolean; runId?: string; duration_ms?: number; error?: string }> = [];

  const scopeLabel = scope && scope.scope_id !== 'default' ? ` [${scope.name}]` : '';
  console.log(`[Skill Scheduler] Running ${skillIds.length} skills for workspace ${workspaceId}${scopeLabel}`);

  for (const skillId of skillIds) {
    const skill = registry.get(skillId);
    if (!skill) {
      console.error(`[Skill Scheduler] Skill not found: ${skillId}`);
      results.push({ skillId, success: false, error: 'Skill not found' });
      continue;
    }

    const result = await executeSkill(workspaceId, skill, triggerType, scope);
    results.push({ skillId, ...result });

    // Wait 30 seconds before next skill (unless it's the last one)
    if (skillId !== skillIds[skillIds.length - 1]) {
      console.log(`[Skill Scheduler] Waiting 30s before next skill...`);
      await new Promise(resolve => setTimeout(resolve, 30_000));
    }
  }

  return results;
}

// ─── Per-pipeline MC helpers ──────────────────────────────────────────────────

/** Returns the last day of the current calendar quarter as YYYY-MM-DD. */
function currentQuarterEnd(): string {
  const now = new Date();
  const m = now.getMonth(); // 0-based
  const y = now.getFullYear();
  if (m < 3)  return `${y}-03-31`;
  if (m < 6)  return `${y}-06-30`;
  if (m < 9)  return `${y}-09-30`;
  return `${y}-12-31`;
}

/**
 * Run monte-carlo-forecast once per confirmed pipeline scope for a workspace.
 * Skips the hasRecentRun and pre-skill-sync guards (the global run already synced).
 * Called after the regular scheduled batch when MC is included in that batch.
 */
async function runMcForPipelines(workspaceId: string, workspaceName: string): Promise<void> {
  const scopes = await getActiveScopes(workspaceId).catch(() => [DEFAULT_SCOPE]);
  const nonDefault = scopes.filter(s => s.scope_id !== 'default');
  if (nonDefault.length === 0) return;

  const registry = getSkillRegistry();
  const skill = registry.get('monte-carlo-forecast');
  if (!skill) return;

  const runtime = getSkillRuntime();
  const quarterEnd = currentQuarterEnd();

  console.log(`[MC Scheduler] Running pipeline-scoped MC for workspace ${workspaceName} — ${nonDefault.length} pipeline(s), quarterEnd=${quarterEnd}`);

  for (const scope of nonDefault) {
    console.log(`[MC Scheduler] Pipeline: ${scope.name} (${scope.scope_id})`);
    try {
      const params = {
        pipelineFilter: scope.scope_id,
        forecastWindowEnd: quarterEnd,
      };
      const result = await runtime.executeSkill(skill, workspaceId, params);
      await query(
        `INSERT INTO skill_runs (
          run_id, workspace_id, skill_id, status, trigger_type, params,
          result, output, output_text, steps, token_usage, duration_ms,
          error, started_at, completed_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (run_id) DO UPDATE SET
          status = EXCLUDED.status, result = EXCLUDED.result, output = EXCLUDED.output,
          output_text = EXCLUDED.output_text, steps = EXCLUDED.steps,
          token_usage = EXCLUDED.token_usage, duration_ms = EXCLUDED.duration_ms,
          error = EXCLUDED.error, completed_at = EXCLUDED.completed_at`,
        [
          result.runId, workspaceId, skill.id, result.status, 'scheduled',
          JSON.stringify(params),
          result.stepData ? JSON.stringify(result.stepData) : null,
          result.output ? JSON.stringify(result.output) : null,
          result.output ? (typeof result.output === 'string' ? result.output : JSON.stringify(result.output)) : null,
          JSON.stringify(result.steps),
          JSON.stringify(result.totalTokenUsage),
          result.totalDuration_ms,
          result.errors?.length ? result.errors.map((e: any) => `${e.step}: ${e.error}`).join('; ') : null,
          result.completedAt,
          result.completedAt,
        ]
      );
      console.log(`[MC Scheduler] ✓ ${scope.name} pipeline MC completed (runId: ${result.runId})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[MC Scheduler] ✗ ${scope.name} pipeline MC failed:`, msg);
    }

    // 60s gap between pipeline runs to avoid LLM rate limits
    if (scope !== nonDefault[nonDefault.length - 1]) {
      await new Promise(resolve => setTimeout(resolve, 60_000));
    }
  }
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

        // Get all workspaces with connected sources OR at least one deal row
        // (the latter covers upload-only workspaces like GrowthBook that have no active CRM connection)
        const workspacesResult = await query<{ id: string; name: string }>(
          `SELECT DISTINCT w.id, w.name
           FROM workspaces w
           WHERE w.status = 'active'
             AND (
               EXISTS (
                 SELECT 1 FROM connections c
                 WHERE c.workspace_id = w.id
                   AND c.status IN ('connected', 'synced', 'error')
               )
               OR EXISTS (
                 SELECT 1 FROM deals d
                 WHERE d.workspace_id = w.id
               )
             )
           ORDER BY w.name`
        );

        const workspaces = workspacesResult.rows;

        if (workspaces.length === 0) {
          console.log('[Skill Scheduler] No workspaces with deal data or connected sources — skipping');
          return;
        }

        console.log(`[Skill Scheduler] Running ${skillIds.length} skills for ${workspaces.length} workspace(s)`);

        // Run skills for each workspace, fanning out per confirmed scope
        for (const workspace of workspaces) {
          // getActiveScopes returns [DEFAULT_SCOPE] for unconfigured workspaces (single run, no filter)
          // Returns confirmed non-default scopes ONLY when configured — never both default + non-default
          const scopes = await getActiveScopes(workspace.id).catch(() => [DEFAULT_SCOPE]);

          for (const scope of scopes) {
            const scopeLabel = scope.scope_id !== 'default' ? ` [scope: ${scope.name}]` : '';
            console.log(`[Skill Scheduler] Processing workspace: ${workspace.name}${scopeLabel} (${workspace.id})`);
            await runScheduledSkills(workspace.id, skillIds, 'scheduled', scope);
          }

          // After the global MC run, fire one pipeline-scoped MC run per confirmed pipeline.
          // This ensures MC P50/Range is pre-populated for every pipeline filter on the Forecast page.
          if (skillIds.includes('monte-carlo-forecast')) {
            await runMcForPipelines(workspace.id, workspace.name);
          }
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

  // Schedule agents with cron triggers
  const agentRegistry = getAgentRegistry();
  let agentCronCount = 0;
  for (const agent of agentRegistry.list()) {
    if (!agent.enabled || agent.trigger.type !== 'cron' || !agent.trigger.cron) continue;

    const agentId = agent.id;
    const agentCron = agent.trigger.cron;

    const agentJob = cron.schedule(
      agentCron,
      async () => {
        console.log(`[Agent Scheduler] Cron triggered for agent: ${agentId}`);

        const workspacesResult = await query<{ id: string; name: string }>(
          `SELECT DISTINCT w.id, w.name
           FROM workspaces w
           INNER JOIN connections c ON c.workspace_id = w.id
           WHERE c.status IN ('connected', 'synced', 'error')
             AND w.status = 'active'
           ORDER BY w.name`
        );

        const workspaces = agent.workspaceIds === 'all'
          ? workspacesResult.rows
          : workspacesResult.rows.filter(w => (agent.workspaceIds as string[]).includes(w.id));

        if (workspaces.length === 0) {
          console.log(`[Agent Scheduler] No matching workspaces for agent ${agentId}`);
          return;
        }

        const agentRuntime = getAgentRuntime();
        for (const workspace of workspaces) {
          const activeRun = await query(
            `SELECT id FROM agent_runs
             WHERE agent_id = $1 AND workspace_id = $2 AND status = 'running'
             LIMIT 1`,
            [agentId, workspace.id]
          );
          if (activeRun.rows.length > 0) {
            console.log(`[Agent Scheduler] Skipping agent ${agentId} for ${workspace.name} — already running`);
            continue;
          }

          console.log(`[Agent Scheduler] Running agent ${agentId} for workspace ${workspace.name}`);
          agentRuntime.executeAgent(agentId, workspace.id, { triggerType: 'scheduled' })
            .then(result => console.log(`[Agent Scheduler] Agent ${agentId} completed for ${workspace.name} in ${result.duration}ms`))
            .catch(err => console.error(`[Agent Scheduler] Agent ${agentId} failed for ${workspace.name}:`, err.message));
        }
      },
      { timezone: 'UTC' }
    );

    scheduledSkills.push({
      skillId: `agent:${agentId}`,
      cronExpression: agentCron,
      job: agentJob,
    });
    agentCronCount++;
    console.log(`[Agent Scheduler] Registered agent ${agentId} on cron ${agentCron}`);
  }

  // Account enrichment cron: Sunday 2am UTC — full enrichment + scoring batch
  const enrichmentJob = cron.schedule(
    '0 2 * * 0',
    async () => {
      console.log('[Account Enrichment Scheduler] Sunday 2am cron triggered');
      const { enrichAndScoreAccountsBatch } = await import('../enrichment/account-enrichment-batch.js');

      const workspacesResult = await query<{ id: string; name: string }>(
        `SELECT DISTINCT w.id, w.name
         FROM workspaces w
         INNER JOIN connections c ON c.workspace_id = w.id
         WHERE c.status IN ('connected', 'synced', 'error')
           AND w.status = 'active'
         ORDER BY w.name`
      );

      for (const workspace of workspacesResult.rows) {
        console.log(`[Account Enrichment Scheduler] Enriching workspace: ${workspace.name}`);
        try {
          const result = await enrichAndScoreAccountsBatch(workspace.id, { limit: 100 });
          console.log(`[Account Enrichment Scheduler] ✓ ${workspace.name}: ${result.enriched} enriched, ${result.scored} scored, grades: ${JSON.stringify(result.grades)}`);
        } catch (err: any) {
          console.error(`[Account Enrichment Scheduler] ✗ ${workspace.name}:`, err.message);
        }
      }
    },
    { timezone: 'UTC' }
  );
  scheduledSkills.push({ skillId: 'account-enrichment-batch', cronExpression: '0 2 * * 0', job: enrichmentJob });
  console.log('[Account Enrichment Scheduler] Registered account enrichment on cron 0 2 * * 0 (Sunday 2am UTC)');

  // Conversation enrichment — Sunday 22:00 UTC (before Monday skill runs)
  const convEnrichmentJob = cron.schedule('0 22 * * 0', async () => {
    console.log('[ConversationEnrichment] Sunday 10pm cron triggered');
    const { runConversationEnrichmentJob } = await import('../jobs/conversation-enrichment-job.js');
    const workspacesRes = await query<{ id: string; name: string }>(
      `SELECT DISTINCT w.id, w.name FROM workspaces w
       INNER JOIN connections c ON c.workspace_id = w.id
       WHERE c.status IN ('connected','synced','error')
         AND w.status = 'active'
       ORDER BY w.name`,
    );
    for (const ws of workspacesRes.rows) {
      try {
        const result = await runConversationEnrichmentJob(ws.id);
        console.log(`[ConversationEnrichment] ✓ ${ws.name}: ${result.processed} processed, ${result.failed} failed`);
      } catch (err: any) {
        console.error(`[ConversationEnrichment] ✗ ${ws.name}:`, err.message);
      }
    }
  }, { timezone: 'UTC' });
  scheduledSkills.push({ skillId: 'conversation-enrichment-weekly', cronExpression: '0 22 * * 0', job: convEnrichmentJob });
  console.log('[Conversation Enrichment] Registered weekly enrichment on cron 0 22 * * 0 (Sunday 10pm UTC)');

  // Stage conversation tagger — Sunday 21:00 UTC (1 hour before enrichment)
  // Pre-labels conversations as progressor/staller so quarterly Stage Progression reads clean pools
  const stageTaggerJob = cron.schedule('0 21 * * 0', async () => {
    console.log('[StageConversationTagger] Sunday 9pm cron triggered');
    const { runStageConversationTagger } = await import('../jobs/stage-conversation-tagger.js');
    const workspacesRes = await query<{ id: string; name: string }>(
      `SELECT DISTINCT w.id, w.name FROM workspaces w
       INNER JOIN connections c ON c.workspace_id = w.id
       WHERE c.status IN ('connected','synced','error')
         AND w.status = 'active'
       ORDER BY w.name`,
    );
    for (const ws of workspacesRes.rows) {
      try {
        const result = await runStageConversationTagger(ws.id);
        console.log(`[StageConversationTagger] ✓ ${ws.name}: tagged=${result.tagged} resolved=${result.resolved} backfilled=${result.backfilled}`);
      } catch (err: any) {
        console.error(`[StageConversationTagger] ✗ ${ws.name}:`, err.message);
      }
    }
  }, { timezone: 'UTC' });
  scheduledSkills.push({ skillId: 'stage-conversation-tagger-weekly', cronExpression: '0 21 * * 0', job: stageTaggerJob });
  console.log('[StageConversationTagger] Registered weekly tagging on cron 0 21 * * 0 (Sunday 9pm UTC)');

  // Account scoring cron: daily 3am UTC — re-score already-enriched accounts
  const scoringJob = cron.schedule(
    '0 3 * * *',
    async () => {
      console.log('[Account Scoring Scheduler] Daily 3am cron triggered');
      const { scoreAccountsBatch } = await import('../scoring/account-scorer.js');

      const workspacesResult = await query<{ id: string; name: string }>(
        `SELECT DISTINCT w.id, w.name
         FROM workspaces w
         INNER JOIN connections c ON c.workspace_id = w.id
         WHERE c.status IN ('connected', 'synced', 'error')
           AND w.status = 'active'
         ORDER BY w.name`
      );

      for (const workspace of workspacesResult.rows) {
        const accountIds = await query<{ account_id: string }>(
          `SELECT account_id FROM account_signals WHERE workspace_id = $1 AND enriched_at IS NOT NULL`,
          [workspace.id]
        );
        if (accountIds.rows.length === 0) continue;

        console.log(`[Account Scoring Scheduler] Scoring ${accountIds.rows.length} accounts for ${workspace.name}`);
        try {
          const result = await scoreAccountsBatch(workspace.id, accountIds.rows.map(r => r.account_id));
          console.log(`[Account Scoring Scheduler] ✓ ${workspace.name}: ${result.scored} scored, grades: ${JSON.stringify(result.grades)}`);
        } catch (err: any) {
          console.error(`[Account Scoring Scheduler] ✗ ${workspace.name}:`, err.message);
        }
      }
    },
    { timezone: 'UTC' }
  );
  scheduledSkills.push({ skillId: 'account-scoring-daily', cronExpression: '0 3 * * *', job: scoringJob });
  console.log('[Account Scoring Scheduler] Registered daily scoring on cron 0 3 * * * (daily 3am UTC)');

  // Brief assembly cron: daily 7am UTC — assemble context-aware briefs for all active workspaces
  const briefJob = cron.schedule(
    '0 7 * * *',
    async () => {
      console.log('[BriefScheduler] Daily 7am brief assembly triggered');
      const { assembleBrief } = await import('../briefing/brief-assembler.js');
      const { determineBriefType } = await import('../briefing/editorial-engine.js');

      const workspacesResult = await query<{ id: string; name: string }>(
        `SELECT DISTINCT w.id, w.name
         FROM workspaces w
         INNER JOIN connections c ON c.workspace_id = w.id
         WHERE c.status IN ('connected', 'synced', 'error')
           AND w.status = 'active'
         ORDER BY w.name`
      );

      const workspaces = workspacesResult.rows;
      const briefType = determineBriefType(new Date());
      console.log(`[BriefScheduler] Assembling ${briefType} brief for ${workspaces.length} workspace(s)`);

      for (const workspace of workspaces) {
        try {
          await assembleBrief(workspace.id, { brief_type: briefType });
          console.log(`[BriefScheduler] ✓ ${workspace.name} (${workspace.id})`);
        } catch (err: any) {
          console.error(`[BriefScheduler] ✗ ${workspace.name}:`, err.message);
        }
      }
    },
    { timezone: 'UTC' }
  );
  scheduledSkills.push({ skillId: 'brief-daily', cronExpression: '0 7 * * *', job: briefJob });
  console.log('[BriefScheduler] Registered daily brief assembly on cron 0 7 * * * (7am UTC)');

  // Voice Pattern Extraction: monthly on 1st at 6 AM UTC
  const voiceExtractionJob = cron.schedule(
    '0 6 1 * *',
    async () => {
      console.log('[VoicePatterns] Monthly extraction triggered (1st of month, 6am UTC)');
      const voiceSkill = getSkillRegistry().get('voice-pattern-extraction');
      if (!voiceSkill) { console.error('[VoicePatterns] Skill not found in registry'); return; }
      const voiceRuntime = getSkillRuntime();

      const workspacesResult = await query<{ id: string; name: string }>(
        `SELECT w.id, w.name
         FROM workspaces w
         WHERE w.status = 'active'
         ORDER BY w.name`
      );

      for (const workspace of workspacesResult.rows) {
        try {
          await voiceRuntime.executeSkill(voiceSkill, workspace.id, { scopeId: 'default', scopeName: 'All Deals' });
        } catch (err: any) {
          console.error(`[VoicePatterns] Failed for ${workspace.name}:`, err?.message ?? err);
        }
      }

      console.log(`[VoicePatterns] Monthly extraction complete — ${workspacesResult.rows.length} workspace(s) processed`);
    },
    { timezone: 'UTC' }
  );
  scheduledSkills.push({ skillId: 'voice-pattern-extraction', cronExpression: '0 6 1 * *', job: voiceExtractionJob });
  console.log('[VoicePatterns] Cron registered — 6:00 AM UTC on 1st of each month');

  // Quarterly Pre-Mortem: first day of each quarter at 8:00 AM UTC (Jan 1, Apr 1, Jul 1, Oct 1)
  // Reads prior Monday skill outputs, identifies failure modes, and writes standing hypotheses.
  // Also triggerable on-demand via the skill runner.
  const quarterlyPreMortemJob = cron.schedule(
    '0 8 1 1,4,7,10 *',
    async () => {
      console.log('[QuarterlyPreMortem] Quarter-start pre-mortem triggered');
      const preMortemSkill = getSkillRegistry().get('quarterly-pre-mortem');
      if (!preMortemSkill) { console.error('[QuarterlyPreMortem] Skill not found in registry'); return; }
      const preMortemRuntime = getSkillRuntime();

      const workspacesResult = await query<{ id: string; name: string }>(
        `SELECT DISTINCT w.id, w.name
         FROM workspaces w
         INNER JOIN connections c ON c.workspace_id = w.id
         WHERE c.status IN ('connected', 'synced', 'error')
           AND w.status = 'active'
         ORDER BY w.name`
      );

      for (const workspace of workspacesResult.rows) {
        try {
          await preMortemRuntime.executeSkill(preMortemSkill, workspace.id, { scopeId: 'default', scopeName: 'All Deals' });
          console.log(`[QuarterlyPreMortem] ✓ ${workspace.name} (${workspace.id})`);
        } catch (err: any) {
          console.error(`[QuarterlyPreMortem] ✗ ${workspace.name}:`, err.message);
        }
      }

      console.log(`[QuarterlyPreMortem] Complete — ${workspacesResult.rows.length} workspace(s) processed`);
    },
    { timezone: 'UTC' }
  );
  scheduledSkills.push({ skillId: 'quarterly-pre-mortem', cronExpression: '0 8 1 1,4,7,10 *', job: quarterlyPreMortemJob });
  console.log('[QuarterlyPreMortem] Cron registered — 8:00 AM UTC on first day of each quarter');

  // Concierge Slack push: daily 8:15 AM UTC
  // Offset 15 min from pipeline-hygiene (8:00 AM) to avoid queue pressure.
  const conciergePushJob = cron.schedule(
    '15 8 * * *',
    async () => {
      console.log('[Concierge push] Starting daily brief send');
      const { sendConciergeSlackBrief } = await import('../slack/concierge-push.js');

      const workspacesResult = await query<{ id: string; name: string }>(
        `SELECT w.id, w.name
         FROM workspaces w
         INNER JOIN slack_channel_config scc ON scc.workspace_id = w.id
         WHERE w.status = 'active'
         GROUP BY w.id, w.name`
      );

      for (const workspace of workspacesResult.rows) {
        try {
          await sendConciergeSlackBrief(workspace.id);
        } catch (err: any) {
          console.error(`[Concierge push] Failed for ${workspace.name}:`, err?.message ?? err);
        }
      }

      console.log(`[Concierge push] Complete — ${workspacesResult.rows.length} workspace(s) processed`);
    },
    { timezone: 'UTC' }
  );
  scheduledSkills.push({ skillId: 'concierge-slack-push', cronExpression: '15 8 * * *', job: conciergePushJob });
  console.log('[Concierge push] Cron registered — 8:15 AM UTC daily');

  // Weekly digest cron: Monday 9am UTC — investigation summary email/Slack
  const digestJob = cron.schedule(
    '0 9 * * 1',
    async () => {
      console.log('[InvestigationDigest] Monday 9am weekly digest triggered');
      const { generateWeeklyDigest } = await import('../briefing/investigation-digest.js');
      const { formatDigestEmail } = await import('../briefing/digest-email-formatter.js');
      const { formatDigestSlack } = await import('../briefing/digest-slack-formatter.js');
      const { Resend } = await import('resend');
      const { WebClient } = await import('@slack/web-api');

      const workspacesResult = await query<{ id: string; name: string }>(
        `SELECT DISTINCT w.id, w.name
         FROM workspaces w
         INNER JOIN connections c ON c.workspace_id = w.id
         WHERE c.status IN ('connected', 'synced', 'error')
           AND w.status = 'active'
         ORDER BY w.name`
      );

      for (const workspace of workspacesResult.rows) {
        try {
          // Check if digest subscription exists and is enabled
          const subResult = await query<{
            email_recipients: string[];
            slack_channel_id: string | null;
            enabled: boolean;
          }>(
            `SELECT email_recipients, slack_channel_id, enabled
             FROM investigation_digest_subscriptions
             WHERE workspace_id = $1`,
            [workspace.id]
          );

          if (subResult.rows.length === 0 || !subResult.rows[0].enabled) {
            console.log(`[InvestigationDigest] Skipping ${workspace.name} — no active subscription`);
            continue;
          }

          const subscription = subResult.rows[0];
          const hasEmailRecipients = subscription.email_recipients && subscription.email_recipients.length > 0;
          const hasSlackChannel = !!subscription.slack_channel_id;

          if (!hasEmailRecipients && !hasSlackChannel) {
            console.log(`[InvestigationDigest] Skipping ${workspace.name} — no recipients configured`);
            continue;
          }

          // Generate digest
          console.log(`[InvestigationDigest] Generating digest for ${workspace.name}`);
          const digest = await generateWeeklyDigest(workspace.id);

          const deliveryStatus: any = {};

          // Send email using Resend
          if (hasEmailRecipients) {
            try {
              const resendApiKey = process.env.RESEND_API_KEY;
              if (resendApiKey) {
                const resend = new Resend(resendApiKey);
                const { error } = await resend.emails.send({
                  from: process.env.RESEND_FROM_EMAIL || 'Pandora <reports@pandora.app>',
                  to: subscription.email_recipients,
                  subject: `Weekly Investigation Digest — ${workspace.name}`,
                  html: formatDigestEmail(digest),
                });
                if (error) throw new Error(error.message);
                deliveryStatus.email = 'sent';
                console.log(`[InvestigationDigest] ✓ Email sent to ${subscription.email_recipients.join(', ')}`);
              } else {
                deliveryStatus.email = 'failed';
                console.error('[InvestigationDigest] ✗ RESEND_API_KEY not configured');
              }
            } catch (emailErr: any) {
              deliveryStatus.email = 'failed';
              console.error(`[InvestigationDigest] ✗ Email failed for ${workspace.name}:`, emailErr.message);
            }
          }

          // Send to Slack
          if (hasSlackChannel) {
            try {
              // Get Slack bot token
              const slackConfigResult = await query<{ credentials: any }>(
                `SELECT credentials FROM connector_configs
                 WHERE workspace_id = $1 AND connector_type = 'slack' AND status = 'active'
                 LIMIT 1`,
                [workspace.id]
              );

              if (slackConfigResult.rows.length > 0) {
                const credentials = slackConfigResult.rows[0].credentials;
                const token = credentials.botToken || credentials.bot_token || credentials.accessToken || credentials.access_token;

                if (token) {
                  const slackClient = new WebClient(token);
                  await slackClient.chat.postMessage({
                    channel: subscription.slack_channel_id!,
                    blocks: formatDigestSlack(digest),
                    text: `Weekly Investigation Digest — ${workspace.name}`,
                    unfurl_links: false,
                    unfurl_media: false,
                  });
                  deliveryStatus.slack = 'sent';
                  console.log(`[InvestigationDigest] ✓ Slack message sent to ${subscription.slack_channel_id}`);
                } else {
                  deliveryStatus.slack = 'failed';
                  console.error('[InvestigationDigest] ✗ No Slack bot token found');
                }
              } else {
                deliveryStatus.slack = 'failed';
                console.error('[InvestigationDigest] ✗ Slack not connected');
              }
            } catch (slackErr: any) {
              deliveryStatus.slack = 'failed';
              console.error(`[InvestigationDigest] ✗ Slack failed for ${workspace.name}:`, slackErr.message);
            }
          }

          // Update last_sent_at
          await query(
            `UPDATE investigation_digest_subscriptions
             SET last_sent_at = NOW(), updated_at = NOW()
             WHERE workspace_id = $1`,
            [workspace.id]
          );

          // Log to alert history
          await query(
            `INSERT INTO investigation_alert_history (
               workspace_id, skill_id, alert_type, alert_severity,
               alert_channels, delivery_status, metadata, created_at
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            [
              workspace.id,
              'weekly-digest',
              'weekly_digest',
              'info',
              JSON.stringify(Object.keys(deliveryStatus)),
              JSON.stringify(deliveryStatus),
              JSON.stringify({
                periodStart: digest.periodStart,
                periodEnd: digest.periodEnd,
                totalInvestigations: digest.investigations.length,
              }),
            ]
          );

          console.log(`[InvestigationDigest] ✓ ${workspace.name} digest completed`);
        } catch (err: any) {
          console.error(`[InvestigationDigest] ✗ ${workspace.name}:`, err.message);
        }
      }
    },
    { timezone: 'UTC' }
  );
  scheduledSkills.push({ skillId: 'investigation-digest-weekly', cronExpression: '0 9 * * 1', job: digestJob });
  console.log('[InvestigationDigest] Registered weekly digest on cron 0 9 * * 1 (Monday 9am UTC)');

  // Weekly sprint assembly: Monday 8:30am UTC — after all Monday skill runs finish
  const sprintAssemblyJob = cron.schedule(
    '30 8 * * 1',
    async () => {
      console.log('[SprintAssembly] Monday 8:30am UTC — assembling sprint for all workspaces');
      const { assembleWeeklySprint } = await import('../jobs/assemble-weekly-sprint.js');

      const workspacesResult = await query<{ id: string }>(
        `SELECT DISTINCT w.id FROM workspaces w
         INNER JOIN connections c ON c.workspace_id = w.id
         WHERE c.status IN ('connected', 'synced', 'error') AND w.status = 'active'`
      );

      for (const workspace of workspacesResult.rows) {
        try {
          const result = await assembleWeeklySprint(workspace.id);
          console.log(`[SprintAssembly] workspace=${workspace.id} inserted=${result.inserted} updated=${result.updated}`);
        } catch (err) {
          console.error(`[SprintAssembly] Failed for workspace=${workspace.id}:`, err);
        }
      }
    },
    { timezone: 'UTC' }
  );
  scheduledSkills.push({ skillId: 'sprint-assembly-weekly', cronExpression: '30 8 * * 1', job: sprintAssemblyJob });
  console.log('[SprintAssembly] Registered weekly sprint assembly on cron 30 8 * * 1 (Monday 8:30am UTC)');

  // Register scheduled investigations
  const jobQueue = getJobQueue();

  for (const investigation of SCHEDULED_INVESTIGATIONS) {
    const investigationJob = cron.schedule(
      investigation.cronExpression,
      async () => {
        console.log(`[Scheduled Investigations] Running: ${investigation.name}`);

        const workspacesResult = await query<{ id: string; name: string }>(
          `SELECT DISTINCT w.id, w.name
           FROM workspaces w
           INNER JOIN connections c ON c.workspace_id = w.id
           WHERE c.status IN ('connected', 'synced', 'error')
             AND w.status = 'active'
           ORDER BY w.name`
        );

        for (const workspace of workspacesResult.rows) {
          console.log(`[Scheduled Investigations] Queuing ${investigation.skillId} for ${workspace.name}`);

          await jobQueue.createJob({
            workspaceId: workspace.id,
            jobType: 'investigate_skill',
            payload: {
              skillId: investigation.skillId,
              investigationPath: {
                question: investigation.description,
                reasoning: `Scheduled ${investigation.name}`,
                skill_id: investigation.skillId,
                priority: investigation.priority,
              },
              metadata: {
                triggeredFrom: 'scheduled',
                scheduledAt: new Date().toISOString(),
              },
            },
            priority: investigation.priority === 'high' ? 10 : 5,
            maxAttempts: 1,
          });
        }
      },
      { timezone: 'UTC' }
    );

    scheduledSkills.push({
      skillId: `investigation:${investigation.skillId}`,
      cronExpression: investigation.cronExpression,
      job: investigationJob,
    });

    console.log(`[Scheduled Investigations] Registered ${investigation.name} on cron ${investigation.cronExpression}`);
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log(`[Skill Scheduler] Server timezone: ${timezone}`);
  console.log(`[Skill Scheduler] Cron expressions use UTC timezone`);
  console.log(`[Skill Scheduler] ${scheduledSkills.length} cron schedule(s) registered (${agentCronCount} agent(s))`);

  // Summary: skills registered vs scheduled vs on-demand
  const skillRegistrySummary = getSkillRegistry();
  const allRegisteredSkills = skillRegistrySummary.getAll();
  const scheduledSkillCount = allRegisteredSkills.filter(s => s.schedule?.cron).length;
  const onDemandSkillCount = allRegisteredSkills.length - scheduledSkillCount;
  console.log(`[Skill Scheduler] ${allRegisteredSkills.length} skills registered (${scheduledSkillCount} scheduled, ${onDemandSkillCount} on-demand only)`);

  // Load and schedule custom skills from DB
  loadAndScheduleCustomSkills();

  // Load workspace-specific cron overrides for built-in skills
  loadWorkspaceCronOverrides();
}

// ── Account enrichment & scoring cron jobs ────────────────────────────────

// Sunday 2am UTC — refresh stale account enrichments
cron.schedule('0 2 * * 0', async () => {
  console.log('[Skill Scheduler] Running weekly account enrichment batch');
  try {
    const workspacesResult = await query<{ id: string }>(
      `SELECT DISTINCT w.id FROM workspaces w
       INNER JOIN connections c ON c.workspace_id = w.id
       WHERE c.status IN ('connected', 'synced', 'error')
         AND w.status = 'active'`
    );
    for (const ws of workspacesResult.rows) {
      const { runAccountEnrichmentBatch } = await import('../enrichment/account-enrichment-batch.js');
      await runAccountEnrichmentBatch(ws.id, { limit: 200 }).catch(err =>
        console.error('[Skill Scheduler] Account enrichment failed for workspace', ws.id, err)
      );
    }
  } catch (err) {
    console.error('[Skill Scheduler] Account enrichment cron error:', err);
  }
}, { timezone: 'UTC' });

// Daily 3am UTC — refresh scores for accounts with open deals
cron.schedule('0 3 * * *', async () => {
  console.log('[Skill Scheduler] Running daily account scoring pass');
  try {
    const workspacesResult = await query<{ id: string }>(
      `SELECT DISTINCT w.id FROM workspaces w
       INNER JOIN connections c ON c.workspace_id = w.id
       WHERE c.status IN ('connected', 'synced', 'error')
         AND w.status = 'active'`
    );
    for (const ws of workspacesResult.rows) {
      const { runAccountScoringBatch } = await import('../enrichment/account-enrichment-batch.js');
      await runAccountScoringBatch(ws.id, { limit: 500 }).catch(err =>
        console.error('[Skill Scheduler] Account scoring failed for workspace', ws.id, err)
      );
    }
  } catch (err) {
    console.error('[Skill Scheduler] Account scoring cron error:', err);
  }
}, { timezone: 'UTC' });

// Deal score snapshot cron: Sundays 11pm UTC
const snapshotJob = cron.schedule('0 23 * * 0', async () => {
  console.log('[DealScoreSnapshot] Weekly snapshot cron triggered');
  const workspaces = await query<{ id: string; name: string }>(
    `SELECT DISTINCT w.id, w.name FROM workspaces w
     INNER JOIN connections c ON c.workspace_id = w.id
     WHERE c.status IN ('connected','synced','error')
       AND w.status = 'active'
     ORDER BY w.name`
  );
  for (const ws of workspaces.rows) {
    try {
      const result = await runDealScoreSnapshots(ws.id);
      console.log(`[DealScoreSnapshot] ✓ ${ws.name}: ${result.snapped} snapped, ${result.commentaryGenerated} commentaries`);
    } catch (err: any) {
      console.error(`[DealScoreSnapshot] ✗ ${ws.name}:`, err.message);
    }
  }
}, { timezone: 'UTC' });
scheduledSkills.push({ skillId: 'deal-score-snapshot-weekly', cronExpression: '0 23 * * 0', job: snapshotJob });
console.log('[DealScoreSnapshot] Registered weekly deal score snapshot on cron 0 23 * * 0 (Sundays 11pm UTC)');

/**
 * Stop the skill scheduler (graceful shutdown)
 */
export function stopSkillScheduler(): void {
  scheduledSkills.forEach(s => s.job.stop());
  scheduledSkills.length = 0;
  console.log('[Skill Scheduler] Stopped all cron jobs');
}
