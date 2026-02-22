CREATE TABLE IF NOT EXISTS notification_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  slack_blocks JSONB,
  queued_at TIMESTAMPTZ DEFAULT now(),
  deliver_after TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  digest_id TEXT,
  CONSTRAINT valid_notif_severity CHECK (severity IN ('critical', 'warning', 'info'))
);

CREATE INDEX IF NOT EXISTS idx_notif_queue_pending
  ON notification_queue(workspace_id, queued_at)
  WHERE delivered_at IS NULL;
