-- Migration 130: activity_signal_runs table
--
-- Tracks extraction job runs to prevent duplicate processing
-- One row per activity, updated on each extraction attempt

CREATE TABLE IF NOT EXISTS activity_signal_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  activity_id UUID NOT NULL UNIQUE,
  status TEXT NOT NULL,       -- 'completed' | 'skipped' | 'failed'
  skip_reason TEXT,           -- e.g., 'body_too_short', 'no_headers', 'already_processed'
  signals_extracted INTEGER,  -- count of signals inserted for this activity
  tokens_used INTEGER,        -- DeepSeek tokens consumed (0 for header_parse)
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for checking if activity has been processed
CREATE INDEX IF NOT EXISTS idx_activity_signal_runs_workspace_activity
  ON activity_signal_runs (workspace_id, activity_id);

-- Index for status queries
CREATE INDEX IF NOT EXISTS idx_activity_signal_runs_status
  ON activity_signal_runs (status, processed_at);

COMMENT ON TABLE activity_signal_runs IS 'Tracks extraction job runs to prevent duplicate processing of activities';
COMMENT ON COLUMN activity_signal_runs.skip_reason IS 'Why extraction was skipped (body_too_short, no_headers, etc.)';
COMMENT ON COLUMN activity_signal_runs.tokens_used IS 'DeepSeek tokens consumed (0 for header_parse only)';
