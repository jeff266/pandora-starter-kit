ALTER TABLE findings ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS entity_name TEXT;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS metric_value NUMERIC;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS metric_context TEXT;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS actionability TEXT DEFAULT 'immediate';
ALTER TABLE findings ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS assigned_to TEXT;

CREATE INDEX IF NOT EXISTS idx_findings_category 
  ON findings(workspace_id, category);
