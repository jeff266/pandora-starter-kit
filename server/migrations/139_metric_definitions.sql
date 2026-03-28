-- Migration 139: metric_definitions Table
-- Stores structured metric calculation definitions with numerator/denominator
-- Part of Phase 1 of WorkspaceIntelligence architecture

CREATE TABLE IF NOT EXISTS metric_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Identity
  metric_key TEXT NOT NULL,        -- canonical: 'win_rate', 'pipeline_coverage', 'attainment'
  label TEXT NOT NULL,             -- display: 'Win Rate', 'Pipeline Coverage'
  description TEXT,

  -- Calculation structure
  numerator JSONB NOT NULL,        -- QueryDefinition
  denominator JSONB,               -- QueryDefinition | null (null for non-ratio metrics)
  aggregation_method TEXT NOT NULL CHECK (aggregation_method IN ('ratio', 'sum', 'count', 'avg', 'days')),
  unit TEXT NOT NULL CHECK (unit IN ('ratio', 'currency', 'count', 'days', 'percentage')),

  -- Segmentation
  segmentation_defaults TEXT[],    -- always break by these dimensions when running

  -- Confirmation state
  confidence TEXT NOT NULL DEFAULT 'INFERRED'
    CHECK (confidence IN ('CONFIRMED', 'INFERRED', 'UNKNOWN')),
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  confirmed_value NUMERIC,         -- what they said it should be (from confirmation loop)
  last_computed_value NUMERIC,     -- what Pandora calculated most recently
  last_computed_at TIMESTAMPTZ,

  -- Source
  source TEXT NOT NULL DEFAULT 'SYSTEM'
    CHECK (source IN ('SYSTEM', 'FORWARD_DEPLOY', 'INFERRED', 'USER')),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (workspace_id, metric_key)
);

CREATE INDEX IF NOT EXISTS idx_metric_definitions_workspace ON metric_definitions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_metric_definitions_confidence ON metric_definitions(workspace_id, confidence);

-- Now add FK from standing_hypotheses to metric_definitions
ALTER TABLE standing_hypotheses
  ADD CONSTRAINT IF NOT EXISTS fk_metric_definition
  FOREIGN KEY (metric_definition_id)
  REFERENCES metric_definitions(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_standing_hypotheses_metric_def ON standing_hypotheses(metric_definition_id);

COMMENT ON TABLE metric_definitions IS 'Structured metric calculation definitions with numerator/denominator queries for WorkspaceIntelligence';
COMMENT ON COLUMN metric_definitions.metric_key IS 'Canonical metric identifier (e.g. win_rate, pipeline_coverage, attainment)';
COMMENT ON COLUMN metric_definitions.numerator IS 'QueryDefinition JSONB: { entity, aggregation, conditions, date_scope, joins }';
COMMENT ON COLUMN metric_definitions.denominator IS 'QueryDefinition JSONB for ratio metrics, NULL for non-ratio metrics';
COMMENT ON COLUMN metric_definitions.aggregation_method IS 'How to compute final value: ratio | sum | count | avg | days';
COMMENT ON COLUMN metric_definitions.unit IS 'Display unit: ratio (0-1) | currency ($) | count (#) | days (d) | percentage (%)';
COMMENT ON COLUMN metric_definitions.segmentation_defaults IS 'Dimensions to always break by when computing this metric';
COMMENT ON COLUMN metric_definitions.confidence IS 'Confirmation state: CONFIRMED (user validated) | INFERRED (auto-detected) | UNKNOWN';
COMMENT ON COLUMN metric_definitions.confirmed_value IS 'User-provided expected value for confirmation loop';
COMMENT ON COLUMN metric_definitions.last_computed_value IS 'Most recent Pandora computation result';
COMMENT ON COLUMN metric_definitions.source IS 'Origin: SYSTEM (standard library) | FORWARD_DEPLOY | INFERRED | USER';
