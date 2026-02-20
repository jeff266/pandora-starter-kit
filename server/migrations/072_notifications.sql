-- Migration: In-app notification system
-- Enables alerts for agent approvals, skill requests, mentions, etc.

CREATE TABLE IF NOT EXISTS notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL, -- agent_review | skill_request | mention | system
  title           TEXT NOT NULL,
  body            TEXT,
  link_url        TEXT,
  link_entity_type TEXT, -- agent | skill | deal | account
  link_entity_id  UUID,
  is_read         BOOLEAN NOT NULL DEFAULT false,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications(user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_workspace
  ON notifications(workspace_id, created_at DESC);

COMMENT ON TABLE notifications IS 'In-app notification system for user alerts';
