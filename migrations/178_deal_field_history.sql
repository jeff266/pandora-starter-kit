-- Migration 178: deal_field_history + forecast_accuracy_log
-- Enables retroactive forecast accuracy computation via field history tracking

-- Table: deal_field_history
-- Stores point-in-time value changes for CRM fields on deals.
-- dealstage changes stay in deal_stage_history (normalized, with duration tracking).
-- All other tracked fields (forecastcategory, amount, closedate) go here as raw TEXT.
CREATE TABLE IF NOT EXISTS deal_field_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  deal_source_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_field_history_deal ON deal_field_history(deal_id, field_name, changed_at);
CREATE INDEX IF NOT EXISTS idx_field_history_workspace ON deal_field_history(workspace_id, field_name, changed_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_field_history_unique
  ON deal_field_history(deal_id, field_name, changed_at, to_value);

-- Table: forecast_accuracy_log
-- One row per workspace × quarter × forecast method.
-- Populated by retro bootstrap job (source='retro') and live skill runs (source='live').
CREATE TABLE IF NOT EXISTS forecast_accuracy_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  quarter_label TEXT NOT NULL,
  quarter_start DATE NOT NULL,
  quarter_end DATE NOT NULL,
  method TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  predicted_arr NUMERIC NOT NULL,
  actual_arr NUMERIC NOT NULL,
  error_abs NUMERIC NOT NULL,
  error_pct NUMERIC NOT NULL,
  error_direction TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'live',
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(workspace_id, quarter_label, method)
);

CREATE INDEX IF NOT EXISTS idx_accuracy_workspace ON forecast_accuracy_log(workspace_id, quarter_start);
