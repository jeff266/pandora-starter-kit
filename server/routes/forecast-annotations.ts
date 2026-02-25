import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';

const router = Router();

// ============================================================================
// GET /api/workspaces/:id/forecast/annotations
// ============================================================================

router.get('/:id/forecast/annotations', async (req, res) => {
  try {
    const { id: workspaceId } = req.params;
    const { period } = req.query;

    // Get latest forecast-rollup run
    const latestRun = await query(
      `SELECT output, completed_at FROM skill_runs
       WHERE workspace_id = $1 AND skill_id = 'forecast-rollup' AND status = 'completed'
       ORDER BY completed_at DESC LIMIT 1`,
      [workspaceId]
    );

    if (!latestRun.rows[0]) {
      return res.json({
        annotations: [],
        total_generated: 0,
        total_active: 0,
        snapshot_date: null,
      });
    }

    // Annotations already filtered by merge step during skill execution
    const output = latestRun.rows[0].output;
    let annotations = output.annotations || [];
    const metadata = output.annotations_metadata || {};
    const skillCompletedAt = latestRun.rows[0].completed_at;

    // Post-read filter: Apply any state changes that happened AFTER the skill run
    // This handles the gap between "user dismissed it" and "skill re-runs next Monday"
    const stateChanges = await query(
      `SELECT annotation_id, state, snoozed_until
       FROM forecast_annotation_state
       WHERE workspace_id = $1 AND updated_at > $2`,
      [workspaceId, skillCompletedAt]
    );

    if (stateChanges.rows.length > 0) {
      const stateMap = new Map(stateChanges.rows.map((s: any) => [s.annotation_id, s]));

      annotations = annotations.filter((a: any) => {
        const state = stateMap.get(a.id);
        if (!state) return true; // No state change since skill run

        // Apply dismiss/snooze logic
        if (state.state === 'dismissed') return false;
        if (state.state === 'snoozed' && state.snoozed_until && new Date(state.snoozed_until) > new Date()) {
          return false;
        }

        return true;
      });
    }

    res.json({
      annotations, // Active annotations with post-read filtering applied
      total_generated: metadata.total_before_filter || annotations.length,
      total_active: annotations.length, // Use actual count after post-read filter
      snapshot_date: skillCompletedAt,
    });
  } catch (error) {
    console.error('[ForecastAnnotations] GET error:', error);
    res.status(500).json({ error: 'Failed to fetch annotations' });
  }
});

// ============================================================================
// PATCH /api/workspaces/:id/forecast/annotations/:annotationId
// ============================================================================

const actionSchema = z.enum(['dismiss', 'snooze_1w', 'snooze_2w', 'reactivate']);

router.patch('/:id/forecast/annotations/:annotationId', async (req, res) => {
  try {
    const { id: workspaceId, annotationId } = req.params;
    const { action } = req.body;

    const validAction = actionSchema.parse(action);

    let state: string;
    let snoozedUntil: Date | null;

    switch (validAction) {
      case 'dismiss':
        state = 'dismissed';
        snoozedUntil = null;
        break;
      case 'snooze_1w':
        state = 'snoozed';
        snoozedUntil = new Date(Date.now() + 7 * 86400000);
        break;
      case 'snooze_2w':
        state = 'snoozed';
        snoozedUntil = new Date(Date.now() + 14 * 86400000);
        break;
      case 'reactivate':
        state = 'active';
        snoozedUntil = null;
        break;
    }

    await query(
      `INSERT INTO forecast_annotation_state (workspace_id, annotation_id, state, snoozed_until, updated_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, annotation_id)
       DO UPDATE SET state = $3, snoozed_until = $4, updated_by = $5, updated_at = NOW()`,
      [workspaceId, annotationId, state, snoozedUntil, (req as any).user?.email || 'system']
    );

    res.json({
      ok: true,
      annotation_id: annotationId,
      state,
      snoozed_until: snoozedUntil,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid action. Must be: dismiss, snooze_1w, snooze_2w, or reactivate' });
    }

    console.error('[ForecastAnnotations] PATCH error:', error);
    res.status(500).json({ error: 'Failed to update annotation state' });
  }
});

// ============================================================================
// GET /api/workspaces/:id/forecast/annotations/history
// ============================================================================

router.get('/:id/forecast/annotations/history', async (req, res) => {
  try {
    const { id: workspaceId } = req.params;
    const { weeks = '8' } = req.query;

    const weeksNum = parseInt(weeks as string, 10);
    if (isNaN(weeksNum) || weeksNum < 1 || weeksNum > 52) {
      return res.status(400).json({ error: 'Invalid weeks parameter. Must be between 1 and 52' });
    }

    const runs = await query(
      `SELECT output->>'annotations' AS annotations,
              completed_at AS snapshot_date
       FROM skill_runs
       WHERE workspace_id = $1 AND skill_id = 'forecast-rollup' AND status = 'completed'
       ORDER BY completed_at DESC
       LIMIT $2`,
      [workspaceId, weeksNum]
    );

    const history = runs.rows.map(r => ({
      snapshot_date: r.snapshot_date,
      annotations: r.annotations ? JSON.parse(r.annotations) : [],
    }));

    res.json({ history });
  } catch (error) {
    console.error('[ForecastAnnotations] GET history error:', error);
    res.status(500).json({ error: 'Failed to fetch annotation history' });
  }
});

export default router;
