CREATE TABLE IF NOT EXISTS context_layer (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  business_model JSONB NOT NULL DEFAULT '{}',
  team_structure JSONB NOT NULL DEFAULT '{}',
  goals_and_targets JSONB NOT NULL DEFAULT '{}',
  definitions JSONB NOT NULL DEFAULT '{}',
  operational_maturity JSONB NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

CREATE INDEX idx_context_layer_workspace ON context_layer(workspace_id);
