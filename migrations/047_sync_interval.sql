-- 047_sync_interval.sql
-- Adds per-connector sync interval and schema snapshot to connections table.
-- sync_interval_minutes: how often incremental sync fires (60/240/720/1440)
-- schema_snapshot: last known CRM field list per object, used for new field detection

ALTER TABLE connections
  ADD COLUMN IF NOT EXISTS sync_interval_minutes INTEGER NOT NULL DEFAULT 60;

COMMENT ON COLUMN connections.sync_interval_minutes IS
  'How frequently incremental sync runs for this connector (minutes). Valid values: 60, 240, 720, 1440.';

ALTER TABLE connections
  ADD COLUMN IF NOT EXISTS schema_snapshot JSONB DEFAULT NULL;

COMMENT ON COLUMN connections.schema_snapshot IS
  'Last known CRM field schema per object. Used for new field detection on subsequent syncs.
   Shape: { deals: string[], contacts: string[], accounts: string[], captured_at: ISO }';
