-- ============================================================================
-- Skill Runs Evidence Columns Migration
-- ============================================================================
-- Created: 2026-02-14
-- Purpose: Add evidence contract support to existing skill_runs table
--
-- Adds:
-- - run_id (unique identifier for skill runs)
-- - output (JSONB with evidence)
-- - slack delivery columns
-- - Evidence-specific indexes
-- ============================================================================

-- Add run_id column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'skill_runs' AND column_name = 'run_id') THEN
    ALTER TABLE skill_runs ADD COLUMN run_id UUID UNIQUE;
    -- Backfill with existing IDs
    UPDATE skill_runs SET run_id = id WHERE run_id IS NULL;
    -- Make NOT NULL after backfill
    ALTER TABLE skill_runs ALTER COLUMN run_id SET NOT NULL;
  END IF;
END $$;

-- Add output column (evidence container)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'skill_runs' AND column_name = 'output') THEN
    ALTER TABLE skill_runs ADD COLUMN output JSONB;
  END IF;
END $$;

-- Add Slack delivery columns
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'skill_runs' AND column_name = 'slack_message_ts') THEN
    ALTER TABLE skill_runs ADD COLUMN slack_message_ts TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'skill_runs' AND column_name = 'slack_channel_id') THEN
    ALTER TABLE skill_runs ADD COLUMN slack_channel_id TEXT;
  END IF;
END $$;

-- ============================================================================
-- Evidence-Specific Indexes
-- ============================================================================

-- Latest run per skill per workspace (for evidence freshness)
CREATE INDEX IF NOT EXISTS idx_skill_runs_latest
  ON skill_runs (workspace_id, skill_id, completed_at DESC NULLS LAST);

-- Evidence freshness checks (for agent caching)
CREATE INDEX IF NOT EXISTS idx_skill_runs_freshness
  ON skill_runs (workspace_id, skill_id, status, completed_at DESC)
  WHERE status = 'completed';

-- Slack message tracking (for message updates/threading)
CREATE INDEX IF NOT EXISTS idx_skill_runs_slack
  ON skill_runs (slack_channel_id, slack_message_ts)
  WHERE slack_message_ts IS NOT NULL;

-- Evidence search (GIN index for JSONB queries)
CREATE INDEX IF NOT EXISTS idx_skill_runs_evidence
  ON skill_runs USING GIN ((output->'evidence'))
  WHERE output IS NOT NULL;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON COLUMN skill_runs.run_id IS 'Unique run identifier (may differ from id for historical reasons)';
COMMENT ON COLUMN skill_runs.output IS 'Contains { narrative: string, evidence: { claims, evaluated_records, data_sources, parameters } }';
COMMENT ON COLUMN skill_runs.slack_message_ts IS 'Slack timestamp for message updates (null if not posted to Slack)';
COMMENT ON COLUMN skill_runs.slack_channel_id IS 'Slack channel ID where message was posted';
