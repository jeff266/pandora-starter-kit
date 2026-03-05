-- Migration 128: Create prospect_tree_models table for Tier 4 recursive tree models
-- Part of Prospect Score Consolidation Step 2: Schema Extension

CREATE TABLE IF NOT EXISTS prospect_tree_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tree_json JSONB NOT NULL,
  leaf_count INTEGER NOT NULL,
  max_depth INTEGER NOT NULL,
  training_deals INTEGER NOT NULL,
  outcome_variables TEXT[] NOT NULL,
  feature_candidates TEXT[] NOT NULL,
  features_used TEXT[] NOT NULL,
  build_duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  superseded_at TIMESTAMPTZ
);

CREATE INDEX idx_tree_models_workspace
  ON prospect_tree_models(workspace_id, status);

CREATE INDEX idx_tree_models_active
  ON prospect_tree_models(workspace_id, created_at DESC)
  WHERE status = 'active';
