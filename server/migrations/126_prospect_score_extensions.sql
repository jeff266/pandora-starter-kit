-- Migration 126: Prospect Score Extensions
-- Extends lead_scores for full prospect scoring + two new tables

-- ============================================================================
-- 1. EXTEND lead_scores TABLE
-- ============================================================================

ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS fit_score INTEGER;
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS engagement_score_component INTEGER;
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS intent_score INTEGER;
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS timing_score INTEGER;
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS score_factors JSONB;
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS score_summary TEXT;
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS segment_id TEXT;
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS segment_label TEXT;
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS segment_benchmarks JSONB;
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS recommended_action TEXT;
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS top_positive_factor TEXT;
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS top_negative_factor TEXT;
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS score_confidence NUMERIC(3,2);
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS source_object TEXT;

-- ============================================================================
-- 2. CREATE prospect_tree_models TABLE
-- ============================================================================

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

CREATE INDEX IF NOT EXISTS idx_tree_models_workspace
  ON prospect_tree_models(workspace_id, status);

-- ============================================================================
-- 3. CREATE prospect_score_history TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS prospect_score_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_score_history_contact
  ON prospect_score_history(contact_id, scored_at DESC);

CREATE INDEX IF NOT EXISTS idx_score_history_workspace
  ON prospect_score_history(workspace_id, scored_at DESC);
