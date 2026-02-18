import { Router } from 'express';
import { getSkillRegistry } from '../skills/registry.js';
import { getSkillRuntime } from '../skills/runtime.js';
import { formatForSlack, buildActionButtons, buildPerActionButtons } from '../skills/formatters/slack-formatter.js';
import { formatAsMarkdown } from '../skills/formatters/markdown-formatter.js';
import { getSlackWebhook, postBlocks } from '../connectors/slack/client.js';
import { getSlackAppClient } from '../connectors/slack/slack-app-client.js';
import { query } from '../db.js';
import { runScheduledSkills } from '../sync/skill-scheduler.js';
import { generateWorkbook } from '../delivery/workbook-generator.js';
import type { SkillResult } from '../skills/types.js';
import { requireAuth } from '../middleware/auth.js';

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
        result.output ? JSON.stringify(result.evidence ? { narrative: result.output, evidence: result.evidence } : result.output) : null,
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
    const skills = registry.getAll();

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
          cron: override?.cron ?? baseSchedule.cron ?? null,
          enabled: override !== undefined ? override.enabled : false,
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

router.patch('/:workspaceId/skills/:skillId/schedule', async (req, res) => {
  try {
    const { workspaceId, skillId } = req.params;
    const { cron, enabled } = req.body || {};

    const registry = getSkillRegistry();
    if (!registry.get(skillId)) {
      return res.status(404).json({ error: `Skill not found: ${skillId}` });
    }

    await query(
      `INSERT INTO skill_schedules (workspace_id, skill_id, cron, enabled, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (workspace_id, skill_id) DO UPDATE SET
         cron = EXCLUDED.cron,
         enabled = EXCLUDED.enabled,
         updated_at = NOW()`,
      [workspaceId, skillId, cron ?? null, enabled ?? true]
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
router.post('/:workspaceId/skills/run-all', async (req, res) => {
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
    const results = await runScheduledSkills(workspaceId, skillIds, 'manual_batch');

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
  const slackAppClient = getSlackAppClient();
  const botToken = await slackAppClient.getBotToken(workspaceId);
  const registry = getSkillRegistry();
  const skill = registry.get(skillId);
  if (!skill) return;

  try {
    const blocks = formatForSlack(result, skill);

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

/**
 * GET /api/workspaces/:workspaceId/monte-carlo/latest
 * Returns the command_center payload from the most recent completed monte-carlo-forecast run.
 * Used by the Command Center UI (Flight Plan tab).
 */
router.get('/:workspaceId/monte-carlo/latest', async (req, res) => {
  try {
    const { workspaceId } = req.params;

    const ws = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (ws.rows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    // result column holds stepData JSONB; command_center lives under simulation key
    const result = await query<{
      run_id: string;
      created_at: string;
      result: any;
    }>(
      `SELECT run_id, created_at, result
       FROM skill_runs
       WHERE workspace_id = $1
         AND skill_id = 'monte-carlo-forecast'
         AND status = 'completed'
         AND result IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [workspaceId]
    );

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
      return res.status(404).json({ error: 'No command_center payload in latest run' });
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

export default router;
