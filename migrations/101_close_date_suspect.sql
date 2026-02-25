-- Add close_date_suspect flag to deals table
-- Indicates when recent conversations mention timelines that suggest close date may be stale

ALTER TABLE deals ADD COLUMN IF NOT EXISTS close_date_suspect BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN deals.close_date_suspect IS 'True when recent conversation mentions timeline language (onboarding in, next month, etc) suggesting close date may need updating';

CREATE INDEX IF NOT EXISTS idx_deals_close_date_suspect ON deals(workspace_id, close_date_suspect) WHERE close_date_suspect = true;
