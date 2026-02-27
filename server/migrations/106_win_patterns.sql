-- Win patterns table: stores data-driven signals discovered from closed-won vs closed-lost deals
-- Each row represents one dimension (e.g. sales_cycle_days) within one deal-size segment

CREATE TABLE IF NOT EXISTS win_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL,
  segment_size_min NUMERIC,
  segment_size_max NUMERIC,
  segment_pipeline TEXT,
  won_median NUMERIC NOT NULL,
  won_p25 NUMERIC NOT NULL,
  won_p75 NUMERIC NOT NULL,
  lost_median NUMERIC NOT NULL,
  lost_p25 NUMERIC NOT NULL,
  lost_p75 NUMERIC NOT NULL,
  separation_score NUMERIC NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('higher_wins', 'lower_wins')),
  sample_size_won INTEGER NOT NULL,
  sample_size_lost INTEGER NOT NULL,
  relevant_stages TEXT[] NOT NULL DEFAULT '{all}',
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_win_patterns_current
  ON win_patterns (workspace_id, dimension)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_win_patterns_history
  ON win_patterns (workspace_id, discovered_at DESC);
