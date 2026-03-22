CREATE TABLE IF NOT EXISTS claude_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id)
    ON DELETE CASCADE,

  insight_text TEXT NOT NULL,
  insight_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',

  trigger_surface TEXT NOT NULL DEFAULT 'mcp',
  trigger_query TEXT,
  mcp_call_id UUID,
  tool_name TEXT,

  entity_type TEXT,
  entity_id UUID,
  entity_name TEXT,

  status TEXT NOT NULL DEFAULT 'active',
  dismissed_at TIMESTAMPTZ,
  actioned_at TIMESTAMPTZ,

  content_hash TEXT,
  CONSTRAINT uq_claude_insight_hash
    UNIQUE (workspace_id, content_hash),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claude_insights_workspace
  ON claude_insights(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_claude_insights_type
  ON claude_insights(workspace_id, insight_type, severity);
CREATE INDEX IF NOT EXISTS idx_claude_insights_entity
  ON claude_insights(workspace_id, entity_type, entity_id)
  WHERE entity_id IS NOT NULL;
