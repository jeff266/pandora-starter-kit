-- Migration 165: Add next-step action columns to actions table
-- Supports persist-on-render pattern for Recommended Next Steps

ALTER TABLE actions ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE actions ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE actions ADD COLUMN IF NOT EXISTS suggested_crm_action TEXT;
ALTER TABLE actions ADD COLUMN IF NOT EXISTS dedup_hash TEXT;

-- Unique index for upsert deduplication
-- Only one non-dismissed record per workspace+hash
CREATE UNIQUE INDEX IF NOT EXISTS idx_actions_dedup
  ON actions (workspace_id, dedup_hash)
  WHERE execution_status != 'dismissed' AND dedup_hash IS NOT NULL;
