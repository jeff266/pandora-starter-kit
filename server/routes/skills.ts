import { Router } from 'express';
import { getSkillRegistry } from '../skills/registry.js';
import { getSkillRuntime } from '../skills/runtime.js';
import {
  formatForSlack,
  buildActionButtons,
  buildPerActionButtons,
  extractTextFromBlocks,
  validateSlackOutput,
  formatDataQualityAlert,
} from '../skills/formatters/slack-formatter.js';
import { formatAsMarkdown } from '../skills/formatters/markdown-formatter.js';
import { getSlackWebhook, postBlocks } from '../connectors/slack/client.js';
import { getSlackAppClient } from '../connectors/slack/slack-app-client.js';
import { query } from '../db.js';
import { runScheduledSkills, updateWorkspaceSkillCron } from '../sync/skill-scheduler.js';
import { generateWorkbook } from '../delivery/workbook-generator.js';
import type { SkillResult } from '../skills/types.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { logChatMessage } from '../lib/chat-logger.js';
import { trackPandoraPost } from '../slack/thread-tracker.js';
import { buildConversationHistory } from '../lib/conversation-history.js';
import type { HistoryTurn } from '../lib/conversation-history.js';
import { randomUUID } from 'crypto';
import { probeBehavioralDataTier, extractBehavioralMilestones } from '../skills/compute/behavioral-milestones.js';
import { getStageTranscriptCoverage } from '../analysis/stage-history-queries.js';

const router = Router();

function inferPipelineType(pipelineName: string): 'new_business' | 'renewal' | 'expansion' {
  const name = pipelineName.toLowerCase();
  if (name.includes('renew') || name.includes('retention')) return 'renewal';
  if (name.includes('expan') || name.includes('upsell') || name.includes('cross')) return 'expansion';
  return 'new_business';
}

