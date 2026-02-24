import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';

const router = Router();

// Default preferences when user hasn't customized yet
const DEFAULT_PREFERENCES = {
  sections_config: {
    metrics: { visible: true, collapsed: false },
    pipeline: { visible: true, collapsed: false },
    actions_signals: { visible: true, collapsed: false },
    findings: { visible: true, collapsed: false },
  },
  metric_cards: {
    total_pipeline: true,
    weighted_pipeline: true,
    coverage_ratio: true,
    win_rate: true,
    open_deals: true,
    monte_carlo_p50: false,
  },
  pipeline_viz_mode: 'horizontal_bars',
  monte_carlo_overlay: false,
  default_time_range: 'this_week',
};

// GET /api/workspaces/:workspaceId/dashboard/preferences
// Returns user's dashboard preferences or defaults if none exist
router.get('/:workspaceId/dashboard/preferences', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    // Try to fetch existing preferences
    const result = await query(
      `SELECT
         sections_config,
         metric_cards,
         pipeline_viz_mode,
         monte_carlo_overlay,
         default_time_range,
         updated_at
       FROM user_dashboard_preferences
       WHERE user_id = $1 AND workspace_id = $2`,
      [userId, workspaceId]
    );

    if (result.rows.length > 0) {
      // User has customized preferences
      const prefs = result.rows[0];
      res.json({
        sections_config: prefs.sections_config,
        metric_cards: prefs.metric_cards,
        pipeline_viz_mode: prefs.pipeline_viz_mode,
        monte_carlo_overlay: prefs.monte_carlo_overlay,
        default_time_range: prefs.default_time_range,
        updated_at: prefs.updated_at,
      });
    } else {
      // Return defaults
      res.json(DEFAULT_PREFERENCES);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[dashboard-preferences] GET error:', msg);
    res.status(500).json({ error: 'Failed to fetch dashboard preferences' });
  }
});

// PUT /api/workspaces/:workspaceId/dashboard/preferences
// Updates user's dashboard preferences (partial update with JSONB merge)
router.put('/:workspaceId/dashboard/preferences', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const updates = req.body;

    // Build SET clauses dynamically based on what's being updated
    const setClauses: string[] = [];
    const params: any[] = [userId, workspaceId];
    let paramIdx = 3;

    // Handle JSONB fields with deep merge
    if (updates.sections_config !== undefined) {
      setClauses.push(`sections_config = COALESCE(sections_config, '{}'::jsonb) || $${paramIdx}::jsonb`);
      params.push(JSON.stringify(updates.sections_config));
      paramIdx++;
    }

    if (updates.metric_cards !== undefined) {
      setClauses.push(`metric_cards = COALESCE(metric_cards, '{}'::jsonb) || $${paramIdx}::jsonb`);
      params.push(JSON.stringify(updates.metric_cards));
      paramIdx++;
    }

    // Handle scalar fields
    if (updates.pipeline_viz_mode !== undefined) {
      setClauses.push(`pipeline_viz_mode = $${paramIdx}`);
      params.push(updates.pipeline_viz_mode);
      paramIdx++;
    }

    if (updates.monte_carlo_overlay !== undefined) {
      setClauses.push(`monte_carlo_overlay = $${paramIdx}`);
      params.push(updates.monte_carlo_overlay);
      paramIdx++;
    }

    if (updates.default_time_range !== undefined) {
      setClauses.push(`default_time_range = $${paramIdx}`);
      params.push(updates.default_time_range);
      paramIdx++;
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    // Upsert with ON CONFLICT
    const setClause = setClauses.join(', ');

    const result = await query(
      `INSERT INTO user_dashboard_preferences (user_id, workspace_id, sections_config, metric_cards, pipeline_viz_mode, monte_carlo_overlay, default_time_range)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, workspace_id)
       DO UPDATE SET ${setClause}
       RETURNING
         sections_config,
         metric_cards,
         pipeline_viz_mode,
         monte_carlo_overlay,
         default_time_range,
         updated_at`,
      [
        userId,
        workspaceId,
        JSON.stringify(DEFAULT_PREFERENCES.sections_config),
        JSON.stringify(DEFAULT_PREFERENCES.metric_cards),
        DEFAULT_PREFERENCES.pipeline_viz_mode,
        DEFAULT_PREFERENCES.monte_carlo_overlay,
        DEFAULT_PREFERENCES.default_time_range,
        ...params.slice(2), // Add the update params
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[dashboard-preferences] PUT error:', msg);
    res.status(500).json({ error: 'Failed to update dashboard preferences' });
  }
});

export default router;
