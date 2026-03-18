-- Migration 193: Add value_field, value_formula, and forecast_eligible to pipeline configs
-- Enables workspace-specific economic value definitions and forecast eligibility tracking.

-- Workspace config is stored as JSONB in context_layer.definitions->workspace_config
-- Add defaults for new fields on existing pipeline configs

UPDATE context_layer
SET definitions = jsonb_set(
  jsonb_set(
    jsonb_set(
      definitions,
      '{workspace_config,pipelines}',
      (
        SELECT jsonb_agg(
          pipeline ||
          jsonb_build_object(
            'value_field',
            COALESCE(pipeline->>'value_field', 'amount'),
            'value_formula',
            COALESCE(pipeline->>'value_formula', null),
            'forecast_eligible',
            COALESCE(
              (pipeline->>'forecast_eligible')::boolean,
              true
            )
          )
        )
        FROM jsonb_array_elements(
          definitions->'workspace_config'->'pipelines'
        ) AS pipeline
      ),
      true
    ),
    '{workspace_config}',
    COALESCE(definitions->'workspace_config', '{}'::jsonb),
    true
  ),
  '{workspace_config}',
  COALESCE(definitions->'workspace_config', '{}'::jsonb),
  true
),
updated_at = NOW()
WHERE definitions ? 'workspace_config'
  AND definitions->'workspace_config' ? 'pipelines'
  AND jsonb_array_length(definitions->'workspace_config'->'pipelines') > 0;

-- Verify the migration
-- SELECT
--   workspace_id,
--   jsonb_array_length(definitions->'workspace_config'->'pipelines') as pipeline_count,
--   definitions->'workspace_config'->'pipelines'->0->>'value_field' as first_value_field,
--   definitions->'workspace_config'->'pipelines'->0->>'forecast_eligible' as first_forecast_eligible
-- FROM context_layer
-- WHERE definitions ? 'workspace_config'
--   AND definitions->'workspace_config' ? 'pipelines'
-- LIMIT 10;
