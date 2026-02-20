import { Router, type Request, type Response } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { query as dbQuery } from '../db.js';
import { getSkillRegistry } from '../skills/registry.js';
import { getAgentRegistry } from '../agents/registry.js';
import { runScheduledSkills } from '../sync/skill-scheduler.js';
import { createHash } from 'crypto';

const router = Router();

interface WorkspaceParams {
  workspaceId: string;
}

interface DerivedPlaybook {
  id: string;
  name: string;
  description: string;
  schedule: string;
  cronExpression: string;
  skills: string[];
  agents: string[];
  status: 'active';
}

const CRON_NAME_MAP: Record<string, { name: string; schedule: string }> = {
  '0 16 * * 5': { name: 'Friday Recap', schedule: 'Every Friday at 4:00 PM UTC' },
  '0 8 * * 1': { name: 'Monday Pipeline Review', schedule: 'Every Monday at 8:00 AM UTC' },
  '0 7 * * 1': { name: 'Monday Morning Scoring', schedule: 'Every Monday at 7:00 AM UTC' },
  '0 6 1 * *': { name: 'Monthly ICP Discovery', schedule: '1st of every month at 6:00 AM UTC' },
  '0 7 1,15 * *': { name: 'Bi-Monthly Config Audit', schedule: '1st & 15th at 7:00 AM UTC' },
  '0 7 * * 1,4': { name: 'Weekly Attainment Check', schedule: 'Mon & Thu at 7:00 AM UTC' },
  '0 9 * * 3': { name: 'Midweek Strategy', schedule: 'Every Wednesday at 9:00 AM UTC' },
};

function cronToId(cronExpression: string): string {
  return createHash('sha256').update(cronExpression).digest('hex').slice(0, 12);
}

function cronToName(cronExpression: string): { name: string; schedule: string } {
  const mapped = CRON_NAME_MAP[cronExpression];
  if (mapped) return mapped;
  return {
    name: `Scheduled Group (${cronExpression})`,
    schedule: cronExpression,
  };
}

function derivePlaybooks(): DerivedPlaybook[] {
  const registry = getSkillRegistry();
  const agentRegistry = getAgentRegistry();
  const allSkills = registry.getAll();
  const allAgents = agentRegistry.list();

  const cronGroups = new Map<string, { skills: string[]; agents: string[] }>();

  for (const skill of allSkills) {
    if (skill.schedule?.cron) {
      const cron = skill.schedule.cron;
      if (!cronGroups.has(cron)) {
        cronGroups.set(cron, { skills: [], agents: [] });
      }
      cronGroups.get(cron)!.skills.push(skill.id);
    }
  }

  for (const agent of allAgents) {
    if (agent.enabled && agent.trigger.type === 'cron' && agent.trigger.cron) {
      const cron = agent.trigger.cron;
      if (!cronGroups.has(cron)) {
        cronGroups.set(cron, { skills: [], agents: [] });
      }
      cronGroups.get(cron)!.agents.push(agent.id);
    }
  }

  const playbooks: DerivedPlaybook[] = [];

  for (const [cronExpression, group] of cronGroups.entries()) {
    const { name, schedule } = cronToName(cronExpression);
    playbooks.push({
      id: cronToId(cronExpression),
      name,
      description: `Automated playbook running ${group.skills.length} skill(s) and ${group.agents.length} agent(s) on schedule: ${schedule}`,
      schedule,
      cronExpression,
      skills: group.skills,
      agents: group.agents,
      status: 'active',
    });
  }

  return playbooks;
}

