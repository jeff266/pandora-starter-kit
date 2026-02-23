-- Phase 3: Agent Memory — Self-Reference Across Runs
-- Store rolling memory per agent (context_layer has different structure)

CREATE TABLE IF NOT EXISTS agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  memory JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_lookup
  ON agent_memory(workspace_id, agent_id);
