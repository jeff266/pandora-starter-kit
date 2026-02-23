-- Migration: workspace_settings table
-- Description: Generic key-value storage for workspace configuration

CREATE TABLE IF NOT EXISTS workspace_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, key)
);

CREATE INDEX idx_workspace_settings_workspace ON workspace_settings(workspace_id);
CREATE INDEX idx_workspace_settings_key ON workspace_settings(workspace_id, key);
