CREATE TABLE IF NOT EXISTS config_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  source_skill VARCHAR(100) NOT NULL,
  source_run_id UUID,
  section VARCHAR(100) NOT NULL,
  path VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('confirm', 'adjust', 'add', 'remove', 'alert')),
  message TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '',
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0.5,
  suggested_value JSONB,
  current_value JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_config_suggestions_workspace ON config_suggestions(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_config_suggestions_dedup ON config_suggestions(workspace_id, section, path, type) WHERE status = 'pending';
