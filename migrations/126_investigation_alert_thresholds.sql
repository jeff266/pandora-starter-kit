-- Investigation Alert Thresholds
-- Stores per-skill alerting rules with customizable thresholds and delivery channels

CREATE TABLE IF NOT EXISTS investigation_alert_thresholds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  threshold_type TEXT NOT NULL, -- 'at_risk_count' | 'critical_count'
  operator TEXT NOT NULL, -- 'gt' | 'gte' | 'lt' | 'lte' | 'eq'
  threshold_value NUMERIC NOT NULL,
  alert_channels JSONB NOT NULL DEFAULT '["email", "slack"]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  cooldown_hours INTEGER NOT NULL DEFAULT 24,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_threshold_workspace_skill ON investigation_alert_thresholds(workspace_id, skill_id);
CREATE INDEX idx_threshold_enabled ON investigation_alert_thresholds(enabled) WHERE enabled = true;

COMMENT ON TABLE investigation_alert_thresholds IS 'Custom alerting thresholds for investigation skills';
COMMENT ON COLUMN investigation_alert_thresholds.threshold_type IS 'Metric to monitor: at_risk_count counts warning+critical records, critical_count counts only critical';
COMMENT ON COLUMN investigation_alert_thresholds.operator IS 'Comparison operator: gt (>), gte (>=), lt (<), lte (<=), eq (=)';
COMMENT ON COLUMN investigation_alert_thresholds.cooldown_hours IS 'Minimum hours between alerts to prevent spam (default 24)';
COMMENT ON COLUMN investigation_alert_thresholds.alert_channels IS 'Array of delivery channels: ["email", "slack", "webhook"]';
