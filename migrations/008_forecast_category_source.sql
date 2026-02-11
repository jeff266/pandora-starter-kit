-- Add forecast_category_source to track data lineage
-- Values: 'native' (from CRM property) or 'derived' (from probability)

ALTER TABLE deals
ADD COLUMN IF NOT EXISTS forecast_category_source TEXT
CHECK (forecast_category_source IN ('native', 'derived', NULL));

-- Add index for data quality queries
CREATE INDEX IF NOT EXISTS idx_deals_forecast_source
  ON deals(workspace_id, source, forecast_category_source)
  WHERE forecast_category_source IS NOT NULL;

-- Backfill existing Salesforce deals (they use native ForecastCategoryName)
UPDATE deals
SET forecast_category_source = 'native'
WHERE source = 'salesforce'
  AND forecast_category IS NOT NULL
  AND forecast_category_source IS NULL;

COMMENT ON COLUMN deals.forecast_category_source IS
  'Tracks how forecast_category was determined: native (from CRM property) or derived (from probability)';
