-- Investigation Digest Subscriptions
-- Configures weekly investigation summary emails/Slack messages per workspace

CREATE TABLE IF NOT EXISTS investigation_digest_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subscription_type TEXT NOT NULL DEFAULT 'weekly',
  day_of_week INTEGER, -- 1=Monday, 2=Tuesday, ..., 7=Sunday
  hour_utc INTEGER NOT NULL DEFAULT 9, -- Hour in UTC (0-23)
  timezone TEXT NOT NULL DEFAULT 'UTC',
  email_recipients TEXT[] DEFAULT ARRAY[]::TEXT[],
  slack_channel_id TEXT,
  skill_filters TEXT[], -- Empty = all skills, otherwise specific skill_ids
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_workspace_digest UNIQUE (workspace_id)
);

CREATE INDEX idx_digest_sub_workspace ON investigation_digest_subscriptions(workspace_id);
CREATE INDEX idx_digest_sub_enabled ON investigation_digest_subscriptions(enabled) WHERE enabled = true;

COMMENT ON TABLE investigation_digest_subscriptions IS 'Weekly investigation digest subscriptions (one per workspace)';
COMMENT ON COLUMN investigation_digest_subscriptions.day_of_week IS '1=Monday through 7=Sunday (ISO 8601 standard)';
COMMENT ON COLUMN investigation_digest_subscriptions.hour_utc IS 'Hour in UTC when digest should be sent (0-23)';
COMMENT ON COLUMN investigation_digest_subscriptions.timezone IS 'User timezone for display purposes';
COMMENT ON COLUMN investigation_digest_subscriptions.email_recipients IS 'Array of email addresses to receive digest';
COMMENT ON COLUMN investigation_digest_subscriptions.slack_channel_id IS 'Slack channel ID (e.g., C1234567890)';
COMMENT ON COLUMN investigation_digest_subscriptions.skill_filters IS 'Optional filter for specific skills (empty = all skills)';
