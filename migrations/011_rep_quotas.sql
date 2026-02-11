-- Rep Quotas Table
-- Stores per-rep quotas within a quota period

CREATE TABLE IF NOT EXISTS rep_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES quota_periods(id) ON DELETE CASCADE,
  rep_name TEXT NOT NULL,
  quota_amount NUMERIC(15,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(period_id, rep_name)
);

CREATE INDEX idx_rep_quotas_period
  ON rep_quotas(period_id);

CREATE INDEX idx_rep_quotas_rep_name
  ON rep_quotas(period_id, rep_name);

COMMENT ON TABLE rep_quotas IS
  'Individual rep quotas within a quota period';

COMMENT ON COLUMN rep_quotas.rep_name IS
  'Sales rep name (matches deals.owner field)';

COMMENT ON COLUMN rep_quotas.quota_amount IS
  'Individual quota for this rep in dollars';

-- Helper function to get active quota for a rep
CREATE OR REPLACE FUNCTION get_rep_quota(
  p_workspace_id UUID,
  p_rep_name TEXT,
  p_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  period_name TEXT,
  quota_amount NUMERIC,
  team_quota NUMERIC,
  period_start DATE,
  period_end DATE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    qp.name,
    COALESCE(rq.quota_amount, qp.team_quota) as quota_amount,
    qp.team_quota,
    qp.start_date,
    qp.end_date
  FROM quota_periods qp
  LEFT JOIN rep_quotas rq ON rq.period_id = qp.id AND rq.rep_name = p_rep_name
  WHERE qp.workspace_id = p_workspace_id
    AND qp.start_date <= p_date
    AND qp.end_date >= p_date
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_rep_quota IS
  'Get active quota for a rep on a given date. Falls back to team quota if no rep quota set.';
