CREATE TABLE IF NOT EXISTS calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_data JSONB NOT NULL DEFAULT '{}',
  call_date TIMESTAMPTZ,
  duration_seconds INTEGER,
  direction TEXT,
  participants JSONB NOT NULL DEFAULT '[]',
  recording_url TEXT,
  deal_id UUID,
  contact_id UUID,
  account_id UUID,
  outcome TEXT,
  notes TEXT,
  custom_fields JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_calls_workspace ON calls(workspace_id);
CREATE INDEX IF NOT EXISTS idx_calls_source ON calls(workspace_id, source, source_id);
