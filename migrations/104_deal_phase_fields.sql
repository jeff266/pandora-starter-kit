-- Migration 104: Add deal phase inference fields
-- These columns are populated by the compute-fields engine

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS inferred_phase TEXT,
  ADD COLUMN IF NOT EXISTS phase_confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS phase_signals JSONB,
  ADD COLUMN IF NOT EXISTS phase_divergence BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS phase_inferred_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_deals_inferred_phase
  ON deals (workspace_id, inferred_phase)
  WHERE inferred_phase IS NOT NULL;
