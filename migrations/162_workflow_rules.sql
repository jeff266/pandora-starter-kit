-- Workflow Rules System
-- Enables users to define automated actions based on findings and skill outputs

CREATE TABLE workflow_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,

  -- Trigger
  trigger_type TEXT NOT NULL CHECK (trigger_type IN (
    'skill_run', 'finding_created', 'agent_run', 'crm_sync', 'manual'
  )),
  trigger_skill_id TEXT,          -- e.g. 'pipeline-hygiene-check'
  trigger_finding_category TEXT,  -- e.g. 'stale_deal', 'single_threaded'
  trigger_severity TEXT,          -- e.g. 'act', 'watch'

  -- Condition (structured JSON)
  condition_json JSONB NOT NULL DEFAULT '{}',
  -- Example: { "field": "stage_age_ratio", "op": "gt", "value": 2 }
  -- Supports: gt, lt, eq, gte, lte, contains, not_null, is_null, in, not_in
  -- Complex: { "and": [...] } / { "or": [...] }

  -- Action
  action_type TEXT NOT NULL CHECK (action_type IN (
    'crm_field_write',
    'crm_task_create',
    'slack_notify',
    'finding_escalate',
    'contact_associate',
    'stage_change'
  )),
  action_payload JSONB NOT NULL DEFAULT '{}',
  -- crm_field_write: { "object": "deal", "field": "next_action_date", "value_expr": "today+3d" }
  -- crm_task_create: { "title_template": "Re-engage {{deal.name}}", "due_expr": "today+3d", "assign_to": "owner" }
  -- slack_notify: { "channel_type": "owner_dm" | "workspace_default", "message_template": "..." }
  -- stage_change: { "target_stage": "...", "require_confirmation": true }

  -- Execution mode
  execution_mode TEXT NOT NULL DEFAULT 'queue' CHECK (execution_mode IN (
    'auto',     -- fires immediately, no approval needed
    'queue',    -- appears in Command Center Pending Actions for approval
    'manual'    -- only runs when user explicitly triggers
  )),

  -- Scope
  scope TEXT NOT NULL DEFAULT 'all' CHECK (scope IN (
    'all',      -- all matching deals
    'single',   -- specific deal (deal_id required)
    'segment'   -- filtered by segment/pipeline
  )),
  scope_filter JSONB DEFAULT '{}',

  -- Metadata
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id),
  last_triggered_at TIMESTAMPTZ,
  trigger_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_rules_workspace ON workflow_rules(workspace_id);
CREATE INDEX idx_workflow_rules_trigger ON workflow_rules(workspace_id, trigger_type, is_active);

-- Extend actions table for HITL queue
ALTER TABLE actions
  ADD COLUMN IF NOT EXISTS workflow_rule_id UUID REFERENCES workflow_rules(id),
  ADD COLUMN IF NOT EXISTS approval_status TEXT CHECK (approval_status IN (
    'pending', 'approved', 'rejected', 'auto_executed'
  ));

CREATE INDEX IF NOT EXISTS idx_actions_approval_status ON actions(workspace_id, approval_status) WHERE approval_status = 'pending';

-- Extend crm_write_log for retry queue
ALTER TABLE crm_write_log
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS workflow_rule_id UUID REFERENCES workflow_rules(id);

CREATE INDEX IF NOT EXISTS idx_crm_write_log_retry ON crm_write_log(next_retry_at) WHERE status = 'failed' AND retry_count < 3;

-- Audit log for workflow executions
CREATE TABLE workflow_execution_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_rule_id UUID NOT NULL REFERENCES workflow_rules(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Trigger context
  trigger_type TEXT NOT NULL,
  trigger_source_id TEXT,  -- skill_run_id, finding_id, etc.

  -- Execution details
  matched_records INTEGER NOT NULL DEFAULT 0,
  executed_actions INTEGER NOT NULL DEFAULT 0,
  failed_actions INTEGER NOT NULL DEFAULT 0,

  -- Result
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  error_message TEXT,
  execution_duration_ms INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_execution_log_rule ON workflow_execution_log(workflow_rule_id, created_at DESC);
CREATE INDEX idx_workflow_execution_log_workspace ON workflow_execution_log(workspace_id, created_at DESC);

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_workflow_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workflow_rules_updated_at
  BEFORE UPDATE ON workflow_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_workflow_rules_updated_at();
