-- Add composite_score column to deals table
-- Stores the production weighted composite score (CRM + findings + conversations)

ALTER TABLE deals ADD COLUMN IF NOT EXISTS composite_score NUMERIC;

COMMENT ON COLUMN deals.composite_score IS 'Weighted composite score combining health_score (CRM), skill score (findings), and conversation score. Uses production weights with graceful degradation.';

CREATE INDEX IF NOT EXISTS idx_deals_composite_score ON deals(workspace_id, composite_score DESC) WHERE composite_score IS NOT NULL;
