-- Migration 049: Monte Carlo Query Log
-- Stores questions asked against MC simulation runs for audit and future suggestions.

CREATE TABLE IF NOT EXISTS monte_carlo_queries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id       TEXT NOT NULL,
  pipeline_id  TEXT,
  question     TEXT NOT NULL,
  intent_type  TEXT NOT NULL,
  confidence   FLOAT,
  answer       TEXT NOT NULL,
  query_data   JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS monte_carlo_queries_workspace_created
  ON monte_carlo_queries (workspace_id, created_at DESC);
