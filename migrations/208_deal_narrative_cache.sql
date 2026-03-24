-- Add narrative caching columns to deals table
-- Required by server/routes/dossiers.ts which already implements
-- the caching logic but was blocked by missing columns.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS narrative TEXT;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS narrative_actions JSONB;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS narrative_generated_at TIMESTAMPTZ;

COMMENT ON COLUMN deals.narrative IS
  'AI-generated deal narrative synthesized from dossier data.
   Cached to avoid redundant LLM calls on page loads.
   Regenerated when stale (>1 hour old) or deal updated.';

COMMENT ON COLUMN deals.narrative_actions IS
  'Recommended actions extracted during narrative synthesis.
   Stored as JSONB array of action objects.';

COMMENT ON COLUMN deals.narrative_generated_at IS
  'Timestamp when deals.narrative was last generated
   by synthesizeDealNarrative(). Used to skip regeneration
   when narrative is fresh (<1 hour old).';

-- Index for quick staleness checks
CREATE INDEX IF NOT EXISTS idx_deals_narrative_generated_at
  ON deals(narrative_generated_at)
  WHERE narrative_generated_at IS NOT NULL;
