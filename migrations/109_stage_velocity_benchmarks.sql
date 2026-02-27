CREATE TABLE IF NOT EXISTS stage_velocity_benchmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pipeline TEXT NOT NULL DEFAULT 'all',
  stage_normalized TEXT NOT NULL,
  segment TEXT NOT NULL DEFAULT 'all',
  outcome TEXT NOT NULL,
  median_days NUMERIC,
  p75_days NUMERIC,
  p90_days NUMERIC,
  sample_size INTEGER NOT NULL DEFAULT 0,
  confidence_tier TEXT NOT NULL DEFAULT 'insufficient',
  is_inverted BOOLEAN NOT NULL DEFAULT FALSE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, pipeline, stage_normalized, segment, outcome)
);

CREATE INDEX IF NOT EXISTS idx_svb_lookup
  ON stage_velocity_benchmarks(workspace_id, stage_normalized, segment);

CREATE INDEX IF NOT EXISTS idx_svb_workspace
  ON stage_velocity_benchmarks(workspace_id, computed_at DESC);
