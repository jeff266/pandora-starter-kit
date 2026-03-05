-- Migration 127: Create prospect_score_history table for time-series tracking
-- Part of Prospect Score Consolidation Step 2: Schema Extension

CREATE TABLE IF NOT EXISTS prospect_score_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  total_score INTEGER NOT NULL,
  grade TEXT NOT NULL,
  fit_score INTEGER,
  engagement_score INTEGER,
  intent_score INTEGER,
  timing_score INTEGER,
  segment_id TEXT,
  score_method TEXT,
  scored_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_score_history_entity
  ON prospect_score_history(entity_id, scored_at DESC);

CREATE INDEX idx_score_history_workspace_time
  ON prospect_score_history(workspace_id, scored_at DESC);

CREATE INDEX idx_score_history_workspace_entity
  ON prospect_score_history(workspace_id, entity_type, entity_id, scored_at DESC);
