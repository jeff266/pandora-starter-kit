ALTER TABLE forecast_thresholds
ADD COLUMN IF NOT EXISTS forecasted_pipelines JSONB DEFAULT NULL;

COMMENT ON COLUMN forecast_thresholds.forecasted_pipelines IS 'JSON array of pipeline names that should receive forecast_category derivation. NULL means all pipelines are forecasted. Deals in non-listed pipelines get forecast_category = NULL.';
