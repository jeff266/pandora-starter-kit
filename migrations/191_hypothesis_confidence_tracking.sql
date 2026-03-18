-- Migration 191: Add confidence tracking columns to standing_hypotheses
-- Enables pure arithmetic hypothesis validation by the Orchestrator.
-- New columns support metric_key mapping and confidence score evolution.

-- Add new columns for hypothesis confidence tracking
ALTER TABLE standing_hypotheses
  ADD COLUMN IF NOT EXISTS metric_key TEXT,
  ADD COLUMN IF NOT EXISTS hypothesis_text TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  ADD COLUMN IF NOT EXISTS threshold NUMERIC,
  ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT '$';

-- Backfill metric_key and hypothesis_text from existing columns
UPDATE standing_hypotheses
SET
  metric_key = COALESCE(metric_key, metric),
  hypothesis_text = COALESCE(hypothesis_text, hypothesis),
  threshold = COALESCE(threshold, alert_threshold)
WHERE metric_key IS NULL OR hypothesis_text IS NULL OR threshold IS NULL;

-- Create index for metric_key lookups
CREATE INDEX IF NOT EXISTS idx_standing_hypotheses_metric_key
  ON standing_hypotheses(workspace_id, metric_key);

-- Create index for confidence-based queries
CREATE INDEX IF NOT EXISTS idx_standing_hypotheses_confidence
  ON standing_hypotheses(workspace_id, confidence DESC);

COMMENT ON COLUMN standing_hypotheses.metric_key IS 'Metric identifier for matching with skill_summaries key_metrics (e.g., pipeline-coverage.coverage_ratio)';
COMMENT ON COLUMN standing_hypotheses.hypothesis_text IS 'Human-readable hypothesis statement';
COMMENT ON COLUMN standing_hypotheses.confidence IS 'Confidence score (0-1) adjusted weekly based on evidence. Validated: +0.08, Contradicted: -0.12';
COMMENT ON COLUMN standing_hypotheses.threshold IS 'Numeric threshold for validation. Positive = above, Negative = below (stored as absolute)';
COMMENT ON COLUMN standing_hypotheses.unit IS 'Display unit: $, %, x (ratio), days, or empty';
