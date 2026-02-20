-- Migration: Notifications
-- Create notifications table for in-app notifications

CREATE TABLE IF NOT EXISTS notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT,
  action_url      TEXT,
  read            BOOLEAN NOT NULL DEFAULT false,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, workspace_id, read)
  WHERE read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_created
  ON notifications(user_id, created_at DESC);

COMMENT ON TABLE notifications IS 'In-app notification system for workspace events';
COMMENT ON COLUMN notifications.type IS 'Notification type: invite_received | invite_request_submitted | invite_request_resolved | agent_pending_review | agent_review_resolved | skill_run_request | skill_run_resolved | member_suspended | role_changed';
COMMENT ON COLUMN notifications.action_url IS 'Optional URL to navigate to when clicking notification';
