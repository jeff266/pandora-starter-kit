-- Migration 166: Workspace Action Settings & CRM Write Log Extensions
-- Agentic Action Threshold system + audit/reversal capability

CREATE TABLE workspace_action_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Global threshold
  action_threshold TEXT NOT NULL DEFAULT 'medium' CHECK (
    action_threshold IN ('high', 'medium', 'low')
  ),

  -- Stage protection: CRM stage values that Pandora will NEVER write to
  -- Also includes stages that Pandora will never write FROM (e.g. never auto-advance out of Closed Won)
  protected_stages JSONB NOT NULL DEFAULT '[]',
  -- Example: ["Closed Won", "Closed Lost", "Churned", "Dead"]

  -- Field-level overrides: per-field threshold override
  -- Allows "medium" workspace but "high" for next_action_date, "low" for amount
  field_overrides JSONB NOT NULL DEFAULT '{}',
  -- Example: {
  --   "next_action_date": "high",
  --   "forecast_category": "low",
  --   "amount": "low",
  --   "deal_stage": "medium"
  -- }

  -- Protected fields: fields Pandora will never write regardless of threshold
  protected_fields JSONB NOT NULL DEFAULT '[]',
  -- Example: ["amount", "close_date"]

  -- Notification settings
  notify_on_auto_write BOOLEAN NOT NULL DEFAULT true,   -- Slack notify on High-threshold writes
  notify_channel TEXT,                                   -- Slack channel ID for notifications
  notify_rep BOOLEAN NOT NULL DEFAULT true,             -- Also DM the deal owner
  notify_manager BOOLEAN NOT NULL DEFAULT true,         -- Also DM the manager

  -- Undo window for High-threshold writes (hours)
  undo_window_hours INTEGER NOT NULL DEFAULT 24,

  -- Webhook for audit export
  audit_webhook_url TEXT,
  audit_webhook_secret TEXT,  -- HMAC-SHA256 signing key
  audit_webhook_enabled BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Extend crm_write_log for reversibility
ALTER TABLE crm_write_log
  ADD COLUMN IF NOT EXISTS previous_value JSONB,        -- value before write (for undo)
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,     -- null = not reversed
  ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reversal_write_log_id UUID,  -- points to the write that undid this one
  ADD COLUMN IF NOT EXISTS action_threshold_at_write TEXT, -- threshold level active when write occurred
  ADD COLUMN IF NOT EXISTS initiated_by TEXT CHECK (initiated_by IN (
    'agent_auto',    -- High threshold, no approval
    'agent_hitl',    -- Medium threshold, user approved
    'user_manual',   -- User clicked Write to CRM directly
    'workflow_rule'  -- Fired from a workflow rule
  ));

-- Seed default settings for all existing workspaces
INSERT INTO workspace_action_settings (workspace_id, action_threshold, protected_stages)
SELECT id, 'medium', '["Closed Won", "Closed Lost"]'::jsonb
FROM workspaces
ON CONFLICT (workspace_id) DO NOTHING;
