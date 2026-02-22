CREATE TABLE IF NOT EXISTS filter_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  filter_id TEXT NOT NULL,
  used_by TEXT NOT NULL,
  used_at TIMESTAMPTZ DEFAULT NOW(),
  record_count INTEGER
);

CREATE INDEX IF NOT EXISTS idx_filter_usage_workspace
  ON filter_usage_log(workspace_id, filter_id, used_at DESC);
