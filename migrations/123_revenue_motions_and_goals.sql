-- ============================================================
-- Migration 123: Revenue Motions, Goals, Goal Snapshots
-- + Finding Persistence columns
-- ============================================================

-- ============================================================
-- REVENUE MOTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS revenue_motions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  type TEXT NOT NULL CHECK (type IN ('new_business', 'expansion', 'renewal')),
  sub_type TEXT,
  label TEXT NOT NULL,

  pipeline_names TEXT[] NOT NULL DEFAULT '{}',
  deal_filters JSONB DEFAULT '{}',
  team_labels TEXT[] DEFAULT '{}',
  funnel_model JSONB DEFAULT '{}',
  thresholds_override JSONB DEFAULT '{}',

  is_active BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'inferred', 'crm_import')),
  confidence FLOAT NOT NULL DEFAULT 1.0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(workspace_id, type, sub_type)
);

CREATE INDEX IF NOT EXISTS idx_revenue_motions_workspace
  ON revenue_motions(workspace_id) WHERE is_active = true;

COMMENT ON TABLE revenue_motions IS 'Revenue motions (new business, expansion, renewal) with CRM pipeline mappings and funnel models';
COMMENT ON COLUMN revenue_motions.pipeline_names IS 'Pipeline names (matches deals.pipeline) that feed this motion';
COMMENT ON COLUMN revenue_motions.deal_filters IS 'Additional deal filters e.g. { "custom_field": "dealtype", "values": ["new"] }';
COMMENT ON COLUMN revenue_motions.thresholds_override IS 'Motion-specific threshold overrides (stale_deal_days, coverage_target, etc.)';
COMMENT ON COLUMN revenue_motions.funnel_model IS 'Computed/manual funnel model: win_rate, avg_deal_size, avg_cycle_days, stage_conversion_rates';

-- ============================================================
-- STRUCTURED GOALS (hierarchical, motion-aware)
-- ============================================================

