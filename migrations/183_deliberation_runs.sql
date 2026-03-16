CREATE TABLE IF NOT EXISTS deliberation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL DEFAULT 'prosecutor_defense',
  trigger_surface TEXT NOT NULL DEFAULT 'ask_pandora',
  trigger_query TEXT,
  entity_type TEXT DEFAULT 'deal',
  entity_id TEXT,
  perspectives JSONB NOT NULL,
  verdict JSONB,
  token_cost INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deliberation_runs_workspace ON deliberation_runs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliberation_runs_entity ON deliberation_runs(workspace_id, entity_type, entity_id);
