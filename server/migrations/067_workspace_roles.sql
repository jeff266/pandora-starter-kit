-- Migration: Workspace Roles
-- Create workspace_roles table for role-based access control

CREATE TABLE IF NOT EXISTS workspace_roles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  is_system       BOOLEAN NOT NULL DEFAULT false,
  system_type     TEXT,  -- 'admin' | 'manager' | 'analyst' | 'viewer' | NULL for custom
  permissions     JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_workspace_roles_workspace
  ON workspace_roles(workspace_id);

COMMENT ON TABLE workspace_roles IS 'Role definitions for workspace members';
COMMENT ON COLUMN workspace_roles.is_system IS 'System-managed role (cannot be deleted)';
COMMENT ON COLUMN workspace_roles.system_type IS 'System role type for built-in roles';
COMMENT ON COLUMN workspace_roles.permissions IS 'JSONB permission object defining what this role can do';
