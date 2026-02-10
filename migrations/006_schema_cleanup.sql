-- Migration 006: Schema cleanup before Phase 3
-- Adds missing columns identified during Session 10 query layer build

-- 1. deals: add stage_normalized (universal stage mapping across CRM sources)
ALTER TABLE deals ADD COLUMN IF NOT EXISTS stage_normalized TEXT;

-- 2. deals: add health_score (composite 0-100, derived from deal_risk initially)
ALTER TABLE deals ADD COLUMN IF NOT EXISTS health_score NUMERIC;

-- 3. conversations: add title (call title from Gong/Fireflies)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS title TEXT;

-- 4. Index: deals by workspace + stage_normalized for filtered queries
CREATE INDEX IF NOT EXISTS idx_deals_stage_normalized
  ON deals(workspace_id, stage_normalized);

-- 5. Index: conversations by workspace + title for search
--    Using btree since pg_trgm may not be available on all Neon instances
CREATE INDEX IF NOT EXISTS idx_conversations_title
  ON conversations(workspace_id, title);
