-- ============================================================
-- Migration 106: Win Pattern Coaching Engine
-- ============================================================
-- Stores discovered patterns that differentiate won from lost deals.
-- Replaces hardcoded coaching assumptions with data-driven insights.
--
-- Principle: Pandora discovers what matters. It never assumes.

CREATE TABLE IF NOT EXISTS win_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- What dimension this pattern measures
  dimension TEXT NOT NULL,

  -- Which deals this pattern applies to (null = all)
  segment_size_min NUMERIC,
  segment_size_max NUMERIC,
  segment_pipeline TEXT,

  -- Won deal distribution
  won_median NUMERIC NOT NULL,
  won_p25 NUMERIC NOT NULL,
  won_p75 NUMERIC NOT NULL,

  -- Lost deal distribution
  lost_median NUMERIC NOT NULL,
  lost_p25 NUMERIC NOT NULL,
  lost_p75 NUMERIC NOT NULL,

  -- Pattern strength and direction
  separation_score NUMERIC NOT NULL CHECK (separation_score >= 0 AND separation_score <= 1),
  direction TEXT NOT NULL CHECK (direction IN ('higher_wins', 'lower_wins')),

  -- Sample sizes
  sample_size_won INTEGER NOT NULL CHECK (sample_size_won >= 0),
  sample_size_lost INTEGER NOT NULL CHECK (sample_size_lost >= 0),

  -- Stage relevance (which stages this pattern matters for)
  relevant_stages TEXT[] NOT NULL DEFAULT '{all}',

  -- Versioning
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at TIMESTAMPTZ,  -- null = current pattern
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fetching current patterns
CREATE INDEX idx_win_patterns_current
  ON win_patterns (workspace_id, dimension)
  WHERE superseded_at IS NULL;

-- Index for pattern history analysis
CREATE INDEX idx_win_patterns_history
  ON win_patterns (workspace_id, discovered_at DESC);

-- Index for segment-based lookups
CREATE INDEX idx_win_patterns_segments
  ON win_patterns (workspace_id, segment_size_min, segment_size_max, segment_pipeline)
  WHERE superseded_at IS NULL;

COMMENT ON TABLE win_patterns IS
  'Discovered patterns that differentiate won from lost deals. Updated periodically as new deals close.';

COMMENT ON COLUMN win_patterns.dimension IS
  'Measurable dimension (e.g., unique_external_participants, call_count, avg_talk_ratio_rep)';

COMMENT ON COLUMN win_patterns.separation_score IS
  'How well this dimension separates won from lost (0-1). Higher = stronger predictor.';

COMMENT ON COLUMN win_patterns.direction IS
  'Whether higher or lower values correlate with winning';

COMMENT ON COLUMN win_patterns.relevant_stages IS
  'Deal stages where this pattern holds. {all} means relevant at all stages.';

COMMENT ON COLUMN win_patterns.superseded_at IS
  'When this pattern was replaced by a newer discovery. NULL = current pattern.';
