-- Forecast category probability thresholds
-- Used to derive forecast_category from deal stage probability when no native property exists

CREATE TABLE IF NOT EXISTS forecast_thresholds (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  commit_threshold NUMERIC(5,2) NOT NULL DEFAULT 90.00
    CHECK (commit_threshold >= 0 AND commit_threshold <= 100),
  best_case_threshold NUMERIC(5,2) NOT NULL DEFAULT 60.00
    CHECK (best_case_threshold >= 0 AND best_case_threshold <= 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT thresholds_order CHECK (commit_threshold >= best_case_threshold)
);

-- Seed defaults for existing workspaces
INSERT INTO forecast_thresholds (workspace_id, commit_threshold, best_case_threshold)
SELECT id, 90.00, 60.00
FROM workspaces
ON CONFLICT (workspace_id) DO NOTHING;

COMMENT ON TABLE forecast_thresholds IS
  'Probability thresholds for deriving forecast_category from deal stage probability';

COMMENT ON COLUMN forecast_thresholds.commit_threshold IS
  'Probability >= this value → forecast_category = ''commit'' (default: 90%)';

COMMENT ON COLUMN forecast_thresholds.best_case_threshold IS
  'Probability >= this value → forecast_category = ''best_case'' (default: 60%)';
