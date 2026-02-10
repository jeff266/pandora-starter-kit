CREATE TABLE IF NOT EXISTS sync_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connector_type TEXT NOT NULL,
  sync_type TEXT NOT NULL DEFAULT 'incremental',
  status TEXT NOT NULL DEFAULT 'running',
  records_synced INTEGER NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]',
  duration_ms INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_sync_log_workspace ON sync_log(workspace_id, started_at DESC);
CREATE INDEX idx_sync_log_status ON sync_log(status) WHERE status = 'running';
