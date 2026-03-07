-- Migration 142: Slack conversational interface infrastructure
-- Adds slack_message_ts/slack_channel_id to weekly_briefs for thread routing
-- Adds use_consolidated_brief flag to slack_channel_config for noise reduction

DO $$
BEGIN

  -- weekly_briefs: store the Slack message ref after posting the brief
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'weekly_briefs' AND column_name = 'slack_message_ts'
  ) THEN
    ALTER TABLE weekly_briefs ADD COLUMN slack_message_ts TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'weekly_briefs' AND column_name = 'slack_channel_id'
  ) THEN
    ALTER TABLE weekly_briefs ADD COLUMN slack_channel_id TEXT;
  END IF;

  -- slack_channel_config: consolidated brief mode flag
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'slack_channel_config' AND column_name = 'use_consolidated_brief'
  ) THEN
    ALTER TABLE slack_channel_config ADD COLUMN use_consolidated_brief BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;

END $$;

-- Index for looking up brief threads by Slack message timestamp
CREATE INDEX IF NOT EXISTS idx_weekly_briefs_slack_message_ts
  ON weekly_briefs (slack_message_ts, slack_channel_id)
  WHERE slack_message_ts IS NOT NULL;

COMMENT ON COLUMN weekly_briefs.slack_message_ts IS 'Slack message timestamp (ts) of the posted brief — used for thread routing';
COMMENT ON COLUMN weekly_briefs.slack_channel_id IS 'Slack channel ID where the brief was posted';
COMMENT ON COLUMN slack_channel_config.use_consolidated_brief IS 'When true, skill runs no longer post to Slack individually — findings are consolidated into the weekly brief';
