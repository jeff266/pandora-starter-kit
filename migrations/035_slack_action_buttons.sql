-- Slack messages tracking table
CREATE TABLE IF NOT EXISTS slack_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  channel_id TEXT NOT NULL,
  message_ts TEXT NOT NULL,
  skill_run_id UUID REFERENCES skill_runs(run_id),
  action_id UUID REFERENCES actions(id),
  message_type TEXT NOT NULL DEFAULT 'skill_report',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_slack_messages_ts ON slack_messages(channel_id, message_ts);
CREATE INDEX IF NOT EXISTS idx_slack_messages_run ON slack_messages(skill_run_id);

-- Add execution_result column to actions (used by executor.ts but missing)
ALTER TABLE actions ADD COLUMN IF NOT EXISTS execution_result JSONB;
