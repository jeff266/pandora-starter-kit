/**
 * Report-First Scheduler
 *
 * This REPLACES hardcoded skill cron entries for skills associated with report agents.
 * Skills not associated with any agent continue to use the existing skill-scheduler.ts.
 *
 * Mental model:
 * - Agent = a report you want on a schedule
 * - Skills = infrastructure that feeds the report
 * - Scheduler = derives skill run time automatically from delivery time
 * - Default = skills Sunday 11pm local, delivery Monday 5am local
 */

import cron from 'node-cron';
import { query } from '../db.js';
import { REPORT_SKILL_MAP, type ReportType, DEFAULT_DELIVERY_HOUR, DEFAULT_DELIVERY_DAY, DEFAULT_TIMEZONE } from '../agents/report-skill-map.js';
import { calculateAgentSchedule, type AgentSchedule } from '../agents/schedule-calculator.js';

interface ScheduledAgent {
  agentId: string;
  workspaceId: string;
  reportType: ReportType;
  skillRunJob: cron.ScheduledTask;
  deliveryJob: cron.ScheduledTask;
  schedule: AgentSchedule;
}

const scheduledAgents: ScheduledAgent[] = [];

export async function startReportScheduler(): Promise<void> {
  console.log('[ReportScheduler] Starting...');

  // Load all agents with report_type set
  const agents = await loadSchedulableAgents();

  for (const agent of agents) {
    await scheduleAgent(agent);
  }

  console.log(`[ReportScheduler] Scheduled ${scheduledAgents.length} agents`);

  // Re-check every hour for newly created agents or schedule changes
  cron.schedule('0 * * * *', async () => {
    await refreshSchedules();
  });
}

async function loadSchedulableAgents(): Promise<any[]> {
  const result = await query(`
    SELECT
      a.id,
      a.workspace_id,
      a.report_type,
      a.delivery_hour,
      a.delivery_day_of_week,
      a.delivery_timezone,
      a.is_active,
      COALESCE(w.timezone, $1) as workspace_timezone
    FROM agents a
    JOIN workspaces w ON w.id = a.workspace_id
    WHERE a.report_type IS NOT NULL
      AND a.is_active = true
  `, [DEFAULT_TIMEZONE]);

  return result.rows;
}

async function scheduleAgent(agent: any): Promise<void> {
  const timezone = agent.delivery_timezone ||
                   agent.workspace_timezone ||
                   DEFAULT_TIMEZONE;

  const schedule = calculateAgentSchedule(
    agent.delivery_hour ?? DEFAULT_DELIVERY_HOUR,
    agent.delivery_day_of_week ?? DEFAULT_DELIVERY_DAY,
    timezone
  );

  // Skill run job
  const skillRunJob = cron.schedule(
    schedule.skillRunCron,
    async () => {
      await runSkillsForAgent(agent.id, agent.workspace_id, agent.report_type);
    },
    { timezone: 'UTC' }
  );

  // Delivery job (Orchestrator + channel delivery)
  const deliveryJob = cron.schedule(
    schedule.deliveryCron,
    async () => {
      await triggerAgentDelivery(agent.id, agent.workspace_id);
    },
    { timezone: 'UTC' }
  );

  scheduledAgents.push({
    agentId: agent.id,
    workspaceId: agent.workspace_id,
    reportType: agent.report_type,
    skillRunJob,
    deliveryJob,
    schedule,
  });

  console.log(
    `[ReportScheduler] Agent ${agent.id} (${agent.report_type}): ` +
    schedule.description
  );
}