CREATE TABLE IF NOT EXISTS goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  metric_type TEXT NOT NULL CHECK (metric_type IN (
    'bookings', 'pipeline', 'opportunities', 'sqls', 'mqls',
    'leads', 'visits', 'win_rate', 'cycle_time', 'retention',
    'expansion_revenue', 'churn', 'nrr', 'custom'
  )),
  label TEXT NOT NULL,

  level TEXT NOT NULL CHECK (level IN ('board', 'company', 'team', 'individual')),
  parent_goal_id UUID REFERENCES goals(id) ON DELETE SET NULL,

  owner_type TEXT NOT NULL CHECK (owner_type IN ('workspace', 'team', 'rep')),
  owner_id TEXT NOT NULL,

  motion_id UUID REFERENCES revenue_motions(id) ON DELETE SET NULL,

  upstream_goal_id UUID REFERENCES goals(id) ON DELETE SET NULL,
  conversion_assumption FLOAT,

  target_value NUMERIC(15,2) NOT NULL,
  target_unit TEXT NOT NULL DEFAULT 'currency',
  period TEXT NOT NULL CHECK (period IN ('monthly', 'quarterly', 'annual')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'inferred', 'quota_import', 'crm_import')),
  confidence FLOAT NOT NULL DEFAULT 1.0,
  inferred_from TEXT,

  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_goals_workspace_active
  ON goals(workspace_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_goals_motion
  ON goals(motion_id) WHERE motion_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_goals_parent
  ON goals(parent_goal_id) WHERE parent_goal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_goals_upstream
  ON goals(upstream_goal_id) WHERE upstream_goal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_goals_period
  ON goals(workspace_id, period_start, period_end);

COMMENT ON TABLE goals IS 'Structured revenue goals with hierarchy (board→company→team→individual) and motion linkage';
COMMENT ON COLUMN goals.upstream_goal_id IS 'Funnel upstream: a pipeline goal is upstream of a bookings goal';
COMMENT ON COLUMN goals.conversion_assumption IS 'The conversion rate linking this goal to its upstream (e.g. 0.28 win rate)';
COMMENT ON COLUMN goals.inferred_from IS 'Human-readable explanation of how this goal was derived';

-- ============================================================
-- GOAL SNAPSHOTS (daily time-series for trending)
-- ============================================================

CREATE TABLE IF NOT EXISTS goal_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,

  current_value NUMERIC(15,2) NOT NULL,
  attainment_pct NUMERIC(5,2),
  gap NUMERIC(15,2),

  required_run_rate NUMERIC(15,2),
  actual_run_rate NUMERIC(15,2),
  trajectory TEXT CHECK (trajectory IN ('ahead', 'on_track', 'at_risk', 'behind', 'critical')),
  projected_landing NUMERIC(15,2),
  days_remaining INT,

  top_risk TEXT,
  top_opportunity TEXT,
  notable_changes TEXT[],

  computation_detail JSONB NOT NULL DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(goal_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_goal_snapshots_date
  ON goal_snapshots(goal_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_goal_snapshots_workspace
  ON goal_snapshots(workspace_id, snapshot_date DESC);

COMMENT ON TABLE goal_snapshots IS 'Daily point-in-time snapshots of goal progress with trajectory and run-rate data';

-- ============================================================
-- EXTEND EXISTING TABLES
-- ============================================================

-- sales_reps: add manager relationship
ALTER TABLE sales_reps
  ADD COLUMN IF NOT EXISTS manager_rep_id UUID REFERENCES sales_reps(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_manager BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_sales_reps_manager
  ON sales_reps(manager_rep_id) WHERE manager_rep_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_reps_team
  ON sales_reps(workspace_id, team) WHERE team IS NOT NULL;

-- quota_periods: link to motion
ALTER TABLE quota_periods
  ADD COLUMN IF NOT EXISTS motion_id UUID REFERENCES revenue_motions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pipeline_name TEXT;

COMMENT ON COLUMN quota_periods.motion_id IS 'Links quota period to a revenue motion for per-motion quota tracking';
COMMENT ON COLUMN quota_periods.pipeline_name IS 'Pipeline name this quota period applies to (matches deals.pipeline)';

-- rep_quotas: link to motion
ALTER TABLE rep_quotas
  ADD COLUMN IF NOT EXISTS motion_id UUID REFERENCES revenue_motions(id) ON DELETE SET NULL;

COMMENT ON COLUMN rep_quotas.motion_id IS 'Links individual quota to a specific revenue motion';

-- ============================================================
-- FINDING PERSISTENCE COLUMNS
-- ============================================================

ALTER TABLE findings
  ADD COLUMN IF NOT EXISTS fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS first_flagged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS times_flagged INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS escalation_level INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS previous_finding_id UUID REFERENCES findings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS value_when_first_flagged JSONB,
  ADD COLUMN IF NOT EXISTS value_current JSONB,
  ADD COLUMN IF NOT EXISTS trend TEXT CHECK (trend IN ('improving', 'stable', 'worsening', 'new'));

CREATE INDEX IF NOT EXISTS idx_findings_fingerprint
  ON findings(workspace_id, fingerprint) WHERE fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_findings_escalation
  ON findings(workspace_id, escalation_level) WHERE escalation_level > 0;

CREATE INDEX IF NOT EXISTS idx_findings_persistence
  ON findings(workspace_id, skill_id, fingerprint, resolved_at)
  WHERE fingerprint IS NOT NULL AND resolved_at IS NULL;

COMMENT ON COLUMN findings.fingerprint IS 'Stable hash of workspace_id+category+entity for matching same issue across runs';
COMMENT ON COLUMN findings.times_flagged IS 'How many consecutive skill runs have produced this same finding';
COMMENT ON COLUMN findings.escalation_level IS '0=new, 1=recurring, 2=persistent, 3=critical-escalation';
COMMENT ON COLUMN findings.trend IS 'Whether the underlying metric is improving, stable, worsening, or new';
