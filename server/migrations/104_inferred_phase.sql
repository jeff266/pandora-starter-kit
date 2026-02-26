-- Deal phase inference columns
ALTER TABLE deals ADD COLUMN IF NOT EXISTS inferred_phase VARCHAR(50);
ALTER TABLE deals ADD COLUMN IF NOT EXISTS phase_confidence DECIMAL(3,2);
ALTER TABLE deals ADD COLUMN IF NOT EXISTS phase_signals JSONB;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS phase_inferred_at TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS phase_divergence BOOLEAN DEFAULT FALSE;

-- Index for filtering by phase divergence
CREATE INDEX IF NOT EXISTS idx_deals_phase_divergence
  ON deals(workspace_id, phase_divergence)
  WHERE phase_divergence = TRUE;

-- Index for filtering by inferred phase
CREATE INDEX IF NOT EXISTS idx_deals_inferred_phase
  ON deals(workspace_id, inferred_phase)
  WHERE inferred_phase IS NOT NULL;

COMMENT ON COLUMN deals.inferred_phase IS 'Phase inferred from conversation keywords: discovery, evaluation, pilot, negotiation, decision, stalled';
COMMENT ON COLUMN deals.phase_confidence IS 'Confidence score 0.0-1.0 for inferred phase based on keyword hit concentration';
COMMENT ON COLUMN deals.phase_signals IS 'Array of matched keywords with counts: [{keyword, phase, count}]';
COMMENT ON COLUMN deals.phase_divergence IS 'TRUE when inferred_phase differs from stage_normalized and confidence >= 0.6';
