-- Add new columns to account_signals (existing table, add only what's missing)
ALTER TABLE account_signals
  ADD COLUMN IF NOT EXISTS scrape_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS enrichment_method TEXT,
  ADD COLUMN IF NOT EXISTS raw_serper_data JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS industry TEXT,
  ADD COLUMN IF NOT EXISTS business_model TEXT,
  ADD COLUMN IF NOT EXISTS employee_range TEXT,
  ADD COLUMN IF NOT EXISTS growth_stage TEXT,
  ADD COLUMN IF NOT EXISTS classification_confidence INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scraped_text TEXT,
  ADD COLUMN IF NOT EXISTS scraped_url TEXT;

-- Create account_scores table (separate from lead_scores which is for contacts/deals)
CREATE TABLE IF NOT EXISTS account_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  total_score INTEGER NOT NULL DEFAULT 0,
  grade TEXT NOT NULL DEFAULT 'F',
  score_breakdown JSONB NOT NULL DEFAULT '{}',
  icp_fit_details JSONB DEFAULT '{}',
  scoring_mode TEXT NOT NULL DEFAULT 'point_based',
  icp_profile_id UUID,
  data_confidence INTEGER DEFAULT 0,
  scored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  previous_score INTEGER,
  score_delta INTEGER,
  stale_after TIMESTAMPTZ DEFAULT now() + interval '7 days',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_account_scores_workspace
  ON account_scores(workspace_id, grade, total_score DESC);
CREATE INDEX IF NOT EXISTS idx_account_scores_stale
  ON account_scores(workspace_id, stale_after);
CREATE INDEX IF NOT EXISTS idx_account_signals_status
  ON account_signals(workspace_id, scrape_status);
