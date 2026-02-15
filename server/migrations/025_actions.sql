-- Actions Engine Phase 1: Structured executable recommendations from skill runs
-- Creates actions table and action_audit_log for complete state tracking

-- Actions table: structured executable recommendations from skill runs
CREATE TABLE IF NOT EXISTS actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),

  -- Source
  skill_run_id UUID,                    -- links to the skill run that produced this
  agent_run_id UUID,                    -- links to agent run (if produced by agent)
  source_skill TEXT NOT NULL,           -- 'pipeline-hygiene', 'single-thread-alert', etc.

  -- Action definition
  action_type TEXT NOT NULL,            -- 're_engage_deal', 'close_stale_deal', 'notify_rep', etc.
  severity TEXT NOT NULL DEFAULT 'warning', -- 'critical', 'warning', 'info'
  title TEXT NOT NULL,                  -- human-readable action title
  summary TEXT,                         -- longer description
  recommended_steps TEXT[],             -- ordered list of suggested actions

  -- Target entity
  target_entity_type TEXT,              -- 'deal', 'account', 'contact', 'rep'
  target_entity_id TEXT,                -- UUID of the target entity
  target_entity_name TEXT,              -- human-readable name
  target_deal_id UUID,                  -- direct deal reference (convenience)
  target_account_id UUID,               -- direct account reference
  owner_email TEXT,                     -- deal/account owner (for filtering + Slack DM)

  -- Impact
  impact_amount NUMERIC,                -- dollar value at risk
  urgency_label TEXT,                   -- '87 days stale', 'close date passed', etc.
  urgency_days_stale INTEGER,           -- for staleness-based actions

  -- Execution
  execution_status TEXT NOT NULL DEFAULT 'open',
    -- 'open': needs attention
    -- 'in_progress': someone is working on it
    -- 'executed': action was taken (manually or system)
    -- 'dismissed': user chose to skip
    -- 'expired': past expires_at without action
    -- 'auto_executed': policy-triggered (Phase 3)
    -- 'superseded': newer action replaced this one
  executed_at TIMESTAMPTZ,
  executed_by TEXT,                     -- user email, 'system', or 'policy:{name}'
  execution_result JSONB,               -- API response, error details, etc.

  -- Execution payload (for CRM writes — Phase 2)
  execution_payload JSONB,              -- { crm_updates: [{field, proposed_value}], note_text: "..." }

  -- Lifecycle
  expires_at TIMESTAMPTZ,               -- auto-dismiss after this date (default: 14 days)
  dismissed_reason TEXT,                -- 'user_dismissed', 'superseded', 'expired', 'resolved_externally'

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_actions_workspace_status ON actions(workspace_id, execution_status);
CREATE INDEX idx_actions_workspace_severity ON actions(workspace_id, severity);
CREATE INDEX idx_actions_target ON actions(target_entity_type, target_entity_id);
CREATE INDEX idx_actions_skill_run ON actions(skill_run_id);
CREATE INDEX idx_actions_owner ON actions(workspace_id, owner_email) WHERE execution_status = 'open';
CREATE INDEX idx_actions_expires ON actions(expires_at) WHERE execution_status = 'open';

-- Audit log: every state change is tracked
CREATE TABLE IF NOT EXISTS action_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  action_id UUID NOT NULL REFERENCES actions(id),

  event_type TEXT NOT NULL,             -- 'created', 'status_changed', 'executed', 'dismissed', 'expired', 'notified'
  actor TEXT,                           -- user email, 'system', 'scheduler'
  from_status TEXT,                     -- previous execution_status
  to_status TEXT,                       -- new execution_status
  details JSONB,                        -- context: what changed, API response, error

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_action ON action_audit_log(action_id, created_at);
CREATE INDEX idx_audit_workspace ON action_audit_log(workspace_id, created_at DESC);
