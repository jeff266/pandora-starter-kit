-- Migration: Request Queues
-- Create request queue tables for skill runs and member invitations

CREATE TABLE IF NOT EXISTS skill_run_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  requested_by    UUID NOT NULL REFERENCES users(id),
  skill_id        TEXT NOT NULL,
  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  resolved_by     UUID REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS member_invite_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  requested_by    UUID NOT NULL REFERENCES users(id),
  invitee_email   TEXT NOT NULL,
  proposed_role_id UUID REFERENCES workspace_roles(id),
  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  resolved_by     UUID REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skill_run_requests_workspace
  ON skill_run_requests(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_member_invite_requests_workspace
  ON member_invite_requests(workspace_id, status);

COMMENT ON TABLE skill_run_requests IS 'Analyst requests for admin-approved skill runs';
COMMENT ON COLUMN skill_run_requests.status IS 'Request status: pending | approved | rejected';
COMMENT ON TABLE member_invite_requests IS 'Analyst requests for admin-approved member invitations';
