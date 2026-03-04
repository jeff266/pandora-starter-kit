-- Migration 131: Add qualification_framework to context_layer.definitions
--
-- Adds MEDDIC/BANT/SPICED framework configuration for activity signal extraction.
-- Default: MEDDIC with full field definitions

-- Add qualification_framework to all existing workspaces
UPDATE context_layer
SET definitions = COALESCE(definitions, '{}'::jsonb) || jsonb_build_object(
  'qualification_framework', jsonb_build_object(
    'value', jsonb_build_object(
      'framework', 'MEDDIC',
      'fields', jsonb_build_object(
        'MEDDIC', jsonb_build_array('metrics', 'economic_buyer', 'decision_criteria', 'decision_process', 'identify_pain', 'champion'),
        'BANT', jsonb_build_array('budget', 'authority', 'need', 'timeline'),
        'SPICED', jsonb_build_array('situation', 'pain', 'impact', 'critical_event', 'decision')
      )
    ),
    '_meta', jsonb_build_object(
      'source', 'default',
      'last_validated', NOW()::text
    )
  )
)
WHERE definitions->>'qualification_framework' IS NULL;

COMMENT ON COLUMN context_layer.definitions IS 'Workspace-specific definitions including qualification_framework (MEDDIC/BANT/SPICED), win_rate_config, forecast_method, cadence settings, etc.';
