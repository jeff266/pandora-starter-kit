-- ============================================================================
-- Findings Table Migration
-- ============================================================================
-- Created: 2026-02-14
-- Purpose: Store extracted claims from skill runs for Command Center findings feed
--
-- Findings are auto-resolved when skill reruns (resolved_at set to now())
-- and new findings are inserted for the latest run.
--
-- Indexes support:
-- - Command Center findings feed (workspace_id, resolved_at, created_at)
-- - Drill-down by severity (severity, workspace_id)
-- - Deal/account context lookups (deal_id, account_id)
-- - Skill-specific queries (skill_id, workspace_id)
-- ============================================================================

CREATE TABLE IF NOT EXISTS findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Workspace and skill context
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  skill_run_id UUID NOT NULL,
  skill_id TEXT NOT NULL,

  -- Finding classification
  severity TEXT NOT NULL CHECK (severity IN ('act', 'watch', 'notable', 'info')),
  category TEXT NOT NULL,
  message TEXT NOT NULL,

  -- Entity associations (nullable)
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  owner_email TEXT,

  -- Additional context
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Lifecycle
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Primary query: unresolved findings for workspace, ordered by creation
CREATE INDEX idx_findings_workspace_unresolved
  ON findings (workspace_id, resolved_at, created_at DESC)
  WHERE resolved_at IS NULL;

-- Severity filtering
CREATE INDEX idx_findings_severity
  ON findings (severity, workspace_id, created_at DESC)
  WHERE resolved_at IS NULL;

-- Deal context lookups
CREATE INDEX idx_findings_deal
  ON findings (deal_id, workspace_id)
  WHERE deal_id IS NOT NULL;

-- Account context lookups
CREATE INDEX idx_findings_account
  ON findings (account_id, workspace_id)
  WHERE account_id IS NOT NULL;

-- Skill-specific queries
CREATE INDEX idx_findings_skill
  ON findings (skill_id, workspace_id, created_at DESC);

-- Owner-specific queries (for rep-specific views)
CREATE INDEX idx_findings_owner
  ON findings (owner_email, workspace_id, resolved_at)
  WHERE owner_email IS NOT NULL;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE findings IS 'Extracted claims from skill runs for Command Center findings feed and audit trail';
COMMENT ON COLUMN findings.severity IS 'act = immediate action needed, watch = monitor, notable = informational, info = background';
COMMENT ON COLUMN findings.category IS 'Finding type: stale_deal, single_threaded, data_quality, coverage_gap, etc.';
COMMENT ON COLUMN findings.resolved_at IS 'When finding was auto-resolved (skill rerun) or manually dismissed';
COMMENT ON COLUMN findings.metadata IS 'Skill-specific context: days_inactive, amount, stage, risk_factors, etc.';
