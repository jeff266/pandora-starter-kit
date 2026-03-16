-- Migration 184: Extend deliberation_runs for hypothesis and forecast deliberations
-- Enables Red Team hypothesis deliberation and Confidence Calibration forecast deliberation

ALTER TABLE deliberation_runs
  ADD COLUMN IF NOT EXISTS hypothesis_id UUID REFERENCES standing_hypotheses(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS forecast_run_id UUID;

CREATE INDEX IF NOT EXISTS idx_deliberation_runs_hypothesis
  ON deliberation_runs(workspace_id, hypothesis_id)
  WHERE hypothesis_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deliberation_runs_forecast
  ON deliberation_runs(workspace_id, forecast_run_id)
  WHERE forecast_run_id IS NOT NULL;
