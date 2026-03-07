CREATE TABLE IF NOT EXISTS data_dictionary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  definition TEXT,
  technical_definition TEXT,
  source TEXT NOT NULL DEFAULT 'user',
  source_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_referenced_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(workspace_id, term)
);

CREATE INDEX IF NOT EXISTS idx_data_dictionary_workspace ON data_dictionary(workspace_id);
CREATE INDEX IF NOT EXISTS idx_data_dictionary_source ON data_dictionary(workspace_id, source);
