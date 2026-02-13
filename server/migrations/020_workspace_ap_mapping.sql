ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS ap_project_id TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'starter';

CREATE TABLE IF NOT EXISTS workspace_ap_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connector_type TEXT NOT NULL,
  ap_connection_id TEXT NOT NULL,
  ap_project_id TEXT,
  piece_name TEXT NOT NULL,
  external_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stale', 'deleted')),
  provisioned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  refreshed_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, connector_type)
);

CREATE INDEX IF NOT EXISTS idx_workspace_ap_connections_workspace ON workspace_ap_connections(workspace_id);
