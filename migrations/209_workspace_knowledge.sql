-- Workspace Knowledge Base
-- Stores unstructured business context learned from conversations.
-- Pattern-based extraction (no LLM calls). Confidence scoring for
-- disambiguation. Used to make Ask Pandora workspace-specific over time.

CREATE TABLE IF NOT EXISTS workspace_knowledge (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id)
                ON DELETE CASCADE,
  key           TEXT NOT NULL,
  value         TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'conversation'
                CHECK (source IN (
                  'conversation', 'calibration', 'inferred'
                )),
  confidence    NUMERIC(3,2) NOT NULL DEFAULT 0.70
                CHECK (confidence >= 0.0 AND confidence <= 1.0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ,
  used_count    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, key)
);

CREATE INDEX IF NOT EXISTS idx_workspace_knowledge_workspace
  ON workspace_knowledge (workspace_id);

CREATE INDEX IF NOT EXISTS idx_workspace_knowledge_confidence
  ON workspace_knowledge (workspace_id, confidence DESC,
    used_count DESC);

COMMENT ON TABLE workspace_knowledge IS
  'Workspace-specific business context learned from
   conversations. Key-value pairs with confidence
   scoring. Used to make Ask Pandora workspace-specific
   over time.';
