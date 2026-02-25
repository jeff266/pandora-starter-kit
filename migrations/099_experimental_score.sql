-- Add experimental_score column to deals table
-- Stores score computed with experimental weights for A/B testing

ALTER TABLE deals ADD COLUMN IF NOT EXISTS experimental_score NUMERIC;

COMMENT ON COLUMN deals.experimental_score IS 'Score computed with experimental weights (for A/B testing, not shown in UI by default)';

CREATE INDEX IF NOT EXISTS idx_deals_experimental_score ON deals(workspace_id, experimental_score) WHERE experimental_score IS NOT NULL;
