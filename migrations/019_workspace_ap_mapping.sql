-- Add AP project mapping to workspaces
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS ap_project_id TEXT;
CREATE INDEX IF NOT EXISTS idx_workspaces_ap_project ON workspaces(ap_project_id) WHERE ap_project_id IS NOT NULL;

-- Track which AP connections belong to which workspace/connector pair
-- (Denormalized from AP's internal state for fast lookups during token refresh)
CREATE TABLE IF NOT EXISTS workspace_ap_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connector_type TEXT NOT NULL,           -- 'hubspot', 'salesforce', 'slack'
  ap_connection_id TEXT NOT NULL,         -- AP's connection ID
  ap_project_id TEXT NOT NULL,            -- AP's project ID
  piece_name TEXT NOT NULL,               -- '@activepieces/piece-hubspot'
  external_id TEXT NOT NULL,              -- 'pandora_hubspot_ws_abc123'
  last_synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, connector_type)
);

CREATE INDEX IF NOT EXISTS idx_ws_ap_conn_workspace ON workspace_ap_connections(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ws_ap_conn_type ON workspace_ap_connections(workspace_id, connector_type);
