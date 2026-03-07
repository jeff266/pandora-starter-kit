-- T001: Brief fingerprinting, change detection, and refresh log

ALTER TABLE weekly_briefs
  ADD COLUMN IF NOT EXISTS fingerprint VARCHAR(64),
  ADD COLUMN IF NOT EXISTS fingerprint_inputs JSONB,
  ADD COLUMN IF NOT EXISTS data_source VARCHAR(20) DEFAULT 'skill_snapshot',
  ADD COLUMN IF NOT EXISTS live_query_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assembled_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS brief_refresh_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  triggered_by VARCHAR(30) NOT NULL,
  fingerprint_before VARCHAR(64),
  fingerprint_after VARCHAR(64),
  data_changed BOOLEAN NOT NULL,
  synthesis_ran BOOLEAN NOT NULL,
  tokens_used INTEGER DEFAULT 0,
  rate_limited BOOLEAN DEFAULT FALSE,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brief_refresh_log_workspace
  ON brief_refresh_log(workspace_id, created_at DESC);
