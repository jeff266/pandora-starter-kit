-- Migration 155: Add slack_user_id to users table
-- Required by Slack DM handler and slash command handler for user role resolution

ALTER TABLE users ADD COLUMN IF NOT EXISTS slack_user_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_users_slack_user_id ON users(slack_user_id) WHERE slack_user_id IS NOT NULL;
