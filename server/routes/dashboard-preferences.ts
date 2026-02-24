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
    const userId = req.user?.user_id;

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
    const userId = req.user?.user_id;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const updates = req.body;

    const existing = await query(
      `SELECT * FROM user_dashboard_preferences WHERE user_id = $1 AND workspace_id = $2`,
      [userId, workspaceId]
    );

    const merged = {
      sections_config: JSON.stringify({
        ...(existing.rows[0]?.sections_config || DEFAULT_PREFERENCES.sections_config),
        ...(updates.sections_config || {}),
      }),
      metric_cards: JSON.stringify({
        ...(existing.rows[0]?.metric_cards || DEFAULT_PREFERENCES.metric_cards),
        ...(updates.metric_cards || {}),
      }),
      pipeline_viz_mode: updates.pipeline_viz_mode ?? existing.rows[0]?.pipeline_viz_mode ?? DEFAULT_PREFERENCES.pipeline_viz_mode,
      monte_carlo_overlay: updates.monte_carlo_overlay ?? existing.rows[0]?.monte_carlo_overlay ?? DEFAULT_PREFERENCES.monte_carlo_overlay,
      default_time_range: updates.default_time_range ?? existing.rows[0]?.default_time_range ?? DEFAULT_PREFERENCES.default_time_range,
    };

    const result = await query(
      `INSERT INTO user_dashboard_preferences (user_id, workspace_id, sections_config, metric_cards, pipeline_viz_mode, monte_carlo_overlay, default_time_range)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7)
       ON CONFLICT (user_id, workspace_id)
       DO UPDATE SET
         sections_config = $3::jsonb,
         metric_cards = $4::jsonb,
         pipeline_viz_mode = $5,
         monte_carlo_overlay = $6,
         default_time_range = $7,
         updated_at = now()
       RETURNING sections_config, metric_cards, pipeline_viz_mode, monte_carlo_overlay, default_time_range, updated_at`,
      [userId, workspaceId, merged.sections_config, merged.metric_cards, merged.pipeline_viz_mode, merged.monte_carlo_overlay, merged.default_time_range]
    );

    res.json(result.rows[0]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[dashboard-preferences] PUT error:', msg);
    res.status(500).json({ error: 'Failed to update dashboard preferences' });
  }
});

export default router;
