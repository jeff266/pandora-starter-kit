-- ================================================================
-- Governance records track every autonomous change through its
-- full lifecycle: proposed → validated → reviewed →
-- pending_approval → approved → deploying → deployed → monitoring →
-- (stable | rolled_back | superseded)
-- ================================================================

CREATE TABLE IF NOT EXISTS skill_governance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- What triggered this
  source_type TEXT NOT NULL,             -- 'self_heal', 'feedback_pattern', 'drift_detection', 'manual'
  source_id TEXT,                        -- agent_feedback.id or config_suggestion.id that spawned this
  source_feedback_ids TEXT[],            -- All feedback IDs that contributed to this proposal

  -- What is being proposed
  change_type TEXT NOT NULL,             -- 'resolver_pattern', 'workspace_context', 'named_filter', 'skill_definition', 'agent_config'
  change_description TEXT NOT NULL,
  change_payload JSONB NOT NULL,

  -- What it replaces (null if net-new)
  supersedes_id UUID REFERENCES skill_governance(id),
  supersedes_type TEXT,
  supersedes_snapshot JSONB,

  -- Validation results
  shape_validation JSONB DEFAULT '{}',
  shape_valid BOOLEAN,
  shape_errors TEXT[],

  -- Review results
  review_result JSONB DEFAULT '{}',
  review_score NUMERIC,
  review_recommendation TEXT,
  review_concerns TEXT[],

  -- Human-language explanation
  explanation JSONB DEFAULT '{}',
  explanation_summary TEXT,
  explanation_detail TEXT,
  explanation_impact TEXT,

  -- Comparison results (before/after)
  comparison JSONB DEFAULT '{}',
  comparison_test_cases JSONB,
  comparison_before_results JSONB,
  comparison_after_results JSONB,
  comparison_improvement_score NUMERIC,

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'proposed',
  status_history JSONB DEFAULT '[]',

  -- Deployment
  deployed_at TIMESTAMPTZ,
  deployed_by TEXT,
  trial_expires_at TIMESTAMPTZ,

  -- Monitoring (post-deployment)
  monitoring_start TIMESTAMPTZ,
  monitoring_feedback_before JSONB,
  monitoring_feedback_after JSONB,
  monitoring_verdict TEXT,

  -- Rollback
  rolled_back_at TIMESTAMPTZ,
  rolled_back_by TEXT,
  rollback_reason TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_governance_workspace_status
  ON skill_governance(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_governance_workspace_type
  ON skill_governance(workspace_id, change_type);
CREATE INDEX IF NOT EXISTS idx_governance_deployed
  ON skill_governance(workspace_id) WHERE status = 'deployed';
CREATE INDEX IF NOT EXISTS idx_governance_monitoring
  ON skill_governance(workspace_id) WHERE status = 'monitoring';
