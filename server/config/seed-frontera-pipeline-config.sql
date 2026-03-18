-- Seed Frontera Pipeline Config - Mark Fellowship as non-forecast-eligible
-- Run this after migration 193

-- First, check current state
-- SELECT
--   pipeline->>'name' as name,
--   pipeline->>'id' as id,
--   pipeline->>'value_field' as value_field,
--   pipeline->>'forecast_eligible' as forecast_eligible
-- FROM context_layer,
--   jsonb_array_elements(definitions->'workspace_config'->'pipelines') AS pipeline
-- WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378';

-- Update Fellowship pipeline to forecast_eligible = false
UPDATE context_layer
SET definitions = jsonb_set(
  definitions,
  '{workspace_config,pipelines}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN pipeline->>'name' ILIKE '%fellowship%'
          OR pipeline->>'id' ILIKE '%fellowship%'
        THEN pipeline || '{"forecast_eligible": false}'::jsonb
        ELSE pipeline || jsonb_build_object(
          'forecast_eligible',
          COALESCE((pipeline->>'forecast_eligible')::boolean, true)
        )
      END
    )
    FROM jsonb_array_elements(
      definitions->'workspace_config'->'pipelines'
    ) AS pipeline
  ),
  true
),
updated_at = NOW()
WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378'
  AND definitions ? 'workspace_config'
  AND definitions->'workspace_config' ? 'pipelines';

-- Verify the update
SELECT
  pipeline->>'name' as name,
  pipeline->>'id' as id,
  pipeline->>'value_field' as value_field,
  pipeline->>'forecast_eligible' as forecast_eligible
FROM context_layer,
  jsonb_array_elements(definitions->'workspace_config'->'pipelines') AS pipeline
WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378';

-- Expected result:
-- Core Sales | core_sales | amount | true
-- Fellowship | fellowship | amount | false
