-- Migration: User Dashboard Preferences
-- Stores per-user, per-workspace Command Center dashboard customization settings

CREATE TABLE IF NOT EXISTS user_dashboard_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Section visibility and collapse states
  sections_config JSONB NOT NULL DEFAULT '{
    "metrics": { "visible": true, "collapsed": false },
    "pipeline": { "visible": true, "collapsed": false },
    "actions_signals": { "visible": true, "collapsed": false },
    "findings": { "visible": true, "collapsed": false }
  }',

  -- Individual metric card visibility toggles
  metric_cards JSONB NOT NULL DEFAULT '{
    "total_pipeline": true,
    "weighted_pipeline": true,
    "coverage_ratio": true,
    "win_rate": true,
    "open_deals": true,
    "monte_carlo_p50": false
  }',

  -- Pipeline visualization mode preference
  pipeline_viz_mode TEXT NOT NULL DEFAULT 'horizontal_bars',
  -- Options: 'horizontal_bars', 'funnel', 'kanban', 'table'

  -- Monte Carlo overlay toggle (for Phase 2)
  monte_carlo_overlay BOOLEAN NOT NULL DEFAULT false,

  -- Default time range filter
  default_time_range TEXT NOT NULL DEFAULT 'this_week',
  -- Options: 'today', 'this_week', 'this_month', 'this_quarter'

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Ensure one preference record per user per workspace
  UNIQUE(user_id, workspace_id)
);

-- Index for fast lookups by user and workspace
CREATE INDEX IF NOT EXISTS idx_user_dashboard_prefs_user_workspace
  ON user_dashboard_preferences(user_id, workspace_id);

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_dashboard_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_user_dashboard_preferences_updated_at
  BEFORE UPDATE ON user_dashboard_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_user_dashboard_preferences_updated_at();

COMMENT ON TABLE user_dashboard_preferences IS 'Per-user Command Center dashboard customization settings';
COMMENT ON COLUMN user_dashboard_preferences.sections_config IS 'Visibility and collapse state for each dashboard section';
COMMENT ON COLUMN user_dashboard_preferences.metric_cards IS 'Which metric cards to show in the metrics row';
COMMENT ON COLUMN user_dashboard_preferences.pipeline_viz_mode IS 'Selected pipeline visualization mode';
COMMENT ON COLUMN user_dashboard_preferences.default_time_range IS 'Default time range filter for deals';
