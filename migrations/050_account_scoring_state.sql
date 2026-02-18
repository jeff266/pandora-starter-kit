-- Migration 050: Account Scoring State Machine
-- Tracks the ICP lock/unlock state per workspace and adds synthesis caching to account_scores.

-- workspace_scoring_state: source of truth for which UI state to render
CREATE TABLE IF NOT EXISTS workspace_scoring_state (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- locked | ready | processing | active
  state                    TEXT NOT NULL DEFAULT 'locked',

  -- Prerequisite tracking (recomputed on every CRM sync)
  closed_won_deals_count   INTEGER NOT NULL DEFAULT 0,
  closed_won_deals_minimum INTEGER NOT NULL DEFAULT 5,

  -- ICP profile linkage (denormalized for fast UI reads)
  active_icp_profile_id    UUID REFERENCES icp_profiles(id),
  icp_last_run_at          TIMESTAMPTZ,
  icp_deals_analyzed       INTEGER,

  -- Scoring coverage
  accounts_total           INTEGER DEFAULT 0,
  accounts_scored          INTEGER DEFAULT 0,
  accounts_enriched        INTEGER DEFAULT 0,

  -- Processing state (for State 3 UI)
  processing_step          TEXT,  -- 'icp_discovery' | 'enriching' | 'scoring'
  processing_started_at    TIMESTAMPTZ,
  processing_skill_run_id  UUID,  -- FK to skill_runs for the active ICP Discovery run

  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now(),

  UNIQUE(workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_scoring_state
  ON workspace_scoring_state(workspace_id, state);

-- Add synthesis caching columns to account_scores
ALTER TABLE account_scores
  ADD COLUMN IF NOT EXISTS synthesis_text              TEXT,
  ADD COLUMN IF NOT EXISTS synthesis_generated_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scoring_mode                TEXT NOT NULL DEFAULT 'generic',
  ADD COLUMN IF NOT EXISTS icp_profile_id              UUID REFERENCES icp_profiles(id);

-- Add deal count columns to icp_profiles (may already exist from 014 migration — safe no-ops)
ALTER TABLE icp_profiles
  ADD COLUMN IF NOT EXISTS deals_analyzed INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS won_deals      INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lost_deals     INTEGER DEFAULT 0;

-- Initialize scoring state for all existing workspaces
INSERT INTO workspace_scoring_state (workspace_id, state, closed_won_deals_count)
SELECT
  w.id,
  CASE
    WHEN COUNT(d.id) FILTER (WHERE d.stage_normalized = 'closed_won') >= 5
    THEN 'ready'
    ELSE 'locked'
  END AS state,
  COUNT(d.id) FILTER (WHERE d.stage_normalized = 'closed_won') AS closed_won_deals_count
FROM workspaces w
LEFT JOIN deals d ON d.workspace_id = w.id
GROUP BY w.id
ON CONFLICT (workspace_id) DO NOTHING;
