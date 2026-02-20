-- Migration: Workspace Flags
-- Create workspace_flags table for feature flags and experiments

CREATE TABLE IF NOT EXISTS workspace_flags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,
  value           JSONB NOT NULL DEFAULT 'true',
  flag_type       TEXT NOT NULL DEFAULT 'feature',
  set_by          TEXT NOT NULL DEFAULT 'system',
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, key)
);

CREATE INDEX IF NOT EXISTS idx_workspace_flags_workspace
  ON workspace_flags(workspace_id);

COMMENT ON TABLE workspace_flags IS 'Feature flags, capabilities, and experiments';
COMMENT ON COLUMN workspace_flags.flag_type IS 'Flag type: feature | capability | experiment';
COMMENT ON COLUMN workspace_flags.set_by IS 'Who set the flag: system | admin | pandora_staff';
COMMENT ON COLUMN workspace_flags.expires_at IS 'Expiration time for experiment flags';