async function handleSkillRun(workspaceId: string, skillId: string, params: any, res: any) {
  const ws = await query('SELECT id, name FROM workspaces WHERE id = $1', [workspaceId]);
  if (ws.rows.length === 0) {
    return res.status(404).json({ error: 'Workspace not found' });
  }

  const registry = getSkillRegistry();
  const skill = registry.get(skillId);
  if (!skill) {
    return res.status(404).json({ error: `Skill not found: ${skillId}` });
  }

  const runtime = getSkillRuntime();

  let result: SkillResult;
  try {
    result = await runtime.executeSkill(skill, workspaceId, params);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: `Skill execution failed: ${errorMsg}` });
  }

  try {
    await query(
      `INSERT INTO skill_runs (run_id, workspace_id, skill_id, status, trigger_type, params, result, output, output_text, steps, token_usage, duration_ms, error, started_at, completed_at)
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
        skillId,
        result.status,
        'manual',
        JSON.stringify(params || {}),
        result.stepData ? JSON.stringify(result.stepData) : (result.output ? JSON.stringify(result.output) : null),
        result.output ? JSON.stringify({
          ...(typeof result.output === 'string' ? { narrative: result.output } : result.output),
          ...(result.evidence ? { evidence: result.evidence } : {}),
          ...((result as any).annotations ? { annotations: (result as any).annotations } : {}),
          ...((result as any).annotationsMetadata ? { annotations_metadata: (result as any).annotationsMetadata } : {}),
        }) : null,
        typeof result.output === 'string' ? result.output
          : (result.output && typeof result.output === 'object' && typeof (result.output as any).report === 'string') ? (result.output as any).report
          : (result.output && typeof result.output === 'object' && typeof (result.output as any).narrative === 'string') ? (result.output as any).narrative
          : result.output ? JSON.stringify(result.output) : null,
        JSON.stringify(result.steps),
        JSON.stringify(result.totalTokenUsage),
        result.totalDuration_ms,
        result.errors && result.errors.length > 0 ? result.errors.map(e => `${e.step}: ${e.error}`).join('; ') : null,
        result.completedAt,
        result.completedAt,
      ]
    );
  } catch (logErr) {
    console.error('[skills] Failed to log skill run:', logErr);
  }

  if (skill.outputFormat === 'slack') {
    const isSnoozed = await checkSnooze(workspaceId, skillId);
    if (isSnoozed) {
      console.log(`[skills] Skill ${skillId} is snoozed for workspace ${workspaceId}, skipping Slack post`);
    } else {
      await postSkillToSlack(workspaceId, skillId, result);
    }
  }

  const outputPreview = typeof result.output === 'string'
    ? result.output.slice(0, 500)
    : result.output
      ? JSON.stringify(result.output).slice(0, 500)
      : null;

  return res.json({
    runId: result.runId,
    status: result.status,
    duration_ms: result.totalDuration_ms,
    output_preview: outputPreview,
  });
}

router.post('/skills/:skillId/run', requireAuth, async (req, res) => {
  try {
    const { skillId } = req.params;
    const { workspaceId, params } = req.body || {};
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId is required in request body' });
    }
    if (req.workspace && req.workspace.id !== workspaceId) {
      return res.status(403).json({ error: 'API key does not have access to this workspace' });
    }
    return await handleSkillRun(workspaceId as string, skillId as string, params, res);
  } catch (err) {
    console.error('[skills] Error running skill:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:workspaceId/skills/:skillId/run', requirePermission('skills.run_manual'), async (req, res) => {
  try {
    const { workspaceId, skillId } = req.params;
    const { params } = req.body || {};
    return await handleSkillRun(workspaceId as string, skillId as string, params, res);
  } catch (err) {
    console.error('[skills] Error running skill:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:workspaceId/skills/dashboard', async (req, res) => {
  try {
    const { workspaceId } = req.params;

    const ws = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (ws.rows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const registry = getSkillRegistry();
    const skills = registry.getAll().filter(s => !s.isUtility);

    // Fetch last runs
    const lastRuns = await query<{
      skill_id: string;
      created_at: string;
      status: string;
      duration_ms: number | null;
    }>(
      `SELECT DISTINCT ON (skill_id) skill_id, created_at, status, duration_ms
       FROM skill_runs
       WHERE workspace_id = $1
       ORDER BY skill_id, created_at DESC`,
      [workspaceId]
    );

    const lastRunMap = new Map<string, { at: string; status: string; duration: number | null }>();
    for (const row of lastRuns.rows) {
      lastRunMap.set(row.skill_id, { at: row.created_at, status: row.status, duration: row.duration_ms });
    }

    // Fetch 30d stats
    const stats30d = await query<{
      skill_id: string;
      runs_count: string;
      avg_duration: string;
      avg_tokens: string;
      success_count: string;
    }>(
      `SELECT 
         skill_id, 
         COUNT(*)::text as runs_count,
         AVG(duration_ms)::text as avg_duration,
         AVG((token_usage->>'total')::int)::text as avg_tokens,
         COUNT(*) FILTER (WHERE status = 'completed')::text as success_count
       FROM skill_runs
       WHERE workspace_id = $1 AND started_at >= NOW() - INTERVAL '30 days'
       GROUP BY skill_id`,
      [workspaceId]
    );

    const statsMap = new Map<string, any>();
    for (const row of stats30d.rows) {
      const runs = parseInt(row.runs_count, 10);
      const success = parseInt(row.success_count, 10);
      statsMap.set(row.skill_id, {
        runs30d: runs,
        avgDurationMs: Math.round(parseFloat(row.avg_duration || '0')),
        avgTokens: Math.round(parseFloat(row.avg_tokens || '0')),
        successRate: runs > 0 ? Math.round((success / runs) * 100) : 0
      });
    }

    // Fetch open findings counts
    const findingsCounts = await query<{
      skill_id: string;
      cnt: string;
    }>(
      `SELECT skill_id, COUNT(*)::text as cnt
       FROM findings
       WHERE workspace_id = $1 AND resolved_at IS NULL
       GROUP BY skill_id`,
      [workspaceId]
    );

    const findingsMap = new Map<string, number>();
    for (const row of findingsCounts.rows) {
      findingsMap.set(row.skill_id, parseInt(row.cnt, 10));
    }

    // Schedule overrides
    const scheduleOverrides = await query<{ skill_id: string; cron: string | null; enabled: boolean }>(
      `SELECT skill_id, cron, enabled FROM skill_schedules WHERE workspace_id = $1`,
      [workspaceId]
    ).catch(() => ({ rows: [] as { skill_id: string; cron: string | null; enabled: boolean }[] }));
    
    const overrideMap = new Map<string, { cron: string | null; enabled: boolean }>();
    for (const row of scheduleOverrides.rows) {
      overrideMap.set(row.skill_id, { cron: row.cron, enabled: row.enabled });
    }

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const skillsWithStats = skills.map(s => {
      const last = lastRunMap.get(s.id);
      const stats = statsMap.get(s.id) || { runs30d: 0, avgDurationMs: 0, avgTokens: 0, successRate: 0 };
      const findingsCount = findingsMap.get(s.id) || 0;
      const override = overrideMap.get(s.id);
      const baseSchedule = s.schedule || {};

      let status: 'healthy' | 'warning' | 'stale' = 'stale';
      if (last?.at) {
        const lastRunDate = new Date(last.at);
        if (lastRunDate >= weekAgo) status = 'healthy';
        else if (lastRunDate >= twoWeeksAgo) status = 'warning';
      }

      return {
        id: s.id,
        name: s.name,
        category: s.category,
        description: s.description,
        isCustom: (s as any).isCustom ?? false,
        schedule: {
          ...baseSchedule,
          cron: override !== undefined ? (override.cron ?? null) : (baseSchedule.cron ?? null),
          enabled: override !== undefined ? override.enabled : true,
        },
        lastRunAt: last?.at || null,
        lastRunStatus: last?.status || null,
        status,
        stats: {
          ...stats,
          findingsCount
        }
      };
    });

    const summary = {
      totalSkills: skillsWithStats.length,
      activeSkills: skillsWithStats.filter(s => s.status === 'healthy').length,
      staleSkills: skillsWithStats.filter(s => s.status === 'stale').length,
      totalRuns30d: Array.from(statsMap.values()).reduce((sum, s) => sum + s.runs30d, 0),
      totalFindings: Array.from(findingsMap.values()).reduce((sum, count) => sum + count, 0)
    };

    return res.json({
      skills: skillsWithStats,
      summary
    });
  } catch (err) {
    console.error('[skills] Dashboard failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:workspaceId/skills', async (req, res) => {
  try {
    const { workspaceId } = req.params;

    const ws = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (ws.rows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const registry = getSkillRegistry();
    const skills = registry.getAll().filter(s => !s.isUtility);

    const lastRuns = await query<{
      skill_id: string;
      created_at: string;
      status: string;
      duration_ms: number | null;
    }>(
      `SELECT DISTINCT ON (skill_id) skill_id, created_at, status, duration_ms
       FROM skill_runs
       WHERE workspace_id = $1
       ORDER BY skill_id, created_at DESC`,
      [workspaceId]
    );

    const lastRunMap = new Map<string, { at: string; status: string; duration: number | null }>();
    for (const row of lastRuns.rows) {
      lastRunMap.set(row.skill_id, { at: row.created_at, status: row.status, duration: row.duration_ms });
    }

    // Fetch findings counts for each skill's most recent completed run
    const findingsCounts = await query<{
      skill_id: string;
      severity: string;
      cnt: string;
    }>(
      `SELECT sr.skill_id, f.severity, COUNT(*)::text AS cnt
       FROM findings f
       JOIN skill_runs sr ON f.source_run_id = sr.run_id AND f.workspace_id = sr.workspace_id
       WHERE sr.workspace_id = $1
         AND sr.created_at = (
           SELECT MAX(sr2.created_at) FROM skill_runs sr2
           WHERE sr2.workspace_id = sr.workspace_id AND sr2.skill_id = sr.skill_id AND sr2.status = 'completed'
         )
         AND f.status = 'open'
       GROUP BY sr.skill_id, f.severity`,
      [workspaceId]
    ).catch(() => ({ rows: [] as { skill_id: string; severity: string; cnt: string }[] }));

    const findingsMap = new Map<string, Record<string, number>>();
    for (const row of findingsCounts.rows) {
      if (!findingsMap.has(row.skill_id)) findingsMap.set(row.skill_id, {});
      const alias = row.severity === 'critical' ? 'act' : row.severity === 'warning' ? 'watch' : row.severity === 'info' ? 'notable' : row.severity;
      findingsMap.get(row.skill_id)![alias] = parseInt(row.cnt, 10);
    }

    // Load per-workspace schedule overrides
    const scheduleOverrides = await query<{ skill_id: string; cron: string | null; enabled: boolean }>(
      `SELECT skill_id, cron, enabled FROM skill_schedules WHERE workspace_id = $1`,
      [workspaceId]
    ).catch(() => ({ rows: [] as { skill_id: string; cron: string | null; enabled: boolean }[] }));
    const overrideMap = new Map<string, { cron: string | null; enabled: boolean }>();
    for (const row of scheduleOverrides.rows) {
      overrideMap.set(row.skill_id, { cron: row.cron, enabled: row.enabled });
    }

    const result = skills.map(s => {
      const last = lastRunMap.get(s.id);
      const override = overrideMap.get(s.id);
      const baseSchedule = s.schedule || {};
      return {
        id: s.id,
        name: s.name,
        description: s.description,
        category: s.category,
        tier: s.tier,
        schedule: {
          ...baseSchedule,
          cron: override !== undefined ? (override.cron ?? null) : (baseSchedule.cron ?? null),
          enabled: override !== undefined ? override.enabled : true,
        },
        lastRunAt: last?.at || null,
        lastRunStatus: last?.status || null,
        lastRunDuration: last?.duration || null,
        lastRunFindings: findingsMap.get(s.id) || null,
      };
    });

    return res.json(result);
  } catch (err) {
    console.error('[skills] Error listing skills:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:workspaceId/skills/:skillId/schedule', requirePermission('skills.configure'), async (req, res) => {
  try {
    const { workspaceId, skillId } = req.params;
    const { cron: cronExpr } = req.body || {};

    const registry = getSkillRegistry();
    if (!registry.get(skillId)) {
      return res.status(404).json({ error: `Skill not found: ${skillId}` });
    }

    const existing = await query(
      `SELECT cron, enabled FROM skill_schedules WHERE workspace_id = $1 AND skill_id = $2`,
      [workspaceId, skillId]
    );
    const previousSnapshot = existing.rows[0] ?? null;

    if (cronExpr !== null && cronExpr !== undefined) {
      await query(
        `INSERT INTO skill_schedules (workspace_id, skill_id, cron, enabled, updated_at)
         VALUES ($1, $2, $3, false, NOW())
         ON CONFLICT (workspace_id, skill_id) DO UPDATE SET
           cron = EXCLUDED.cron,
           enabled = false,
           updated_at = NOW()`,
        [workspaceId, skillId, cronExpr]
      );
      updateWorkspaceSkillCron(workspaceId, skillId, cronExpr);
    } else {
      await query(
        `INSERT INTO skill_schedules (workspace_id, skill_id, cron, enabled, updated_at)
         VALUES ($1, $2, null, false, NOW())
         ON CONFLICT (workspace_id, skill_id) DO UPDATE SET
           cron = null,
           enabled = false,
           updated_at = NOW()`,
        [workspaceId, skillId]
      );
      updateWorkspaceSkillCron(workspaceId, skillId, null);
    }

    await query(
      `INSERT INTO skill_governance (
        workspace_id, source_type, change_type, change_description,
        change_payload, supersedes_snapshot, status, deployed_at, deployed_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)`,
      [
        workspaceId,
        'manual',
        'skill_schedule',
        cronExpr ? 'Schedule updated via UI' : 'Schedule set to on-demand',
        JSON.stringify({ skill_id: skillId, cron: cronExpr ?? null }),
        previousSnapshot ? JSON.stringify(previousSnapshot) : null,
        'deployed',
        (req as any).user?.user_id ?? 'admin',
      ]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('[skills] Error saving schedule (PUT):', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:workspaceId/skills/:skillId/schedule', requirePermission('skills.configure'), async (req, res) => {
  try {
    const { workspaceId, skillId } = req.params;
    const { cron: cronExpr, enabled } = req.body || {};

    const registry = getSkillRegistry();
    if (!registry.get(skillId)) {
      return res.status(404).json({ error: `Skill not found: ${skillId}` });
    }

    const existing = await query(
      `SELECT cron, enabled FROM skill_schedules WHERE workspace_id = $1 AND skill_id = $2`,
      [workspaceId, skillId]
    );
    const previousSnapshot = existing.rows[0] ?? null;

    // Determine DB values
    // - cron + enabled=false → workspace-specific schedule (global scheduler skips, ws cron fires)
    // - cron=null + enabled=false → on-demand only (no automatic runs)
    // - cron=null + enabled=true → reset to system default (delete override row)
    const isReset = !cronExpr && enabled !== false;

    if (isReset) {
      await query(
        `DELETE FROM skill_schedules WHERE workspace_id = $1 AND skill_id = $2`,
        [workspaceId, skillId]
      );
      updateWorkspaceSkillCron(workspaceId, skillId, null);
    } else {
      const dbCron = cronExpr ?? null;
      const dbEnabled = cronExpr ? false : (enabled ?? false);

      await query(
        `INSERT INTO skill_schedules (workspace_id, skill_id, cron, enabled, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (workspace_id, skill_id) DO UPDATE SET
           cron = EXCLUDED.cron,
           enabled = EXCLUDED.enabled,
           updated_at = NOW()`,
        [workspaceId, skillId, dbCron, dbEnabled]
      );

      // Live-update the workspace cron job (register custom, or remove if on-demand)
      updateWorkspaceSkillCron(workspaceId, skillId, dbCron);
    }

    await query(
      `INSERT INTO skill_governance (
        workspace_id, source_type, change_type, change_description,
        change_payload, supersedes_snapshot, status, deployed_at, deployed_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)`,
      [
        workspaceId,
        'manual',
        'skill_schedule',
        isReset ? 'Schedule reset to system default' : 'Schedule updated via UI',
        JSON.stringify({ skill_id: skillId, cron: cronExpr ?? null, enabled }),
        previousSnapshot ? JSON.stringify(previousSnapshot) : null,
        'deployed',
        (req as any).user?.user_id ?? 'admin',
      ]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('[skills] Error saving schedule:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:workspaceId/skills/:skillId/runs', async (req, res) => {
  try {
    const { workspaceId, skillId } = req.params;
    const limit = parseInt(req.query.limit as string) || 20;

    const result = await query(
      `SELECT id, run_id, skill_id, status, trigger_type, duration_ms, token_usage, error, started_at, completed_at, created_at
       FROM skill_runs
       WHERE workspace_id = $1 AND skill_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [workspaceId, skillId, limit]
    );

    return res.json(result.rows.map(row => ({
      runId: row.run_id || row.id,
      status: row.status,
      triggerType: row.trigger_type,
      duration_ms: row.duration_ms,
      tokenUsage: row.token_usage,
      error: row.error,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
    })));
  } catch (err) {
    console.error('[skills] Error listing skill runs:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:workspaceId/skills/:skillId/history', async (req, res) => {
  try {
    const { workspaceId, skillId } = req.params;

    const result = await query(
      `SELECT
         id,
         change_description,
         change_payload,
         supersedes_snapshot,
         deployed_at,
         deployed_by,
         status
       FROM skill_governance
       WHERE
         workspace_id = $1
         AND change_type = 'skill_schedule'
         AND change_payload->>'skill_id' = $2
       ORDER BY deployed_at DESC
       LIMIT 50`,
      [workspaceId, skillId]
    );

    return res.json({
      history: result.rows.map(row => ({
        id: row.id,
        change_description: row.change_description,
        change_payload: row.change_payload,
        supersedes_snapshot: row.supersedes_snapshot,
        deployed_at: row.deployed_at,
        deployed_by: row.deployed_by,
        status: row.status,
      })),
    });
  } catch (err) {
    console.error('[skills] Error fetching skill history:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:workspaceId/skills/:skillId/runs/:runId', async (req, res) => {
  try {
    const { workspaceId, skillId, runId } = req.params;

    const result = await query(
      `SELECT * FROM skill_runs
       WHERE workspace_id = $1 AND skill_id = $2 AND (run_id = $3 OR id::text = $3::text)`,
      [workspaceId, skillId, runId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Skill run not found' });
    }

    const row = result.rows[0];
    return res.json({
      runId: row.run_id || row.id,
      skillId: row.skill_id,
      workspaceId: row.workspace_id,
      status: row.status,
      triggerType: row.trigger_type,
      params: row.params,
      result: row.result,
      output: row.output,
      outputText: row.output_text,
      steps: row.steps,
      tokenUsage: row.token_usage,
      duration_ms: row.duration_ms,
      error: row.error,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
    });
  } catch (err) {
    console.error('[skills] Error fetching skill run:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/workspaces/:workspaceId/skills/run-all
 * Run all (or filtered) skills for a workspace in staggered sequence
 */
router.post('/:workspaceId/skills/run-all', requirePermission('skills.run_manual'), async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { skills } = req.body || {};

    const ws = await query('SELECT id, name FROM workspaces WHERE id = $1', [workspaceId]);
    if (ws.rows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const registry = getSkillRegistry();
    let skillIds: string[];

    if (skills && Array.isArray(skills)) {
      // Filter to specific skills
      skillIds = skills;
    } else {
      // Run all skills that have a schedule
      const allSkills = registry.getAll();
      skillIds = allSkills
        .filter(s => s.schedule?.cron)
        .map(s => s.id);
    }

    if (skillIds.length === 0) {
      return res.status(400).json({ error: 'No skills to run' });
    }

    console.log(`[Skills] Running ${skillIds.length} skills for workspace ${workspaceId}`);

    // Run skills in staggered sequence
    const results = await runScheduledSkills(workspaceId as string, skillIds, 'manual_batch');

    const summary = {
      total: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    };

    return res.json({
      success: true,
      summary,
      results: results.map(r => ({
        skillId: r.skillId,
        status: r.success ? 'completed' : 'failed',
        runId: r.runId,
        duration_ms: r.duration_ms,
        error: r.error,
      })),
    });
  } catch (err) {
    console.error('[skills] Error running all skills:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:workspaceId/skills/:skillId/runs/:runId/export', async (req, res) => {
  try {
    const { workspaceId, skillId, runId } = req.params;

    const ws = await query('SELECT id, name FROM workspaces WHERE id = $1', [workspaceId]);
    if (ws.rows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const result = await query(
      `SELECT run_id, skill_id, output, created_at
       FROM skill_runs
       WHERE workspace_id = $1 AND skill_id = $2 AND (run_id = $3 OR id::text = $3::text)`,
      [workspaceId, skillId, runId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Skill run not found' });
    }

    const row = result.rows[0];

    let outputData: any;
    try {
      outputData = typeof row.output === 'string' ? JSON.parse(row.output) : row.output;
    } catch {
      return res.status(422).json({ error: 'Skill run output is malformed' });
    }

    if (!outputData?.evidence) {
      return res.status(404).json({ error: 'No evidence data available for this run' });
    }

    const registry = getSkillRegistry();
    const skill = registry.get(skillId);

    const buffer = await generateWorkbook({
      skillId,
      runDate: row.created_at,
      narrative: outputData.narrative || '',
      workspaceName: ws.rows[0].name,
      evidence: outputData.evidence,
      evidenceSchema: skill?.evidenceSchema,
    });

    const safeSkillId = skillId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateStr = new Date(row.created_at).toISOString().split('T')[0];
    const filename = `pandora-${safeSkillId}-${dateStr}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(buffer);
  } catch (err) {
    console.error('[skills] Error exporting skill run:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

async function checkSnooze(workspaceId: string, skillId: string): Promise<boolean> {
  try {
    const result = await query(
      `SELECT id FROM snooze_config
       WHERE workspace_id = $1 AND skill_id = $2 AND snooze_until > now()
       LIMIT 1`,
      [workspaceId, skillId]
    );
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

async function postSkillToSlack(workspaceId: string, skillId: string, result: SkillResult): Promise<void> {
  const { getNotificationPreferences, getCategoryRule } = await import('../notifications/preferences.js');
  try {
    const prefs = await getNotificationPreferences(workspaceId);
    if (!prefs.enabled) {
      console.log(`[skills] Notifications disabled for workspace ${workspaceId}, skipping Slack post`);
      return;
    }
    const rule = getCategoryRule(prefs, 'skill_run_complete');
    if (!rule.enabled) {
      console.log(`[skills] Skill run notifications disabled for workspace ${workspaceId}`);
      return;
    }
  } catch (err) {
    console.warn('[skills] Error checking notification prefs, proceeding with send:', err);
  }

  const slackAppClient = getSlackAppClient();
  const botToken = await slackAppClient.getBotToken(workspaceId);
  const registry = getSkillRegistry();
  const skill = registry.get(skillId);
  if (!skill) return;

  try {
    // Check for insufficient data — send a 4-line alert instead of the full message
    const rdata = (result as any).resultData ?? {};
    const hasInsufficientData =
      rdata.totalDeals === 0 ||
      rdata.activityCoverage === 0 ||
      rdata.hasInsufficientData === true;

    let blocks: any[];

    if (hasInsufficientData) {
      let workspaceName = workspaceId;
      try {
        const wsRow = await query<{ name: string }>(
          'SELECT name FROM workspaces WHERE id = $1 LIMIT 1',
          [workspaceId]
        );
        if (wsRow.rows[0]?.name) workspaceName = wsRow.rows[0].name;
      } catch { /* use workspaceId as fallback */ }

      blocks = formatDataQualityAlert({
        skillDisplayName: skill.name,
        workspaceName,
        missingData: rdata.missingDataSources ?? ['deal data', 'activity data'],
        recommendation: rdata.dataRecommendation ?? 'Connect your CRM and enable activity sync',
      });

      const alertText = extractTextFromBlocks(blocks);
      const alertValidation = validateSlackOutput(alertText, blocks);
      if (!alertValidation.valid) {
        console.warn('[Slack formatter] Data quality alert blocked:', alertValidation.errors);
        return;
      }

      // Strip internal _meta markers before sending; no action buttons for alerts
      const alertBlocks = blocks.filter((b: any) => b.type !== '_meta');
      const webhookUrl = await getSlackWebhook(workspaceId);
      if (webhookUrl) {
        await postBlocks(webhookUrl, alertBlocks);
        console.log(`[skills] Posted data quality alert for ${skillId} to Slack`);
      }
      return;
    } else {
      blocks = formatForSlack(result, skill);

      const validationText = extractTextFromBlocks(blocks);
      const validation = validateSlackOutput(validationText, blocks);
      if (!validation.valid) {
        console.warn('[Slack formatter] Blocked send:', validation.errors);
        return;
      }
    }

    const actionButtons = buildActionButtons({
      skill_id: skillId,
      run_id: result.runId,
      workspace_id: workspaceId,
      deals: extractTopDeals(result),
    });

    let perActionBlocks: any[] = [];
    try {
      const actionsResult = await query<any>(
        `SELECT id, action_type, severity, title, summary, impact_amount
         FROM actions WHERE workspace_id = $1 AND source_run_id = $2
         ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, impact_amount DESC NULLS LAST`,
        [workspaceId, result.runId]
      );
      if (actionsResult.rows.length > 0) {
        const appBaseUrl = process.env.REPLIT_DEV_DOMAIN
          ? `https://${process.env.REPLIT_DEV_DOMAIN}`
          : 'https://pandora-starter-kit.replit.app';
        perActionBlocks = buildPerActionButtons(
          actionsResult.rows.map(r => ({
            action_id: r.id,
            workspace_id: workspaceId,
            action_type: r.action_type,
            severity: r.severity,
            title: r.title,
            summary: r.summary,
            impact_amount: r.impact_amount ? Number(r.impact_amount) : undefined,
          })),
          appBaseUrl
        );
      }
    } catch (err) {
      console.error('[skills] Failed to query actions for Slack buttons:', err);
    }

    let fullBlocks = [...blocks, ...perActionBlocks, ...actionButtons];
    if (fullBlocks.length > 50) {
      fullBlocks = fullBlocks.slice(0, 49);
      fullBlocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: '_Message truncated — view full report in Pandora_' }],
      });
    }

    if (botToken) {
      const channel = await slackAppClient.getChannelForSkill(workspaceId, skillId);
      if (!channel) {
        console.warn(`[skills] No Slack channel configured for workspace ${workspaceId}`);
        const webhookUrl = await getSlackWebhook(workspaceId);
        if (webhookUrl) {
          await postBlocks(webhookUrl, blocks);
          console.log(`[skills] Posted ${skillId} to Slack via webhook (no channel config, buttons omitted)`);
        }
        return;
      }

      const msgRef = await slackAppClient.postMessage(workspaceId, channel, fullBlocks, {
        metadata: {
          skill_id: skillId,
          run_id: result.runId,
          workspace_id: workspaceId,
        },
      });

      if (msgRef.ok && msgRef.ts) {
        await query(
          `UPDATE skill_runs SET slack_message_ts = $1, slack_channel_id = $2 WHERE run_id = $3 AND workspace_id = $4`,
          [msgRef.ts, msgRef.channel, result.runId, workspaceId]
        ).catch(err => console.error('[skills] Failed to store Slack message ref:', err));
        await query(
          `INSERT INTO slack_messages (workspace_id, channel_id, message_ts, skill_run_id, message_type)
           VALUES ($1, $2, $3, $4, 'skill_report')`,
          [workspaceId, msgRef.channel, msgRef.ts, result.runId]
        ).catch(err => console.error('[skills] Failed to store slack_message:', err));
        await query(
          `INSERT INTO thread_anchors (workspace_id, channel_id, message_ts, skill_run_id, report_type)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (channel_id, message_ts) DO NOTHING`,
          [workspaceId, msgRef.channel, msgRef.ts, result.runId, skillId]
        ).catch(err => console.error('[skills] Failed to store thread_anchor:', err));
        trackPandoraPost(msgRef.channel, msgRef.ts, workspaceId);
        console.log(`[skills] Posted ${skillId} to Slack via bot API (ts: ${msgRef.ts})`);
      } else {
        console.error(`[skills] Slack bot post failed for ${skillId}:`, msgRef.error);
      }
    } else {
      const webhookUrl = await getSlackWebhook(workspaceId);
      if (webhookUrl) {
        await postBlocks(webhookUrl, blocks);
        console.log(`[skills] Posted ${skillId} to Slack via webhook for workspace ${workspaceId}`);
      } else {
        console.warn(`[skills] No Slack webhook or bot token for workspace ${workspaceId}`);
      }
    }
  } catch (slackErr) {
    console.error('[skills] Slack post error:', slackErr);
  }
}

function extractTopDeals(result: SkillResult): Array<{ id: string; name: string }> {
  const deals: Array<{ id: string; name: string }> = [];

  if (result.evidence?.evaluated_records) {
    for (const record of result.evidence.evaluated_records) {
      if (record.entity_type === 'deal' && record.entity_id && record.entity_name) {
        deals.push({ id: record.entity_id, name: record.entity_name });
        if (deals.length >= 3) break;
      }
    }
  }

  return deals;
}

router.get('/:workspaceId/monte-carlo/pipelines', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const result = await query<{
      pipeline: string;
      deal_count: string;
      total_value: string;
    }>(
      `SELECT pipeline, COUNT(*)::text AS deal_count, COALESCE(SUM(amount), 0)::text AS total_value
       FROM deals
       WHERE workspace_id = $1
         AND pipeline IS NOT NULL
       GROUP BY pipeline
       ORDER BY COALESCE(SUM(amount), 0) DESC`,
      [workspaceId]
    );

    const pipelines = result.rows.map(r => ({
      name: r.pipeline,
      dealCount: parseInt(r.deal_count, 10),
      totalValue: parseFloat(r.total_value),
      inferredType: inferPipelineType(r.pipeline),
    }));

    return res.json({ pipelines });
  } catch (err) {
    console.error('[skills] Error fetching MC pipelines:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:workspaceId/monte-carlo/runs', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const rows = await query<{
      run_id: string; created_at: string;
      pipeline_filter: string | null; pipeline_type: string | null;
      p50: string | null; p10: string | null; p90: string | null; deals: string | null;
    }>(
      `SELECT run_id, created_at,
         result->'simulation'->'commandCenter'->>'pipelineFilter' as pipeline_filter,
         result->'simulation'->'commandCenter'->>'pipelineType' as pipeline_type,
         result->'simulation'->'commandCenter'->>'p50' as p50,
         result->'simulation'->'commandCenter'->>'p10' as p10,
         result->'simulation'->'commandCenter'->>'p90' as p90,
         result->'simulation'->'commandCenter'->>'dealsInSimulation' as deals
       FROM skill_runs
       WHERE workspace_id = $1
         AND skill_id = 'monte-carlo-forecast'
         AND status = 'completed'
         AND result IS NOT NULL
         AND result->'simulation'->'commandCenter' IS NOT NULL
       ORDER BY created_at DESC
       LIMIT $2`,
      [workspaceId, limit]
    );
    return res.json({
      runs: rows.rows.map(r => ({
        runId: r.run_id,
        createdAt: r.created_at,
        pipelineFilter: r.pipeline_filter,
        pipelineType: r.pipeline_type,
        p50: r.p50 ? parseFloat(r.p50) : null,
        p10: r.p10 ? parseFloat(r.p10) : null,
        p90: r.p90 ? parseFloat(r.p90) : null,
        dealsInSimulation: r.deals ? parseInt(r.deals) : null,
      })),
    });
  } catch (err) {
    console.error('[skills] Error listing MC runs:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:workspaceId/monte-carlo/latest', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const pipeline = req.query.pipeline as string | undefined;
    const runId = req.query.runId as string | undefined;
    // ISO date (YYYY-MM-DD) of the fiscal quarter end — used to look up a quarter-scoped run
    const quarterEnd = req.query.quarterEnd as string | undefined;

    const ws = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (ws.rows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    let sql: string;
    let params: any[];

    if (runId) {
      sql = `SELECT run_id, created_at, result
             FROM skill_runs
             WHERE workspace_id = $1 AND run_id = $2
             LIMIT 1`;
      params = [workspaceId, runId];
    } else if (pipeline && quarterEnd) {
      // Pipeline-scoped + quarter-scoped: match pipelineFilter AND forecastWindowEnd within ±7 days
      // of the requested quarter end (tolerates minor day-of-month differences).
      sql = `SELECT run_id, created_at, result
             FROM skill_runs
             WHERE workspace_id = $1
               AND skill_id = 'monte-carlo-forecast'
               AND status = 'completed'
               AND result IS NOT NULL
               AND result->>'simulation' IS NOT NULL
               AND result->'simulation'->'commandCenter'->>'pipelineFilter' = $2
               AND (result->'simulation'->'commandCenter'->>'forecastWindowEnd')::date
                     BETWEEN ($3::date - INTERVAL '7 days') AND ($3::date + INTERVAL '7 days')
             ORDER BY created_at DESC
             LIMIT 1`;
      params = [workspaceId, pipeline, quarterEnd];
    } else if (pipeline) {
      sql = `SELECT run_id, created_at, result
             FROM skill_runs
             WHERE workspace_id = $1
               AND skill_id = 'monte-carlo-forecast'
               AND status = 'completed'
               AND result IS NOT NULL
               AND result->>'simulation' IS NOT NULL
               AND result->'simulation'->'commandCenter'->>'pipelineFilter' = $2
             ORDER BY created_at DESC
             LIMIT 1`;
      params = [workspaceId, pipeline];
    } else {
      sql = `SELECT run_id, created_at, result
             FROM skill_runs
             WHERE workspace_id = $1
               AND skill_id = 'monte-carlo-forecast'
               AND status = 'completed'
               AND result IS NOT NULL
             ORDER BY created_at DESC
             LIMIT 1`;
      params = [workspaceId];
    }

    const result = await query<{
      run_id: string;
      created_at: string;
      result: any;
    }>(sql, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No completed monte-carlo-forecast run found' });
    }

    const row = result.rows[0];
    let stepData: any;
    try {
      stepData = typeof row.result === 'string' ? JSON.parse(row.result) : row.result;
    } catch {
      return res.status(422).json({ error: 'Run result data is malformed' });
    }

    const commandCenter = stepData?.simulation?.commandCenter ?? null;
    if (!commandCenter) {
      const simError = stepData?.simulation?.error;
      return res.status(404).json({
        error: simError
          ? `Simulation failed: ${simError}`
          : 'No command_center payload in latest run',
      });
    }

    return res.json({
      runId: row.run_id,
      generatedAt: row.created_at,
      commandCenter,
    });
  } catch (err) {
    console.error('[skills] Error fetching monte-carlo latest:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/workspaces/:workspaceId/monte-carlo/query
 * Ask a natural language question about the most recent Monte Carlo run.
 */
router.post('/:workspaceId/monte-carlo/query', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const {
      question,
      pipelineId = null,
      sessionId = randomUUID(),
      conversationHistory = [] as HistoryTurn[],
    } = req.body || {};

    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'question is required' });
    }

    const ws = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (ws.rows.length === 0) return res.status(404).json({ error: 'Workspace not found' });

    // Build token-safe sliding window history
    const safeHistory = buildConversationHistory(
      Array.isArray(conversationHistory) ? conversationHistory : []
    );

    // Load most recent completed MC run
    const runResult = await query<{ run_id: string; created_at: string; result: any }>(
      pipelineId
        ? `SELECT run_id, created_at, result FROM skill_runs
           WHERE workspace_id = $1 AND skill_id = 'monte-carlo-forecast'
             AND status = 'completed' AND result IS NOT NULL
             AND result->'simulation'->'commandCenter'->>'pipelineFilter' = $2
           ORDER BY created_at DESC LIMIT 1`
        : `SELECT run_id, created_at, result FROM skill_runs
           WHERE workspace_id = $1 AND skill_id = 'monte-carlo-forecast'
             AND status = 'completed' AND result IS NOT NULL
           ORDER BY created_at DESC LIMIT 1`,
      pipelineId ? [workspaceId, pipelineId] : [workspaceId]
    );

    if (runResult.rows.length === 0) {
      return res.json({
        answer: 'No forecast run found. Trigger a Monte Carlo run first.',
        queryType: 'unknown',
        data: {},
        confidence: 0,
        followUps: [],
        sessionId,
      });
    }

    const row = runResult.rows[0];
    const stepData = typeof row.result === 'string' ? JSON.parse(row.result) : row.result;

    const iterations: any[] = stepData?.simulation?.iterations ?? [];
    const simulationInputs = stepData?.simulation?.simulationInputs ?? null;
    const commandCenter = stepData?.simulation?.commandCenter ?? {};

    if (iterations.length === 0) {
      return res.json({
        answer: 'This run was computed before query support was added. Re-run the forecast to enable questions.',
        queryType: 'unknown',
        data: {},
        confidence: 0,
        followUps: [],
        sessionId,
      });
    }

    const openDeals: { id: string; name: string; amount: number; ownerEmail: string }[] =
      simulationInputs?.openDeals ?? [];
    const repNames = [...new Set(openDeals.map((d: any) => d.ownerEmail).filter(Boolean))] as string[];
    const openDealNames = openDeals.map((d: any) => d.name);
    const topDealsByAmount = [...openDeals]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)
      .map(d => `${d.name}: $${Math.round(d.amount).toLocaleString()} (${d.ownerEmail ?? 'unassigned'})`);

    // Classify intent — pass conversation history for pronoun/reference resolution
    const { classifyQueryIntent, fuzzyMatch } = await import('../analysis/monte-carlo-intent.js');
    const intent = await classifyQueryIntent(question.trim(), {
      workspaceId,
      pipelineType: commandCenter.pipelineType ?? 'new_business',
      p50: commandCenter.p50 ?? 0,
      quota: commandCenter.quota ?? null,
      openDealNames,
      repNames,
      conversationHistory: safeHistory,
    });

    // Log user message
    await logChatMessage({
      workspaceId,
      sessionId,
      surface: 'mc_query',
      role: 'user',
      content: question.trim(),
      intentType: intent.type,
      scope: { type: 'mc_run', runId: row.run_id, pipelineId },
    });

    // Three-tier routing: structured (≥0.65) → context_only (0.40–0.64) → fallback (<0.40)
    type RoutingTier = 'structured' | 'context_only' | 'fallback';

    function getRoutingTier(confidence: number, hasIterations: boolean): RoutingTier {
      if (!hasIterations)      return 'context_only';
      if (confidence >= 0.65)  return 'structured';
      if (confidence >= 0.40)  return 'context_only';
      return 'fallback';
    }

    const tier = getRoutingTier(intent.confidence, iterations.length > 0);
    let queryData: any = {};
    let routingTier: RoutingTier = tier;

    if (tier === 'structured') {
      const {
        queryDealProbability,
        queryMustClose,
        queryWhatIfWinRate,
        queryWhatIfDeal,
        queryScenarioDecompose,
        queryComponentSensitivity,
        queryRepImpact,
        queryPipelineCreationTarget,
      } = await import('../analysis/monte-carlo-queries.js');

      const targetRevenue = intent.params.targetRevenue ?? commandCenter.quota ?? null;

      try {
        switch (intent.type) {
          case 'deal_probability': {
            const matched = intent.params.dealName
              ? fuzzyMatch(intent.params.dealName, openDeals)
              : null;
            if (!matched && intent.params.dealName) {
              return res.json({
                answer: `I couldn't find a deal called "${intent.params.dealName}" in the current simulation. Open deals include: ${openDealNames.slice(0, 8).join(', ')}. Which did you mean?`,
                queryType: 'deal_probability',
                data: {},
                confidence: intent.confidence,
                routingTier: 'structured',
                followUps: [],
                sessionId,
              });
            }
            const dealsToQuery = matched
              ? [matched].map(d => ({ ...d, amount: openDeals.find(od => od.id === d.id)?.amount ?? 0 }))
              : openDeals.slice(0, 5).map(d => ({ id: d.id, name: d.name, amount: d.amount }));
            queryData = queryDealProbability(iterations, dealsToQuery);
            break;
          }

          case 'must_close': {
            const target = targetRevenue ?? commandCenter.p50;
            queryData = queryMustClose(iterations, target, 5);
            queryData.mustCloseDeals = queryData.mustCloseDeals.map((d: any) => {
              const deal = openDeals.find(od => od.id === d.dealId);
              return { ...d, dealName: deal?.name ?? d.dealId, amount: deal?.amount ?? 0 };
            });
            break;
          }

          case 'what_if_win_rate': {
            if (!simulationInputs) {
              queryData = { error: 'simulationInputs not stored in this run' };
              break;
            }
            const multiplier = intent.params.winRateImprovement
              ? (intent.params.winRateImprovement > 1 ? intent.params.winRateImprovement : 1 + intent.params.winRateImprovement)
              : 1.3;
            queryData = await queryWhatIfWinRate(
              simulationInputs,
              commandCenter.p50,
              commandCenter.probOfHittingTarget,
              multiplier
            );
            break;
          }

          case 'what_if_deal': {
            const matched = intent.params.dealName
              ? fuzzyMatch(intent.params.dealName, openDeals)
              : null;
            if (!matched) {
              return res.json({
                answer: `I couldn't find a deal called "${intent.params.dealName ?? '(unknown)'}" in the current simulation. Open deals: ${openDealNames.slice(0, 8).join(', ')}.`,
                queryType: 'what_if_deal',
                data: {},
                confidence: intent.confidence,
                routingTier: 'structured',
                followUps: [],
                sessionId,
              });
            }
            const dealAmount = openDeals.find(d => d.id === matched.id)?.amount ?? 0;
            queryData = queryWhatIfDeal(iterations, matched.id, matched.name, dealAmount, targetRevenue);
            break;
          }

          case 'scenario_decompose': {
            const threshold = intent.params.threshold
              ?? (targetRevenue ? 'above_target' : 'top_quartile');
            queryData = queryScenarioDecompose(iterations, threshold, targetRevenue);
            break;
          }

          case 'component_sensitivity': {
            queryData = queryComponentSensitivity(iterations, targetRevenue);
            break;
          }

          case 'rep_impact': {
            const matchedRep = intent.params.repName
              ? fuzzyMatch(intent.params.repName, repNames.map(r => ({ id: r, name: r })))
              : null;
            if (!matchedRep) {
              return res.json({
                answer: `I couldn't find a rep called "${intent.params.repName ?? '(unknown)'}". Known reps: ${repNames.slice(0, 6).join(', ')}.`,
                queryType: 'rep_impact',
                data: {},
                confidence: intent.confidence,
                routingTier: 'structured',
                followUps: [],
                sessionId,
              });
            }
            queryData = queryRepImpact(iterations, matchedRep.id, matchedRep.name, targetRevenue);
            break;
          }

          case 'pipeline_creation_target': {
            if (!simulationInputs) {
              queryData = { error: 'simulationInputs not stored in this run' };
              break;
            }
            queryData = queryPipelineCreationTarget(simulationInputs, commandCenter);
            break;
          }

          default:
            queryData = {};
        }
      } catch (err) {
        console.error('[mc-query] Handler failed, downgrading to context_only:', err);
        routingTier = 'context_only';
        queryData = {};
      }
    }
    // context_only and fallback: queryData stays {}

    // Synthesize answer with Claude — include conversation history for follow-up context
    const { callLLM } = await import('../utils/llm-router.js');
    const historyBlock = safeHistory.length > 0
      ? `PRIOR CONVERSATION:\n${safeHistory.map(t => `${t.role === 'user' ? 'User' : 'Pandora'}: ${t.content}`).join('\n')}\n\n---\n\n`
      : '';

    const forecastContextBlock = `Pipeline: ${commandCenter.pipelineFilter ?? 'all pipelines'} (${commandCenter.pipelineType ?? 'new_business'})
P10: $${Math.round(commandCenter.p10 ?? 0).toLocaleString()} | P50: $${Math.round(commandCenter.p50 ?? 0).toLocaleString()} | P90: $${Math.round(commandCenter.p90 ?? 0).toLocaleString()}
Annual quota: ${commandCenter.quota ? `$${Math.round(commandCenter.quota).toLocaleString()}` : 'not set'}
Probability of hitting target: ${commandCenter.probOfHittingTarget !== null && commandCenter.probOfHittingTarget !== undefined ? `${Math.round(commandCenter.probOfHittingTarget * 100)}%` : 'n/a'}
Forecast window end: ${commandCenter.forecastWindowEnd ?? 'unknown'}
Existing pipeline P50: ${commandCenter.existingPipelineP50 != null ? `$${Math.round(commandCenter.existingPipelineP50).toLocaleString()}` : 'n/a'}
Future pipeline P50: ${commandCenter.projectedPipelineP50 != null ? `$${Math.round(commandCenter.projectedPipelineP50).toLocaleString()}` : 'n/a'}
Open deals in simulation: ${commandCenter.dealsInSimulation ?? 0}
Top deals by amount:
${topDealsByAmount.length > 0 ? topDealsByAmount.map(d => `  • ${d}`).join('\n') : '  (none)'}`;

    let synthesisPrompt: string;

    if (routingTier === 'structured') {
      synthesisPrompt = `You are answering a question about a Monte Carlo revenue forecast for a B2B SaaS company.

FORECAST CONTEXT:
${forecastContextBlock}

${historyBlock}CURRENT QUESTION: "${question.trim()}"

QUERY TYPE: ${intent.type}

STRUCTURED RESULT:
${JSON.stringify(queryData, null, 2)}

Answer the question in 2–4 sentences. Rules:
- Lead with the direct answer — a number, a deal name, a percentage
- Quantify everything — never say "significant" when you can say "$180K"
- Name specific deals and reps when they appear in the data
- End with one implication sentence: what should the reader do with this information?
- Do not explain how Monte Carlo works
- Do not hedge with "based on the simulation" — just state the finding

After the answer, output exactly this JSON on a new line:
{"followUps": ["question 1", "question 2", "question 3"]}

Pick follow-up questions that logically extend the current answer.`;
    } else if (routingTier === 'context_only') {
      synthesisPrompt = `You are answering a question about a Monte Carlo revenue forecast for a B2B SaaS company.

The classifier identified this as a "${intent.type}" question with moderate confidence (${intent.confidence.toFixed(2)}). No structured query was run.

Answer from the simulation context below. Be honest about what you can and cannot derive from the available data. Do not invent specific deal names or numbers that aren't in the context.

SIMULATION CONTEXT:
${forecastContextBlock}

${historyBlock}CURRENT QUESTION: "${question.trim()}"

Answer the question as best you can from this context. If the question requires data not available here, say so plainly and suggest what the user should do (e.g., "run a new simulation" or "check the Pipeline Hygiene skill for rep-level creation rates"). Keep to 2–4 sentences.

After the answer, output exactly this JSON on a new line:
{"followUps": ["question 1", "question 2", "question 3"]}`;
    } else {
      synthesisPrompt = `You are answering a question about a Monte Carlo revenue forecast for a B2B SaaS company.

This question didn't match a recognized forecast query type.

SIMULATION CONTEXT:
${forecastContextBlock}

${historyBlock}CURRENT QUESTION: "${question.trim()}"

Answer what you can from the simulation context. If the question is unrelated to the forecast, say so briefly and suggest what part of Pandora might help (e.g., "this sounds like a rep activity question — the Rep Scorecard skill covers that"). Keep to 2–3 sentences.

After the answer, output exactly this JSON on a new line:
{"followUps": ["question 1", "question 2", "question 3"]}`;
    }

    const llmResponse = await callLLM(workspaceId, 'generate', {
      messages: [{ role: 'user', content: synthesisPrompt }],
      maxTokens: 500,
      temperature: 0.3,
    });

    const rawAnswer = llmResponse.content || '';
    const followUpMatch = rawAnswer.match(/\{"followUps":\s*\[[\s\S]*?\]\}/);
    let answer = rawAnswer;
    let followUps: string[] = [];

    if (followUpMatch) {
      try {
        const parsed = JSON.parse(followUpMatch[0]);
        followUps = Array.isArray(parsed.followUps) ? parsed.followUps.slice(0, 3) : [];
        answer = rawAnswer.slice(0, followUpMatch.index).trim();
      } catch {
        // Keep raw answer if JSON parse fails
      }
    }

    // Log assistant response — intentType includes routing tier for observability
    await logChatMessage({
      workspaceId,
      sessionId,
      surface: 'mc_query',
      role: 'assistant',
      content: answer,
      intentType: `${intent.type}:${routingTier}`,
      scope: { type: 'mc_run', runId: row.run_id, pipelineId },
      tokenCost: llmResponse.usage != null
        ? (llmResponse.usage.input + (llmResponse.usage.output ?? 0))
        : null,
    });

    return res.json({
      answer,
      queryType: intent.type,
      data: queryData,
      confidence: intent.confidence,
      routingTier,
      followUps,
      sessionId,
    });
  } catch (err) {
    console.error('[mc-query] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/workspaces/:workspaceId/monte-carlo/queries
 * Backward-compat redirect to unified chat history endpoint.
 */
router.get('/:workspaceId/monte-carlo/queries', (req, res) => {
  const limit = req.query.limit ?? '5';
  res.redirect(307, `/api/workspaces/${req.params.workspaceId}/chat/history?surface=mc_query&limit=${limit}`);
});

/**
 * GET /api/workspaces/:workspaceId/chat/history
 * Unified chat log across all surfaces (Ask Pandora, MC queries, Slack).
 * Query params: ?surface=mc_query|ask_pandora|slack  ?sessionId=<uuid>  ?limit=20
 */
router.get('/:workspaceId/chat/history', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { surface, sessionId, limit = '20' } = req.query;

    const conditions: string[] = ['workspace_id = $1'];
    const params: unknown[]    = [workspaceId];
    let   idx = 2;

    if (surface) {
      conditions.push(`surface = $${idx++}`);
      params.push(surface);
    }
    if (sessionId) {
      conditions.push(`session_id = $${idx++}`);
      params.push(sessionId);
    }

    const limitVal = Math.min(parseInt(String(limit), 10) || 20, 100);
    params.push(limitVal);

    const rows = await query<{
      id: string;
      session_id: string;
      surface: string;
      role: string;
      content: string;
      intent_type: string | null;
      scope: any;
      token_cost: number | null;
      created_at: string;
    }>(
      `SELECT id, session_id, surface, role, content, intent_type, scope, token_cost, created_at
       FROM chat_messages
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${idx}`,
      params
    );

    // Also expose as "queries" for backward compat with the MC card UI
    const messages = rows.rows;
    return res.json({
      messages,
      // Legacy shape for GET /monte-carlo/queries consumers
      queries: messages
        .filter(m => m.role === 'user')
        .map(m => ({
          id: m.id,
          question: m.content,
          intentType: m.intent_type,
          answer: '',  // filled by pairing with assistant turn if needed
          createdAt: m.created_at,
        })),
    });
  } catch (err) {
    console.error('[chat-history] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// Behavioral Winning Path — Dedicated Endpoints
// ============================================================================

/**
 * GET /:workspaceId/skills/behavioral-winning-path/latest
 * Returns the most recent completed run for this skill.
 */
router.get('/:workspaceId/skills/behavioral-winning-path/latest', async (req, res) => {
  const { workspaceId } = req.params;
  try {
    const result = await query(
      `SELECT run_id, skill_id, status, result, output, output_text, started_at, completed_at, duration_ms, error
       FROM skill_runs
       WHERE workspace_id = $1
         AND skill_id = 'behavioral-winning-path'
         AND status = 'completed'
       ORDER BY completed_at DESC
       LIMIT 1`,
      [workspaceId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No completed runs found for behavioral-winning-path' });
    }
    const row = result.rows[0];
    return res.json({
      runId: row.run_id,
      skillId: row.skill_id,
      status: row.status,
      result: row.result,
      outputText: row.output_text,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      durationMs: row.duration_ms,
    });
  } catch (err: any) {
    console.error('[behavioral-winning-path/latest] Error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch latest behavioral winning path run' });
  }
});

/**
 * GET /:workspaceId/skills/behavioral-winning-path/stage-progression/latest
 * Returns the most recent Stage Progression matrix from the latest completed skill run.
 */
router.get('/:workspaceId/skills/behavioral-winning-path/stage-progression/latest', async (req, res) => {
  const { workspaceId } = req.params;
  try {
    const result = await query(
      `SELECT run_id, result, output_text, started_at, completed_at
       FROM skill_runs
       WHERE workspace_id = $1
         AND skill_id = 'behavioral-winning-path'
         AND status = 'completed'
       ORDER BY completed_at DESC
       LIMIT 1`,
      [workspaceId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No completed runs found for behavioral-winning-path' });
    }
    const row = result.rows[0];
    const runResult = row.result as any;
    const matrix = runResult?.stage_progression_matrix;
    if (!matrix) {
      return res.status(404).json({ error: 'No stage progression data in latest run — re-run the skill to generate it' });
    }
    return res.json({
      runId:                   row.run_id,
      stageProgressionMatrix:  matrix,
      narrative:               runResult?.stage_progression_narrative ?? null,
      completedAt:             row.completed_at,
    });
  } catch (err: any) {
    console.error('[stage-progression/latest] Error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch stage progression data' });
  }
});

/**
 * GET /:workspaceId/skills/behavioral-winning-path/stage-progression/coverage
 * Fast coverage probe — no LLM calls. Returns per-stage transcript coverage.
 * Query params: pipeline? (optional CRM pipeline name)
 */
router.get('/:workspaceId/skills/behavioral-winning-path/stage-progression/coverage', async (req, res) => {
  const { workspaceId } = req.params;
  const pipeline = req.query.pipeline as string | undefined;
  try {
    const coverage = await getStageTranscriptCoverage(workspaceId, pipeline || undefined);
    return res.json(coverage);
  } catch (err: any) {
    console.error('[stage-progression/coverage] Error:', err.message);
    return res.status(500).json({ error: 'Failed to compute stage transcript coverage' });
  }
});

/**
 * GET /:workspaceId/skills/behavioral-winning-path/tier
 * Fast data tier probe — no analysis, no LLM calls.
 * Returns which tier is available and why, plus availability breakdown.
 */
router.get('/:workspaceId/skills/behavioral-winning-path/tier', async (req, res) => {
  const { workspaceId } = req.params;
  try {
    const probe = await probeBehavioralDataTier(workspaceId);
    return res.json(probe);
  } catch (err: any) {
    console.error('[behavioral-winning-path/tier] Error:', err.message);
    return res.status(500).json({ error: 'Failed to probe behavioral winning path data tier' });
  }
});

/**
 * GET /:workspaceId/skills/behavioral-winning-path/matrix
 * On-the-fly milestone matrix computation with optional pipeline filter.
 * No LLM calls — pure SQL extraction. Used by the frontend when a pipeline is selected.
 * Query params:
 *   pipeline? — CRM pipeline name to filter closed deals by
 *   periodDays? — look-back window in days (default: 180)
 */
router.get('/:workspaceId/skills/behavioral-winning-path/matrix', async (req, res) => {
  const { workspaceId } = req.params;
  const pipeline = req.query.pipeline as string | undefined;
  const periodDays = Math.min(Math.max(parseInt(req.query.periodDays as string ?? '180', 10) || 180, 30), 1825);

  try {
    const probe = await probeBehavioralDataTier(workspaceId);
    const matrix = await extractBehavioralMilestones(workspaceId, probe, periodDays, pipeline || undefined);
    // Strip transcript excerpts — not needed for the live filter view
    const { transcriptExcerptsForClassification: _stripped, ...safeMatrix } = matrix as any;
    return res.json(safeMatrix);
  } catch (err: any) {
    console.error('[behavioral-winning-path/matrix] Error:', err.message);
    return res.status(500).json({ error: 'Failed to compute milestone matrix' });
  }
});

/**
 * GET /:workspaceId/skill-runs/:skillRunId/evidence
 * Returns structured evidence rows from a specific skill run's output.
 * Used by the Ask Pandora pre-seed utility to attach backing data to context messages.
 * Skill run evidence never changes after completion, so responses are immutable-cacheable.
 */
router.get('/:workspaceId/skill-runs/:skillRunId/evidence', async (req, res) => {
  const { workspaceId, skillRunId } = req.params;

  try {
    const result = await query(
      `SELECT output FROM skill_runs
       WHERE workspace_id = $1 AND (run_id = $2 OR id::text = $2::text)
         AND status = 'completed'
       LIMIT 1`,
      [workspaceId, skillRunId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Skill run not found' });
    }

    const output = result.rows[0].output;
    const evidence = output?.evidence || {};
    const claims: any[] = evidence.claims || evidence.evaluated_records || [];

    const rows = claims.slice(0, 50).map((claim: any) => ({
      label: claim.label || claim.type || claim.field || 'Finding',
      value: claim.value ?? claim.actual ?? claim.score ?? '',
      meta: claim.meta || claim.deal_name || claim.account_name || claim.owner || undefined,
    }));

    res.set('Cache-Control', 'immutable, max-age=86400');
    return res.json({ rows });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to fetch evidence' });
  }
});

// POST /api/workspaces/:id/jobs/retro-accuracy-bootstrap
// Runs the retroactive forecast accuracy bootstrap for a workspace.
router.post('/:id/jobs/retro-accuracy-bootstrap', async (req, res) => {
  const workspaceId = req.params.id as string;
  if (!workspaceId) { res.status(400).json({ error: 'Missing workspaceId' }); return; }
  try {
    const { retroAccuracyBootstrap } = await import('../jobs/retro-accuracy-bootstrap.js');
    // Fire-and-forget — return job started immediately, log completion
    retroAccuracyBootstrap(workspaceId)
      .then(result => console.log(`[RetroAccuracy] Bootstrap complete for ${workspaceId}:`, result))
      .catch(err => console.error(`[RetroAccuracy] Bootstrap failed for ${workspaceId}:`, err?.message));
    res.json({ status: 'started', workspaceId, message: 'Retro accuracy bootstrap running in background' });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Bootstrap failed' });
  }
});

// POST /api/workspaces/:id/jobs/refresh-bearing-calibration
// Recomputes forecast bearing calibration from forecast_accuracy_log and stores in context_layer.
router.post('/:id/jobs/refresh-bearing-calibration', async (req, res) => {
  const workspaceId = req.params.id as string;
  if (!workspaceId) { res.status(400).json({ error: 'Missing workspaceId' }); return; }
  try {
    const { refreshBearingCalibration } = await import('../jobs/refresh-bearing-calibration.js');
    refreshBearingCalibration(workspaceId)
      .then(() => console.log(`[BearingCalibration] Manual refresh complete for ${workspaceId}`))
      .catch(err => console.error(`[BearingCalibration] Manual refresh failed for ${workspaceId}:`, err?.message));
    res.json({ status: 'started', workspaceId, message: 'Bearing calibration refresh running in background' });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Bearing calibration refresh failed' });
  }
});

// POST /api/workspaces/:id/connectors/hubspot/backfill-field-history
// Backfills forecastcategory, amount, closedate property history from HubSpot.
router.post('/:id/connectors/hubspot/backfill-field-history', async (req, res) => {
  const workspaceId = req.params.id as string;
  if (!workspaceId) { res.status(400).json({ error: 'Missing workspaceId' }); return; }
  try {
    const { getConnectorCredentials } = await import('../lib/credential-store.js');
    const creds = await getConnectorCredentials(workspaceId, 'hubspot');
    if (!creds?.access_token) { res.status(400).json({ error: 'No HubSpot connection for this workspace' }); return; }
    const { backfillFieldHistory } = await import('../connectors/hubspot/field-history-backfill.js');
    const fullBackfill = (req.body as any)?.fullBackfill === true;
    backfillFieldHistory(workspaceId, creds.access_token, { fullBackfill })
      .then(result => console.log(`[FieldHistoryBackfill] Complete for ${workspaceId}:`, result))
      .catch(err => console.error(`[FieldHistoryBackfill] Failed for ${workspaceId}:`, err?.message));
    res.json({ status: 'started', workspaceId, message: 'Field history backfill running in background' });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Backfill failed' });
  }
});

export default router;