async function runSkillsForAgent(
  agentId: string,
  workspaceId: string,
  reportType: ReportType
): Promise<void> {
  const requiredSkills = REPORT_SKILL_MAP[reportType];
  if (!requiredSkills?.length) return;

  console.log(
    `[ReportScheduler] Running ${requiredSkills.length} skills ` +
    `for agent ${agentId} (${reportType})`
  );

  // Create agent_run record to track this batch
  const agentRunResult = await query(`
    INSERT INTO agent_runs (agent_id, workspace_id, status, trigger_source, started_at)
    VALUES ($1, $2, 'running', 'scheduled', NOW())
    RETURNING id
  `, [agentId, workspaceId]);

  const agentRunId = agentRunResult.rows[0]?.id;

  // Import skill executor (adapt to match existing pattern)
  const { getSkillRuntime } = await import('../skills/runtime.js');
  const { getSkillRegistry } = await import('../skills/registry.js');

  const runtime = getSkillRuntime();
  const registry = getSkillRegistry();

  let allSucceeded = true;

  for (let i = 0; i < requiredSkills.length; i++) {
    const skillId = requiredSkills[i];

    // Check if this skill already ran recently (within buffer window)
    const recentRun = await query(`
      SELECT id FROM skill_runs
      WHERE workspace_id = $1
        AND skill_id = $2
        AND status = 'completed'
        AND started_at > NOW() - INTERVAL '8 hours'
      LIMIT 1
    `, [workspaceId, skillId]);

    if (recentRun.rows.length > 0) {
      console.log(
        `[ReportScheduler] Skipping ${skillId} — ` +
        `completed within last 8 hours`
      );
      continue;
    }

    // Track in agent_skill_runs
    const trackResult = await query(`
      INSERT INTO agent_skill_runs
        (agent_run_id, workspace_id, skill_id, status, started_at)
      VALUES ($1, $2, $3, 'running', NOW())
      RETURNING id
    `, [agentRunId, workspaceId, skillId]);

    const trackId = trackResult.rows[0]?.id;

    try {
      const skill = registry.get(skillId);
      if (!skill) {
        throw new Error(`Skill ${skillId} not found in registry`);
      }

      const result = await runtime.executeSkill(skill, workspaceId, {});

      // Log to skill_runs table
      await query(
        `INSERT INTO skill_runs (
          run_id, workspace_id, skill_id, status, trigger_source, params,
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
          'scheduled',
          JSON.stringify({ agent_run_id: agentRunId }),
          result.stepData ? JSON.stringify(result.stepData) : null,
          result.output ? JSON.stringify(result.output) : null,
          result.output ? (typeof result.output === 'string' ? result.output : JSON.stringify(result.output)) : null,
          JSON.stringify(result.steps),
          JSON.stringify(result.totalTokenUsage),
          result.totalDuration_ms,
          result.errors && result.errors.length > 0 ? result.errors.map((e: any) => `${e.step}: ${e.error}`).join('; ') : null,
          result.completedAt,
          result.completedAt,
        ]
      );

      await query(`
        UPDATE agent_skill_runs
        SET status = 'completed',
            skill_run_id = $1,
            completed_at = NOW()
        WHERE id = $2
      `, [result.runId, trackId]);

      console.log(`[ReportScheduler] ✓ ${skillId} completed`);

    } catch (err) {
      allSucceeded = false;
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[ReportScheduler] ✗ ${skillId} failed:`, errorMsg);

      await query(`
        UPDATE agent_skill_runs
        SET status = 'failed', completed_at = NOW()
        WHERE id = $1
      `, [trackId]);
    }

    // Stagger: 30s between skills to avoid LLM rate limits
    // Skip delay after last skill
    if (i < requiredSkills.length - 1) {
      await new Promise(r => setTimeout(r, 30_000));
    }
  }

  // Update agent_run status
  await query(`
    UPDATE agent_runs
    SET status = $1, completed_at = NOW()
    WHERE id = $2
  `, [allSucceeded ? 'skills_complete' : 'skills_partial', agentRunId]);

  console.log(
    `[ReportScheduler] Skills batch complete for agent ${agentId}: ` +
    `${allSucceeded ? 'all succeeded' : 'some failed'}`
  );
}

async function triggerAgentDelivery(
  agentId: string,
  workspaceId: string
): Promise<void> {
  console.log(
    `[ReportScheduler] Triggering delivery for agent ${agentId}`
  );

  // Find the most recent skills_complete agent_run for this agent
  const agentRun = await query(`
    SELECT id FROM agent_runs
    WHERE agent_id = $1
      AND workspace_id = $2
      AND status IN ('skills_complete', 'skills_partial')
      AND started_at > NOW() - INTERVAL '12 hours'
    ORDER BY started_at DESC
    LIMIT 1
  `, [agentId, workspaceId]);

  if (!agentRun.rows.length) {
    console.warn(
      `[ReportScheduler] No completed skill run found for agent ` +
      `${agentId} — skipping delivery`
    );
    return;
  }

  // Call executeAgent() — the existing runtime handles
  // Orchestrator + delivery from here
  // Pass agent_run_id so Orchestrator knows which skill evidence to use
  const { getAgentRuntime } = await import('../agents/runtime.js');

  const runtime = getAgentRuntime();

  await runtime.executeAgent(agentId, workspaceId, {
    triggerType: 'scheduled',
    // TODO: Pass agent_run_id and skip_skill_execution options when runtime supports it
  });
}

async function refreshSchedules(): Promise<void> {
  // Stop all existing jobs
  for (const sa of scheduledAgents) {
    sa.skillRunJob.stop();
    sa.deliveryJob.stop();
  }
  scheduledAgents.length = 0;

  // Reload and reschedule
  const agents = await loadSchedulableAgents();
  for (const agent of agents) {
    await scheduleAgent(agent);
  }

  console.log(
    `[ReportScheduler] Refreshed — ` +
    `${scheduledAgents.length} agents scheduled`
  );
}

export function stopReportScheduler(): void {
  for (const sa of scheduledAgents) {
    sa.skillRunJob.stop();
    sa.deliveryJob.stop();
  }
  scheduledAgents.length = 0;
  console.log('[ReportScheduler] Stopped');
}

/**
 * Manual trigger for testing the full flow without waiting for schedule
 */
export async function triggerAgentRunNow(
  agentId: string,
  workspaceId: string,
  phase: 'skills' | 'delivery' | 'both'
): Promise<{ agent_run_id: string; phase: string; status: string }> {
  // Get agent's report type
  const agentResult = await query(`
    SELECT report_type FROM agents
    WHERE id = $1 AND workspace_id = $2
  `, [agentId, workspaceId]);

  if (!agentResult.rows.length) {
    throw new Error('Agent not found');
  }

  const reportType = agentResult.rows[0].report_type;

  if (phase === 'skills' || phase === 'both') {
    await runSkillsForAgent(agentId, workspaceId, reportType);
  }

  if (phase === 'delivery' || phase === 'both') {
    // If we just ran skills, wait a moment for them to settle
    if (phase === 'both') {
      await new Promise(r => setTimeout(r, 2000));
    }
    await triggerAgentDelivery(agentId, workspaceId);
  }

  // Get the agent_run_id
  const runResult = await query(`
    SELECT id FROM agent_runs
    WHERE agent_id = $1 AND workspace_id = $2
    ORDER BY started_at DESC
    LIMIT 1
  `, [agentId, workspaceId]);

  return {
    agent_run_id: runResult.rows[0]?.id || '',
    phase,
    status: 'running',
  };
}
