-- Migration: Targets and Quotas
-- Creates company-level revenue targets and rep quotas for gap analysis

CREATE TABLE IF NOT EXISTS targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- What metric this target is denominated in
  metric TEXT NOT NULL,
  -- 'revenue' | 'arr' | 'mrr' | 'tcv' | 'acv' | 'gmv' | 'bookings'

  -- Period this target covers
  period_type TEXT NOT NULL,        -- 'annual' | 'quarterly' | 'monthly'
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  period_label TEXT NOT NULL,       -- 'FY2026' | 'Q1 2026' | 'Jan 2026'

  -- The number
  amount NUMERIC NOT NULL,

  -- Who set it and when
  set_by TEXT,                      -- user email
  set_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,                       -- optional context ("board revised Mar 15")

  -- Is this the active target for this period?
  is_active BOOLEAN DEFAULT TRUE,

  -- Revision tracking
  supersedes_id UUID REFERENCES targets(id),  -- points to the target this replaced

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_targets_workspace_period
  ON targets(workspace_id, period_start, period_end, is_active);

COMMENT ON TABLE targets IS 'Company-level revenue targets for gap analysis and hit probability';
COMMENT ON COLUMN targets.metric IS 'Revenue metric: revenue, arr, mrr, tcv, acv, gmv, bookings';
COMMENT ON COLUMN targets.period_type IS 'Period type: annual, quarterly, monthly';
COMMENT ON COLUMN targets.supersedes_id IS 'References the target this revision replaced';

-- ============================================================================

CREATE TABLE IF NOT EXISTS quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Who this quota is for
  rep_email TEXT NOT NULL,
  rep_name TEXT,

  -- Period
  period_type TEXT NOT NULL,        -- 'annual' | 'quarterly' | 'monthly'
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  period_label TEXT NOT NULL,

  -- The number
  amount NUMERIC NOT NULL,
  metric TEXT NOT NULL,             -- same metric as company target

  -- Metadata
  set_by TEXT,
  set_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  supersedes_id UUID REFERENCES quotas(id),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_quotas_workspace_rep_period
  ON quotas(workspace_id, rep_email, period_start, is_active);

COMMENT ON TABLE quotas IS 'Rep-level quotas mapped to company targets';
COMMENT ON COLUMN quotas.rep_email IS 'Rep email address (matches deal owner email in CRM)';
COMMENT ON COLUMN quotas.metric IS 'Must match company target metric for the same period';
