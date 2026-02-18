-- Migration 048: Account Scoring
-- Adds enrichment_source and data_quality columns to account_signals
-- Creates account_scores table for point-based scoring

-- Extend account_signals with enrichment metadata
ALTER TABLE account_signals
  ADD COLUMN IF NOT EXISTS enrichment_source TEXT DEFAULT 'serper',
  ADD COLUMN IF NOT EXISTS data_quality TEXT DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS web_scrape_data JSONB,
  ADD COLUMN IF NOT EXISTS company_type TEXT;

-- Account scores table
CREATE TABLE IF NOT EXISTS account_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  total_score INTEGER NOT NULL DEFAULT 0,
  grade TEXT NOT NULL DEFAULT 'D',
  firmographic_score INTEGER NOT NULL DEFAULT 0,
  engagement_score INTEGER NOT NULL DEFAULT 0,
  signal_score INTEGER NOT NULL DEFAULT 0,
  relationship_score INTEGER NOT NULL DEFAULT 0,
  breakdown JSONB NOT NULL DEFAULT '{}',
  scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_account_scores_workspace ON account_scores(workspace_id);
CREATE INDEX IF NOT EXISTS idx_account_scores_grade ON account_scores(workspace_id, grade);
CREATE INDEX IF NOT EXISTS idx_account_scores_total ON account_scores(workspace_id, total_score DESC);
