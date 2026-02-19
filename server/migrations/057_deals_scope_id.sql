-- Migration 057: Add scope_id column to deals table
-- Supports Analysis Scopes — named segments that slice deals into
-- New Business, Renewals, Expansion, etc. Default = 'default' (all deals).

ALTER TABLE deals ADD COLUMN IF NOT EXISTS scope_id TEXT NOT NULL DEFAULT 'default';

-- Single-dimension index for scope-only lookups
CREATE INDEX IF NOT EXISTS idx_deals_scope
  ON deals(workspace_id, scope_id);

-- Compound index for skill queries that filter on workspace + scope + stage
-- Skills hit all three columns constantly — this index is load-bearing.
CREATE INDEX IF NOT EXISTS idx_deals_workspace_scope_stage
  ON deals(workspace_id, scope_id, stage_normalized);

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- After running this migration, verify with:
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'deals' AND column_name = 'scope_id';
-- Expected: text | NOT NULL | 'default'

-- SELECT scope_id, COUNT(*) FROM deals GROUP BY scope_id;
-- Expected: default | <total deal count>

-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'deals' AND indexname IN ('idx_deals_scope', 'idx_deals_workspace_scope_stage');
-- Expected: both index names returned
