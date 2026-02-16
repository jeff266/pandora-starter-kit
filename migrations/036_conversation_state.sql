CREATE TABLE IF NOT EXISTS conversation_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  thread_ts TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'slack',
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  skill_run_id UUID REFERENCES skill_runs(run_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_state_thread
  ON conversation_state(workspace_id, channel_id, thread_ts);

CREATE INDEX IF NOT EXISTS idx_conversation_state_expires
  ON conversation_state(expires_at);

CREATE TABLE IF NOT EXISTS conversation_rate_limits (
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  window_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('hour', now()),
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, window_start)
);
