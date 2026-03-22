CREATE TABLE IF NOT EXISTS mcp_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id)
    ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  input_summary TEXT,
  output_summary TEXT,
  duration_ms INTEGER,
  error TEXT,
  called_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_calls_workspace
  ON mcp_calls(workspace_id, called_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_calls_tool
  ON mcp_calls(workspace_id, tool_name, called_at DESC);
