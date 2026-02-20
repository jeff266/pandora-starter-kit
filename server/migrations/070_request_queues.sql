-- Migration: Request queues for skill runs and member invites
-- Enables non-admin users to request actions that require approval

CREATE TABLE IF NOT EXISTS skill_run_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  requester_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_key       TEXT NOT NULL,
  request_reason  TEXT,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  approved_by     UUID REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skill_run_requests_workspace
  ON skill_run_requests(workspace_id, status);

CREATE TABLE IF NOT EXISTS member_invite_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  requester_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_email    TEXT NOT NULL,
  invite_name     TEXT,
  suggested_role  TEXT NOT NULL DEFAULT 'viewer',
  request_reason  TEXT,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  approved_by     UUID REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_invite_requests_workspace
  ON member_invite_requests(workspace_id, status);

COMMENT ON TABLE skill_run_requests IS 'Requests from non-admin users to run restricted skills';
COMMENT ON TABLE member_invite_requests IS 'Requests from managers/analysts to invite new workspace members';
