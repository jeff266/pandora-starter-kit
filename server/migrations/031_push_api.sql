-- Push API: delivery channels, rules, and log

-- Delivery channels: where to send findings
CREATE TABLE IF NOT EXISTS delivery_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('slack', 'email', 'webhook')),
  config JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Delivery rules: when and what to send
CREATE TABLE IF NOT EXISTS delivery_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES delivery_channels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('cron', 'skill_run', 'threshold')),
  trigger_config JSONB NOT NULL DEFAULT '{}',
  filter_config JSONB NOT NULL DEFAULT '{}',
  template TEXT NOT NULL DEFAULT 'standard' CHECK (template IN ('standard', 'digest', 'alert', 'raw_json')),
  last_triggered_at TIMESTAMPTZ,
  last_delivery_at TIMESTAMPTZ,
  last_delivery_status TEXT CHECK (last_delivery_status IN ('success', 'failed', 'empty', 'skipped')),
  consecutive_failures INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Delivery log: audit trail
CREATE TABLE IF NOT EXISTS delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES delivery_rules(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES delivery_channels(id) ON DELETE CASCADE,
  triggered_by TEXT NOT NULL,
  finding_count INT,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'empty', 'skipped')),
  error TEXT,
  payload_preview TEXT,
  duration_ms INT,
  delivered_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_delivery_channels_workspace ON delivery_channels(workspace_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_delivery_rules_workspace ON delivery_rules(workspace_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_delivery_rules_trigger ON delivery_rules(trigger_type, last_triggered_at);
CREATE INDEX IF NOT EXISTS idx_delivery_log_rule ON delivery_log(rule_id, delivered_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_log_workspace ON delivery_log(workspace_id, delivered_at DESC);
