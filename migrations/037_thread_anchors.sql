CREATE TABLE IF NOT EXISTS thread_anchors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  surface TEXT NOT NULL DEFAULT 'slack',
  channel_id TEXT,
  message_ts TEXT,
  skill_run_id UUID,
  agent_run_id UUID,
  report_type TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel_id, message_ts)
);

CREATE INDEX IF NOT EXISTS idx_thread_anchors_lookup ON thread_anchors(channel_id, message_ts);
CREATE INDEX IF NOT EXISTS idx_thread_anchors_workspace ON thread_anchors(workspace_id, created_at DESC);

INSERT INTO thread_anchors (workspace_id, channel_id, message_ts, skill_run_id, report_type, created_at)
SELECT sr.workspace_id, sr.slack_channel_id, sr.slack_message_ts, sr.run_id, sr.skill_id, sr.completed_at
FROM skill_runs sr
WHERE sr.slack_message_ts IS NOT NULL
  AND sr.slack_channel_id IS NOT NULL
ON CONFLICT (channel_id, message_ts) DO NOTHING;
