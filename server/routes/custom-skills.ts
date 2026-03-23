/**
 * Custom Skills API Routes
 *
 * CRUD and run endpoints for workspace-created skills.
 * Skills created here are immediately hot-loaded into the skill registry
 * without requiring a server restart.
 */

import { Router } from 'express';
import { query } from '../db.js';
import { registerCustomSkill, unregisterCustomSkill } from '../skills/index.js';
import { getSkillRegistry } from '../skills/registry.js';
import { getSkillRuntime } from '../skills/runtime.js';
import { registerCustomSkillCron, unregisterCustomSkillCron } from '../sync/skill-scheduler.js';
import { requirePermission } from '../middleware/permissions.js';

const router = Router();

function generateSkillId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 33);
  return `custom-${slug}`;
}

/**
 * GET /:workspaceId/skills/custom
 * List all custom skills for a workspace
 */
router.get('/:workspaceId/skills/custom', async (req, res) => {
  try {
    const { workspaceId } = req.params as Record<string, string>;
    const result = await query(
      `SELECT * FROM custom_skills WHERE workspace_id = $1 AND status = 'active' ORDER BY created_at DESC`,
      [workspaceId]
    );
    return res.json({ skills: result.rows });
  } catch (err: any) {
    console.error('[custom-skills] GET error:', err);
    return res.status(500).json({ error: 'Failed to fetch custom skills' });
  }
});

/**
 * POST /:workspaceId/skills/custom
 * Create a new custom skill
 */
