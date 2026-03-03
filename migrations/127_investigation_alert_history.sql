-- Investigation Alert History
-- Tracks all sent alerts with delivery status for debugging and cooldown enforcement

CREATE TABLE IF NOT EXISTS investigation_alert_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  threshold_id UUID REFERENCES investigation_alert_thresholds(id) ON DELETE SET NULL,
  skill_id TEXT NOT NULL,
  skill_run_id UUID REFERENCES skill_runs(run_id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL, -- 'threshold_breach' | 'trend_worsened' | 'weekly_digest'
  alert_severity TEXT NOT NULL, -- 'critical' | 'warning' | 'info'
  alert_channels JSONB NOT NULL,
  delivery_status JSONB NOT NULL DEFAULT '{}'::jsonb, -- {"email": "sent", "slack": "failed"}
  triggered_value NUMERIC,
  threshold_value NUMERIC,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alert_history_workspace ON investigation_alert_history(workspace_id, created_at DESC);
CREATE INDEX idx_alert_history_skill ON investigation_alert_history(skill_id, created_at DESC);
CREATE INDEX idx_alert_history_threshold ON investigation_alert_history(threshold_id, created_at DESC);
CREATE INDEX idx_alert_history_type ON investigation_alert_history(alert_type, created_at DESC);

COMMENT ON TABLE investigation_alert_history IS 'Historical log of all investigation alerts sent';
COMMENT ON COLUMN investigation_alert_history.alert_type IS 'Type of alert: threshold_breach (custom threshold exceeded), trend_worsened (trend changed to worsening), weekly_digest (scheduled summary)';
COMMENT ON COLUMN investigation_alert_history.delivery_status IS 'Per-channel delivery status for tracking failures and retries';
COMMENT ON COLUMN investigation_alert_history.triggered_value IS 'Actual value that triggered the alert (e.g., at_risk_count = 15)';
COMMENT ON COLUMN investigation_alert_history.threshold_value IS 'Threshold that was exceeded (e.g., configured threshold = 10)';
