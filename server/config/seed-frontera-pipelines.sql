-- Seed Frontera pipeline definitions into context_layer
-- Writes to TWO locations:
--   1. definitions->'pipelines'            (top-level, used by verify queries)
--   2. definitions->'workspace_config'->'pipelines'  (used by WorkspaceConfigLoader)
--
-- Run after migration 193.
-- Fellowship and Customer Expansion are non-forecast pipelines.
-- Partnership Pipeline is revenue-bearing and forecast-eligible.

UPDATE context_layer
SET
  definitions = jsonb_set(
    jsonb_set(
      definitions,
      -- Path 1: top-level definitions.pipelines (verify queries)
      '{pipelines}',
      '[
        {
          "id":                "core-sales-pipeline",
          "name":              "Core Sales Pipeline",
          "pipeline_value":    "Core Sales Pipeline",
          "value_field":       "amount",
          "forecast_eligible": true
        },
        {
          "id":                "fellowship-pipeline",
          "name":              "Fellowship Pipeline",
          "pipeline_value":    "Fellowship Pipeline",
          "value_field":       "amount",
          "forecast_eligible": false
        },
        {
          "id":                "partnership-pipeline",
          "name":              "Partnership Pipeline",
          "pipeline_value":    "Partnership Pipeline",
          "value_field":       "amount",
          "forecast_eligible": true
        },
        {
          "id":                "customer-expansion",
          "name":              "Customer Expansion",
          "pipeline_value":    "Customer Expansion",
          "value_field":       "amount",
          "forecast_eligible": false
        }
      ]'::jsonb,
      true
    ),
    -- Path 2: workspace_config.pipelines (WorkspaceConfigLoader)
    '{workspace_config,pipelines}',
    '[
      {
        "id":                     "core-sales-pipeline",
        "name":                   "Core Sales Pipeline",
        "type":                   "new_business",
        "filter":                 { "field": "pipeline", "values": ["Core Sales Pipeline"] },
        "coverage_target":        3.0,
        "stage_probabilities":    {},
        "loss_values":            ["closed_lost"],
        "included_in_default_scope": true,
        "value_field":            "amount",
        "forecast_eligible":      true
      },
      {
        "id":                     "fellowship-pipeline",
        "name":                   "Fellowship Pipeline",
        "type":                   "new_business",
        "filter":                 { "field": "pipeline", "values": ["Fellowship Pipeline"] },
        "coverage_target":        3.0,
        "stage_probabilities":    {},
        "loss_values":            ["closed_lost"],
        "included_in_default_scope": false,
        "value_field":            "amount",
        "forecast_eligible":      false
      },
      {
        "id":                     "partnership-pipeline",
        "name":                   "Partnership Pipeline",
        "type":                   "new_business",
        "filter":                 { "field": "pipeline", "values": ["Partnership Pipeline"] },
        "coverage_target":        3.0,
        "stage_probabilities":    {},
        "loss_values":            ["closed_lost"],
        "included_in_default_scope": true,
        "value_field":            "amount",
        "forecast_eligible":      true
      },
      {
        "id":                     "customer-expansion",
        "name":                   "Customer Expansion",
        "type":                   "expansion",
        "filter":                 { "field": "pipeline", "values": ["Customer Expansion"] },
        "coverage_target":        2.0,
        "stage_probabilities":    {},
        "loss_values":            ["closed_lost"],
        "included_in_default_scope": false,
        "value_field":            "amount",
        "forecast_eligible":      false
      }
    ]'::jsonb,
    true
  ),
  updated_at = NOW()
WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378';
