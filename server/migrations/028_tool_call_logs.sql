-- Tool call logging table for tracking every tool invocation across all callers
CREATE TABLE IF NOT EXISTS tool_call_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID,
  tool_name   TEXT NOT NULL,
  called_by   TEXT NOT NULL CHECK (called_by IN ('skill_run', 'ask_pandora', 'playground')),
  skill_id    TEXT,
  duration_ms INT,
  result_row_count INT,
  result_empty BOOL,
  error       TEXT,
  called_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tool_call_logs_workspace
  ON tool_call_logs(workspace_id, called_at DESC);

CREATE INDEX IF NOT EXISTS idx_tool_call_logs_tool
  ON tool_call_logs(workspace_id, tool_name, called_at DESC);

CREATE INDEX IF NOT EXISTS idx_tool_call_logs_called_by
  ON tool_call_logs(workspace_id, called_by, called_at DESC);
