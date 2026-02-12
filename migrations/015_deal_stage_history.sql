-- Deal Stage History Table
-- Tracks when deals change stages over time for Pipeline Waterfall and Rep Scorecard

CREATE TABLE IF NOT EXISTS deal_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  deal_source_id TEXT NOT NULL,        -- HubSpot/Salesforce deal ID for cross-reference
  from_stage TEXT,                     -- NULL for the first known stage (deal creation)
  from_stage_normalized TEXT,          -- normalized version of from_stage
  to_stage TEXT NOT NULL,              -- the stage it moved TO
  to_stage_normalized TEXT,            -- normalized version of to_stage
  changed_at TIMESTAMPTZ NOT NULL,     -- when the change happened
  duration_in_previous_stage_ms BIGINT, -- how long it was in from_stage (NULL if unknown)
  source TEXT NOT NULL DEFAULT 'sync_detection',
    -- 'sync_detection' = caught during incremental sync
    -- 'hubspot_history' = backfilled from HubSpot property history API
    -- 'salesforce_history' = backfilled from Salesforce field history
    -- 'manual' = manually corrected
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary query pattern: "all stage changes for a deal, in order"
CREATE INDEX idx_stage_history_deal
  ON deal_stage_history(deal_id, changed_at);

-- Waterfall query pattern: "all stage changes in a workspace during a time window"
CREATE INDEX idx_stage_history_workspace_time
  ON deal_stage_history(workspace_id, changed_at);

-- Dedup prevention: same deal can't have two identical transitions at the same timestamp
CREATE UNIQUE INDEX idx_stage_history_unique_transition
  ON deal_stage_history(deal_id, to_stage, changed_at);

-- Add cached columns to deals table for fast sync detection
ALTER TABLE deals ADD COLUMN IF NOT EXISTS previous_stage TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMPTZ;

COMMENT ON TABLE deal_stage_history IS
  'Tracks deal stage transitions over time for Pipeline Waterfall and conversion analysis';

COMMENT ON COLUMN deal_stage_history.from_stage IS
  'Raw stage name before transition (NULL for first known stage)';

COMMENT ON COLUMN deal_stage_history.from_stage_normalized IS
  'Normalized stage name before transition (qualification, evaluation, etc.)';

COMMENT ON COLUMN deal_stage_history.to_stage IS
  'Raw stage name after transition';

COMMENT ON COLUMN deal_stage_history.to_stage_normalized IS
  'Normalized stage name after transition (qualification, evaluation, etc.)';

COMMENT ON COLUMN deal_stage_history.duration_in_previous_stage_ms IS
  'Milliseconds spent in from_stage (NULL if unknown)';

COMMENT ON COLUMN deal_stage_history.source IS
  'How this transition was recorded: sync_detection, hubspot_history, salesforce_history, manual';

COMMENT ON COLUMN deals.previous_stage IS
  'Cached previous stage for sync detection (avoids querying stage_history)';

COMMENT ON COLUMN deals.stage_changed_at IS
  'Cached timestamp of last stage change for days_in_stage calculation';
