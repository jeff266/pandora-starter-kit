ALTER TABLE weekly_briefs
  ADD COLUMN IF NOT EXISTS comparison_block TEXT,
  ADD COLUMN IF NOT EXISTS comparison_data JSONB,
  ADD COLUMN IF NOT EXISTS forecast_accuracy_note TEXT;
