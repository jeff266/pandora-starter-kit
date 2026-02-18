-- Deal AI scoring columns
ALTER TABLE deals ADD COLUMN IF NOT EXISTS ai_score INT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS ai_score_updated_at TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS ai_score_breakdown JSONB;

-- Index for sorting/filtering by score
CREATE INDEX IF NOT EXISTS idx_deals_ai_score ON deals(workspace_id, ai_score) WHERE ai_score IS NOT NULL;
