import { Router } from 'express';
import { getSkillRegistry } from '../skills/registry.js';
import { getSkillRuntime } from '../skills/runtime.js';
import { formatForSlack } from '../skills/formatters/slack-formatter.js';
import { formatAsMarkdown } from '../skills/formatters/markdown-formatter.js';
import { getSlackWebhook, postBlocks } from '../connectors/slack/client.js';
import { query } from '../db.js';
import type { SkillResult } from '../skills/types.js';

const router = Router();

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
  } catch (logErr) {
    console.error('[skills] Failed to log skill run:', logErr);
  }

  if (skill.outputFormat === 'slack') {
    const webhookUrl = await getSlackWebhook(workspaceId);
    if (webhookUrl) {
      try {
        const blocks = formatForSlack(result, skill);
        const slackResult = await postBlocks(webhookUrl, blocks);
        if (slackResult.ok) {
          console.log(`[skills] Posted ${skillId} result to Slack for workspace ${workspaceId}`);
        } else {
          console.error(`[skills] Slack post failed for ${skillId}:`, slackResult.error);
        }
      } catch (slackErr) {
        console.error('[skills] Slack post error:', slackErr);
      }
    } else {
      console.warn(`[skills] No Slack webhook configured for workspace ${workspaceId}, skipping post`);
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

router.post('/skills/:skillId/run', async (req, res) => {
  try {
    const { skillId } = req.params;
    const { workspaceId, params } = req.body || {};
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId is required in request body' });
    }
    return await handleSkillRun(workspaceId, skillId, params, res);
  } catch (err) {
    console.error('[skills] Error running skill:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:workspaceId/skills/:skillId/run', async (req, res) => {
  try {
    const { workspaceId, skillId } = req.params;
    const { params } = req.body || {};
    return await handleSkillRun(workspaceId, skillId, params, res);
  } catch (err) {
    console.error('[skills] Error running skill:', err);
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
    const skills = registry.listAll();

    const lastRuns = await query(
      `SELECT DISTINCT ON (skill_id) skill_id, created_at
       FROM skill_runs
       WHERE workspace_id = $1
       ORDER BY skill_id, created_at DESC`,
      [workspaceId]
    );

    const lastRunMap = new Map<string, string>();
    for (const row of lastRuns.rows) {
      lastRunMap.set(row.skill_id, row.created_at);
    }

    const result = skills.map(s => ({
      id: s.id,
      name: s.name,
      category: s.category,
      tier: s.tier,
      schedule: s.schedule,
      lastRunAt: lastRunMap.get(s.id) || null,
    }));

    return res.json(result);
  } catch (err) {
    console.error('[skills] Error listing skills:', err);
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

export default router;
