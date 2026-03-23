CREATE TABLE IF NOT EXISTS business_dimensions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id)
                        ON DELETE CASCADE,

  dimension_key       TEXT NOT NULL,
  label               TEXT NOT NULL,
  description         TEXT,

  filter_definition   JSONB NOT NULL DEFAULT '{"operator":"AND","conditions":[]}',

  value_field         TEXT NOT NULL DEFAULT 'amount',
  value_field_label   TEXT NOT NULL DEFAULT 'Amount',
  value_field_type    TEXT NOT NULL DEFAULT 'standard',
  value_transform     JSONB,

  quota_source        TEXT NOT NULL DEFAULT 'workspace_quota',
  quota_field         TEXT,
  quota_value         NUMERIC,
  quota_period        TEXT DEFAULT 'quarterly',

  target_coverage_ratio     NUMERIC,
  target_win_rate           NUMERIC,
  target_avg_sales_cycle    INTEGER,
  target_avg_deal_size      NUMERIC,

  exclusivity         TEXT NOT NULL DEFAULT 'overlapping',
  exclusivity_group   TEXT,
  parent_dimension    TEXT,
  child_dimensions    TEXT[] DEFAULT '{}',

  confirmed           BOOLEAN NOT NULL DEFAULT FALSE,
  confirmed_at        TIMESTAMPTZ,
  confirmed_value     NUMERIC,
  confirmed_deal_count INTEGER,
  calibration_source  TEXT,
  calibration_notes   TEXT,

  display_order       INTEGER DEFAULT 0,
  is_default          BOOLEAN DEFAULT FALSE,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_dimension_key
    UNIQUE (workspace_id, dimension_key)
);

CREATE INDEX IF NOT EXISTS idx_dimensions_workspace
  ON business_dimensions(workspace_id, confirmed);

CREATE INDEX IF NOT EXISTS idx_dimensions_default
  ON business_dimensions(workspace_id)
  WHERE is_default = TRUE;

CREATE TABLE IF NOT EXISTS metric_definitions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id)
                        ON DELETE CASCADE,

  metric_key          TEXT NOT NULL,
  label               TEXT NOT NULL,
  description         TEXT,

  formula             JSONB NOT NULL,

  format              TEXT NOT NULL DEFAULT 'number',
  unit                TEXT NOT NULL DEFAULT '$',

  dimension_overrides JSONB DEFAULT '{}',

  threshold_critical_below  NUMERIC,
  threshold_warning_below   NUMERIC,
  threshold_warning_above   NUMERIC,
  threshold_critical_above  NUMERIC,

  confirmed           BOOLEAN NOT NULL DEFAULT FALSE,
  confirmed_at        TIMESTAMPTZ,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_metric_key
    UNIQUE (workspace_id, metric_key)
);

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS calibration_status TEXT DEFAULT 'not_started';

CREATE INDEX IF NOT EXISTS idx_workspaces_calibration
  ON workspaces(calibration_status);
