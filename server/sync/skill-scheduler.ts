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
  triggerType: 'scheduled' | 'manual_batch',
  scope?: ActiveScope
): Promise<{ success: boolean; runId?: string; duration_ms?: number; error?: string }> {
  const startTime = Date.now();

  try {
    // Check per-workspace schedule override — skip if disabled
    const overrideResult = await query<{ enabled: boolean }>(
      `SELECT enabled FROM skill_schedules WHERE workspace_id = $1 AND skill_id = $2`,
      [workspaceId, skill.id]
    ).catch(() => ({ rows: [] as { enabled: boolean }[] }));
    if (overrideResult.rows.length > 0 && overrideResult.rows[0].enabled === false) {
      console.log(`[Skill Scheduler] Skipping ${skill.id} for workspace ${workspaceId} (disabled by workspace override)`);
      return { success: false, error: 'Skill disabled for this workspace' };
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
  triggerType: 'scheduled' | 'manual_batch' = 'scheduled',
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
          agentRuntime.executeAgent(agentId, workspace.id)
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

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log(`[Skill Scheduler] Server timezone: ${timezone}`);
  console.log(`[Skill Scheduler] Cron expressions use UTC timezone`);
  console.log(`[Skill Scheduler] ${scheduledSkills.length} cron schedule(s) registered (${agentCronCount} agent(s))`);
}

// ── Account enrichment & scoring cron jobs ────────────────────────────────

// Sunday 2am UTC — refresh stale account enrichments
cron.schedule('0 2 * * 0', async () => {
  console.log('[Skill Scheduler] Running weekly account enrichment batch');
  try {
    const workspacesResult = await query<{ id: string }>(
      `SELECT DISTINCT w.id FROM workspaces w
       INNER JOIN connections c ON c.workspace_id = w.id
       WHERE c.status IN ('connected', 'synced', 'error')`
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
       WHERE c.status IN ('connected', 'synced', 'error')`
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
     WHERE c.status IN ('connected','synced','error') ORDER BY w.name`
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
