-- Migration: Workspace Members
-- Create workspace_members table for workspace membership and invitations

CREATE TABLE IF NOT EXISTS workspace_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id         UUID NOT NULL REFERENCES workspace_roles(id),
  invited_by      UUID REFERENCES users(id),
  invited_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at     TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'pending',
  UNIQUE(workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace
  ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user
  ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_active
  ON workspace_members(workspace_id, status)
  WHERE status = 'active';

COMMENT ON TABLE workspace_members IS 'Workspace membership and invitation tracking';
COMMENT ON COLUMN workspace_members.status IS 'Member status: pending | active | suspended';
COMMENT ON COLUMN workspace_members.invited_by IS 'User who sent the invitation';
COMMENT ON COLUMN workspace_members.accepted_at IS 'When the invitation was accepted (NULL for pending)';
