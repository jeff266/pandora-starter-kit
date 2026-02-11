-- Quota Periods Table
-- Stores time-based quota periods (monthly, quarterly, annual)

CREATE TABLE IF NOT EXISTS quota_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  period_type TEXT NOT NULL CHECK (period_type IN ('monthly', 'quarterly', 'annual')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  team_quota NUMERIC(15,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_date_range CHECK (end_date > start_date),
  UNIQUE(workspace_id, start_date, period_type)
);

CREATE INDEX idx_quota_periods_workspace_date
  ON quota_periods(workspace_id, start_date DESC);

CREATE INDEX idx_quota_periods_active
  ON quota_periods(workspace_id, start_date, end_date)
  WHERE start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE;

COMMENT ON TABLE quota_periods IS
  'Time-based quota periods for tracking team and individual quotas';

COMMENT ON COLUMN quota_periods.name IS
  'Human-readable name (e.g., "Q1 2026", "Jan 2026")';

COMMENT ON COLUMN quota_periods.period_type IS
  'Type of period: monthly, quarterly, or annual';

COMMENT ON COLUMN quota_periods.team_quota IS
  'Total team quota for this period in dollars';
