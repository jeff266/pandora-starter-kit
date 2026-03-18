-- Seed Frontera pipeline definitions into context_layer.definitions->'pipelines'
-- Run after migration 193.
-- Fellowship and Customer Expansion are non-forecast pipelines.
-- Partnership Pipeline is revenue-bearing and forecast-eligible.

UPDATE context_layer
SET
  definitions = jsonb_set(
    definitions,
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
  updated_at = NOW()
WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378';
