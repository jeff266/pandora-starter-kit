-- Add pandora_response JSONB column to weekly_briefs for multi-modal response blocks
ALTER TABLE weekly_briefs
  ADD COLUMN IF NOT EXISTS pandora_response JSONB;

CREATE INDEX IF NOT EXISTS idx_weekly_briefs_pandora_response
  ON weekly_briefs USING gin(pandora_response);
