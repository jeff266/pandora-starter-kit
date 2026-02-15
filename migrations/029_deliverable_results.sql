-- Migration 029: Deliverable Results Table
--
-- Caches generated deliverable matrices for fast retrieval without regeneration.
-- Each workspace can have one cached deliverable per template type.

CREATE TABLE IF NOT EXISTS deliverable_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  template_type TEXT NOT NULL,

  -- Full outputs stored as JSONB
  discovery JSONB NOT NULL,           -- DiscoveryOutput from dimension discovery
  matrix JSONB NOT NULL,              -- Populated TemplateMatrix

  -- Metadata
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Cost tracking
  total_tokens INTEGER,
  total_duration_ms INTEGER,
  cells_populated INTEGER,
  cells_degraded INTEGER,

  -- Unique constraint per workspace + template type (latest wins)
  CONSTRAINT uq_deliverable_workspace_template UNIQUE (workspace_id, template_type)
);

-- Indexes for fast lookup
CREATE INDEX idx_deliverable_workspace ON deliverable_results (workspace_id);
CREATE INDEX idx_deliverable_generated ON deliverable_results (generated_at DESC);
CREATE INDEX idx_deliverable_type ON deliverable_results (template_type);