router.get('/:workspaceId/playbooks', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const playbooks = derivePlaybooks();

    const enriched = await Promise.all(playbooks.map(async (playbook) => {
      if (playbook.skills.length === 0) {
        return {
          ...playbook,
          lastRun: null,
          nextRun: null,
          stats: { totalRuns: 0, totalFindings: 0, totalActions: 0 },
        };
      }

      const placeholders = playbook.skills.map((_, i) => `$${i + 2}`).join(', ');

      const lastRunResult = await dbQuery(
        `SELECT skill_id, run_id, status, started_at, completed_at, duration_ms
         FROM skill_runs
         WHERE workspace_id = $1 AND skill_id IN (${placeholders})
         ORDER BY started_at DESC
         LIMIT ${playbook.skills.length}`,
        [workspaceId, ...playbook.skills]
      );

      const runsCountResult = await dbQuery(
        `SELECT COUNT(*) as total FROM skill_runs
         WHERE workspace_id = $1 AND skill_id IN (${placeholders})`,
        [workspaceId, ...playbook.skills]
      );

      const findingsCountResult = await dbQuery(
        `SELECT COUNT(*) as total FROM findings
         WHERE workspace_id = $1 AND source_skill IN (${placeholders})`,
        [workspaceId, ...playbook.skills]
      );

      const actionsCountResult = await dbQuery(
        `SELECT COUNT(*) as total FROM actions
         WHERE workspace_id = $1 AND source_skill IN (${placeholders})`,
        [workspaceId, ...playbook.skills]
      );

      const lastRun = lastRunResult.rows.length > 0 ? lastRunResult.rows[0] : null;

      return {
        ...playbook,
        lastRun: lastRun ? {
          runId: lastRun.run_id,
          skillId: lastRun.skill_id,
          status: lastRun.status,
          startedAt: lastRun.started_at,
          completedAt: lastRun.completed_at,
          durationMs: lastRun.duration_ms,
        } : null,
        nextRun: null,
        stats: {
          totalRuns: parseInt(runsCountResult.rows[0].total),
          totalFindings: parseInt(findingsCountResult.rows[0].total),
          totalActions: parseInt(actionsCountResult.rows[0].total),
        },
      };
    }));

    res.json({ playbooks: enriched });
  } catch (err) {
    console.error('[Playbooks API]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/:workspaceId/playbooks/:playbookId', async (req: Request<WorkspaceParams & { playbookId: string }>, res: Response) => {
  try {
    const { workspaceId, playbookId } = req.params;
    const playbooks = derivePlaybooks();
    const playbook = playbooks.find(p => p.id === playbookId);

    if (!playbook) {
      return res.status(404).json({ error: 'Playbook not found' });
    }

    const skillRuns: Record<string, any[]> = {};

    if (playbook.skills.length > 0) {
      const placeholders = playbook.skills.map((_, i) => `$${i + 2}`).join(', ');

      const runsResult = await dbQuery(
        `SELECT run_id, skill_id, status, started_at, completed_at, duration_ms, trigger_type, token_usage
         FROM skill_runs
         WHERE workspace_id = $1 AND skill_id IN (${placeholders})
         ORDER BY started_at DESC`,
        [workspaceId, ...playbook.skills]
      );

      for (const row of runsResult.rows) {
        if (!skillRuns[row.skill_id]) {
          skillRuns[row.skill_id] = [];
        }
        if (skillRuns[row.skill_id].length < 10) {
          skillRuns[row.skill_id].push(row);
        }
      }
    }

    let recentFindings: any[] = [];
    let recentActions: any[] = [];
    let totalRuns = 0;
    let totalFindings = 0;
    let totalActions = 0;

    if (playbook.skills.length > 0) {
      const placeholders = playbook.skills.map((_, i) => `$${i + 2}`).join(', ');

      const findingsResult = await dbQuery(
        `SELECT id, source_skill, source_run_id, title, severity, created_at
         FROM findings
         WHERE workspace_id = $1 AND source_skill IN (${placeholders})
         ORDER BY created_at DESC
         LIMIT 50`,
        [workspaceId, ...playbook.skills]
      );
      recentFindings = findingsResult.rows;

      const actionsResult = await dbQuery(
        `SELECT id, source_skill, source_run_id, title, severity, execution_status, created_at
         FROM actions
         WHERE workspace_id = $1 AND source_skill IN (${placeholders})
         ORDER BY created_at DESC
         LIMIT 50`,
        [workspaceId, ...playbook.skills]
      );
      recentActions = actionsResult.rows;

      const runsCountResult = await dbQuery(
        `SELECT COUNT(*) as total FROM skill_runs
         WHERE workspace_id = $1 AND skill_id IN (${placeholders})`,
        [workspaceId, ...playbook.skills]
      );
      totalRuns = parseInt(runsCountResult.rows[0].total);

      const findingsCountResult = await dbQuery(
        `SELECT COUNT(*) as total FROM findings
         WHERE workspace_id = $1 AND source_skill IN (${placeholders})`,
        [workspaceId, ...playbook.skills]
      );
      totalFindings = parseInt(findingsCountResult.rows[0].total);

      const actionsCountResult = await dbQuery(
        `SELECT COUNT(*) as total FROM actions
         WHERE workspace_id = $1 AND source_skill IN (${placeholders})`,
        [workspaceId, ...playbook.skills]
      );
      totalActions = parseInt(actionsCountResult.rows[0].total);
    }

    res.json({
      playbook,
      skillRuns,
      recentFindings,
      recentActions,
      stats: { totalRuns, totalFindings, totalActions },
    });
  } catch (err) {
    console.error('[Playbooks API]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/:workspaceId/playbooks/:playbookId/run', async (req: Request<WorkspaceParams & { playbookId: string }>, res: Response) => {
  try {
    const { workspaceId, playbookId } = req.params;
    const playbooks = derivePlaybooks();
    const playbook = playbooks.find(p => p.id === playbookId);

    if (!playbook) {
      return res.status(404).json({ error: 'Playbook not found' });
    }

    if (playbook.skills.length === 0) {
      return res.status(400).json({ error: 'Playbook has no skills to run' });
    }

    const results = await runScheduledSkills(workspaceId, playbook.skills, 'manual_batch');

    res.json({
      success: results.every(r => r.success),
      results,
    });
  } catch (err) {
    console.error('[Playbooks API]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
