-- Migration 180: crumb trail columns on intervention_log + standing_hypotheses
-- Adds follow-up scheduling, metadata storage, and new source types
-- needed by the crumb trail detector wired into Concierge and Ask Pandora.

-- 1. Add columns to intervention_log
ALTER TABLE intervention_log
  ADD COLUMN IF NOT EXISTS follow_up_date DATE,
  ADD COLUMN IF NOT EXISTS follow_up_sent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS follow_up_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- 2. Expand the source check constraint to include crumb-trail sources
--    (Postgres requires dropping and recreating named constraints)
ALTER TABLE intervention_log
  DROP CONSTRAINT IF EXISTS intervention_log_source_check;

ALTER TABLE intervention_log
  ADD CONSTRAINT intervention_log_source_check
  CHECK (source IN (
    'crm_structural',
    'user_confirmed',
    'document_ingestion',
    'concierge_recommendation',
    'slack_reply',
    'ask_pandora'
  ));

-- 3. Add metadata column to standing_hypotheses (for context_added notes)
ALTER TABLE standing_hypotheses
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- 4. Index for the follow-up job query
CREATE INDEX IF NOT EXISTS idx_intervention_log_followup
  ON intervention_log(workspace_id, follow_up_date, follow_up_sent)
  WHERE follow_up_sent = false;
