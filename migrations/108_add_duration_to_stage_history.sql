-- Add missing duration_in_previous_stage_ms column to deal_stage_history
-- This column was in the original schema but may not exist in some databases

ALTER TABLE deal_stage_history
ADD COLUMN IF NOT EXISTS duration_in_previous_stage_ms BIGINT;

COMMENT ON COLUMN deal_stage_history.duration_in_previous_stage_ms IS
  'Milliseconds spent in from_stage (NULL if unknown)';
