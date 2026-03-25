-- Add calibration_source column to metric_definitions for confirm_metric_definition action type
ALTER TABLE metric_definitions
  ADD COLUMN IF NOT EXISTS calibration_source text;
