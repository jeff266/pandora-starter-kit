import { Router } from 'express';
import pool from '../db.js';

const router = Router();

const VALID_EVENTS = ['sync_completed', 'deal_stage_changed', 'new_conversation'] as const;

router.post('/skills/:skillId/trigger', async (req, res) => {
  try {
    const { skillId } = req.params;
    const { workspaceId, params } = req.body;

    if (!skillId || typeof skillId !== 'string' || skillId.trim() === '') {
      return res.status(400).json({ error: 'skillId must be a non-empty string' });
    }

    if (!workspaceId || typeof workspaceId !== 'string') {
      return res.status(400).json({ error: 'workspaceId is required' });
    }

    const ws = await pool.query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (ws.rows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const result = await pool.query(
      `INSERT INTO skill_runs (workspace_id, skill_id, status, trigger_type, params)
       VALUES ($1, $2, 'queued', 'webhook', $3)
       RETURNING id, status`,
      [workspaceId, skillId, JSON.stringify(params || {})]
    );

    const run = result.rows[0];
    return res.status(202).json({ runId: run.id, status: run.status });
  } catch (err) {
    console.error('[webhooks] Error triggering skill:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/skills/:skillId/runs/:runId', async (req, res) => {
  try {
    const { skillId, runId } = req.params;

    const result = await pool.query(
      `SELECT id, workspace_id, skill_id, status, trigger_type, params,
              result, output_text, steps, token_usage, duration_ms,
              error, started_at, completed_at, created_at
       FROM skill_runs
       WHERE id = $1 AND skill_id = $2`,
      [runId, skillId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Skill run not found' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error('[webhooks] Error fetching skill run:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/events', async (req, res) => {
  try {
    const { event, workspaceId, data } = req.body;

    if (!event || typeof event !== 'string') {
      return res.status(400).json({ error: 'event is required' });
    }

    if (!VALID_EVENTS.includes(event as typeof VALID_EVENTS[number])) {
      return res.status(400).json({
        error: `event must be one of: ${VALID_EVENTS.join(', ')}`,
      });
    }

    if (!workspaceId || typeof workspaceId !== 'string') {
      return res.status(400).json({ error: 'workspaceId is required' });
    }

    const ws = await pool.query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (ws.rows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    console.log(`[webhooks] Event received: ${event} for workspace ${workspaceId}`, data || {});

    return res.json({ received: true, skillsTriggered: [] });
  } catch (err) {
    console.error('[webhooks] Error processing event:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