router.post('/:workspaceId/skills/custom', async (req, res) => {
  try {
    const { workspaceId } = req.params as Record<string, string>;
    const {
      name,
      description,
      category = 'custom',
      query_source,
      saved_query_id,
      saved_query_name,
      inline_sql,
      classify_enabled = true,
      classify_bad,
      classify_good,
      synthesize_enabled = true,
      synthesize_tone = 'Flag risks',
      synthesize_custom_prompt,
      output_slack = true,
      output_report = false,
      schedule_cron,
      replaces_skill_id,
    } = req.body;

    if (!name || !description || !query_source) {
      return res.status(400).json({ error: 'name, description, and query_source are required' });
    }
    if (!['saved_query', 'inline_sql'].includes(query_source)) {
      return res.status(400).json({ error: 'query_source must be saved_query or inline_sql' });
    }
    if (query_source === 'inline_sql' && !inline_sql) {
      return res.status(400).json({ error: 'inline_sql is required when query_source is inline_sql' });
    }
    if (query_source === 'saved_query' && !saved_query_name) {
      return res.status(400).json({ error: 'saved_query_name is required when query_source is saved_query' });
    }

    const skillId = generateSkillId(name);

    const existing = await query(
      `SELECT id FROM custom_skills WHERE workspace_id = $1 AND skill_id = $2`,
      [workspaceId, skillId]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: `A skill with this name already exists (id: ${skillId})` });
    }

    const result = await query(
      `INSERT INTO custom_skills
        (workspace_id, skill_id, name, description, category, query_source,
         saved_query_id, saved_query_name, inline_sql,
         classify_enabled, classify_bad, classify_good,
         synthesize_enabled, synthesize_tone, synthesize_custom_prompt,
         output_slack, output_report, schedule_cron, replaces_skill_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        workspaceId, skillId, name, description, category, query_source,
        saved_query_id ?? null, saved_query_name ?? null, inline_sql ?? null,
        classify_enabled, classify_bad ?? null, classify_good ?? null,
        synthesize_enabled, synthesize_tone, synthesize_custom_prompt ?? null,
        output_slack, output_report, schedule_cron ?? null, replaces_skill_id ?? null,
      ]
    );

    const row = result.rows[0];

    await registerCustomSkill(skillId, workspaceId);

    if (schedule_cron) {
      registerCustomSkillCron(row as any);
    }

    return res.status(201).json({ skill: row, registered: true });
  } catch (err: any) {
    console.error('[custom-skills] POST error:', err);
    return res.status(500).json({ error: 'Failed to create custom skill' });
  }
});

/**
 * PUT /:workspaceId/skills/custom/:skillId
 * Update an existing custom skill
 */
router.put('/:workspaceId/skills/custom/:skillId', async (req, res) => {
  try {
    const { workspaceId, skillId } = req.params as Record<string, string>;
    const {
      name,
      description,
      category,
      query_source,
      saved_query_id,
      saved_query_name,
      inline_sql,
      classify_enabled,
      classify_bad,
      classify_good,
      synthesize_enabled,
      synthesize_tone,
      synthesize_custom_prompt,
      output_slack,
      output_report,
      schedule_cron,
      replaces_skill_id,
    } = req.body;

    const result = await query(
      `UPDATE custom_skills SET
        name = COALESCE($3, name),
        description = COALESCE($4, description),
        category = COALESCE($5, category),
        query_source = COALESCE($6, query_source),
        saved_query_id = COALESCE($7, saved_query_id),
        saved_query_name = COALESCE($8, saved_query_name),
        inline_sql = COALESCE($9, inline_sql),
        classify_enabled = COALESCE($10, classify_enabled),
        classify_bad = COALESCE($11, classify_bad),
        classify_good = COALESCE($12, classify_good),
        synthesize_enabled = COALESCE($13, synthesize_enabled),
        synthesize_tone = COALESCE($14, synthesize_tone),
        synthesize_custom_prompt = COALESCE($15, synthesize_custom_prompt),
        output_slack = COALESCE($16, output_slack),
        output_report = COALESCE($17, output_report),
        schedule_cron = $18,
        replaces_skill_id = $19,
        updated_at = now()
       WHERE workspace_id = $1 AND skill_id = $2 AND status = 'active'
       RETURNING *`,
      [
        workspaceId, skillId,
        name ?? null, description ?? null, category ?? null,
        query_source ?? null, saved_query_id ?? null, saved_query_name ?? null, inline_sql ?? null,
        classify_enabled ?? null, classify_bad ?? null, classify_good ?? null,
        synthesize_enabled ?? null, synthesize_tone ?? null, synthesize_custom_prompt ?? null,
        output_slack ?? null, output_report ?? null,
        schedule_cron ?? null, replaces_skill_id ?? null,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    const row = result.rows[0];

    await registerCustomSkill(skillId, workspaceId);

    unregisterCustomSkillCron(skillId);
    if (row.schedule_cron) {
      registerCustomSkillCron(row as any);
    }

    return res.json({ skill: row, registered: true });
  } catch (err: any) {
    console.error('[custom-skills] PUT error:', err);
    return res.status(500).json({ error: 'Failed to update custom skill' });
  }
});

/**
 * DELETE /:workspaceId/skills/custom/:skillId
 * Soft-delete (disable) a custom skill
 */
router.delete('/:workspaceId/skills/custom/:skillId', async (req, res) => {
  try {
    const { workspaceId, skillId } = req.params as Record<string, string>;

    const result = await query(
      `UPDATE custom_skills SET status = 'disabled', updated_at = now()
       WHERE workspace_id = $1 AND skill_id = $2 AND status = 'active'
       RETURNING id`,
      [workspaceId, skillId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    unregisterCustomSkill(skillId);
    unregisterCustomSkillCron(skillId);

    return res.json({ disabled: true });
  } catch (err: any) {
    console.error('[custom-skills] DELETE error:', err);
    return res.status(500).json({ error: 'Failed to delete custom skill' });
  }
});

/**
 * POST /:workspaceId/skills/custom/:skillId/run
 * Trigger an on-demand run of a custom skill
 */
router.post('/:workspaceId/skills/custom/:skillId/run', requirePermission('skills.run_manual'), async (req, res) => {
  try {
    const { workspaceId, skillId } = req.params as Record<string, string>;
    const registry = getSkillRegistry();
    const skill = registry.get(skillId);
    if (!skill) {
      return res.status(404).json({ error: `Skill not found: ${skillId}` });
    }

    const runtime = getSkillRuntime();
    let result;
    try {
      result = await runtime.executeSkill(skill, workspaceId, req.body?.params || {});
    } catch (err: any) {
      return res.status(500).json({ error: `Skill execution failed: ${err.message}` });
    }

    try {
      await query(
        `INSERT INTO skill_runs (run_id, workspace_id, skill_id, status, trigger_type, params, result, output, output_text, steps, token_usage, duration_ms, error, started_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (run_id) DO NOTHING`,
        [
          result.runId, workspaceId, skillId, result.status, 'manual',
          JSON.stringify({}),
          result.stepData ? JSON.stringify(result.stepData) : null,
          result.output ? JSON.stringify(result.output) : null,
          typeof result.output === 'string' ? result.output : result.output ? JSON.stringify(result.output) : null,
          JSON.stringify(result.steps),
          JSON.stringify(result.totalTokenUsage),
          result.totalDuration_ms,
          (result.errors?.length ?? 0) > 0 ? (result.errors ?? []).map((e: any) => `${e.step}: ${e.error}`).join('; ') : null,
          result.completedAt,
          result.completedAt,
        ]
      );

      if (result.status === 'completed') {
        await query(
          `UPDATE custom_skills SET last_run_at = now(), run_count = run_count + 1 WHERE skill_id = $1 AND workspace_id = $2`,
          [skillId, workspaceId]
        );
        // Refresh the registry entry so runCount is up-to-date immediately —
        // the override guard activates on the very first SUCCESSFUL run without needing a restart.
        // Intentionally not called for 'failed' or 'partial' — a broken replacement must not
        // suppress the built-in it overrides.
        await registerCustomSkill(skillId, workspaceId).catch(() => {});
      } else {
        // Still record last_run_at so the UI shows when it was last attempted,
        // but do NOT increment run_count or refresh the registry.
        await query(
          `UPDATE custom_skills SET last_run_at = now() WHERE skill_id = $1 AND workspace_id = $2`,
          [skillId, workspaceId]
        );
      }
    } catch (logErr) {
      console.error('[custom-skills] Failed to log skill run:', logErr);
    }

    return res.json({
      runId: result.runId,
      status: result.status,
      duration_ms: result.totalDuration_ms,
    });
  } catch (err: any) {
    console.error('[custom-skills] RUN error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
