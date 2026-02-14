-- Deal Stage History Table
-- Stores complete stage progression for deals, enabling accurate velocity analysis

CREATE TABLE IF NOT EXISTS deal_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  
  -- Stage information
  stage TEXT NOT NULL,                    -- Raw stage value from CRM
  stage_normalized TEXT,                  -- Normalized stage (awareness, qualification, etc.)
  
  -- Timeline
  entered_at TIMESTAMPTZ NOT NULL,        -- When deal entered this stage
  exited_at TIMESTAMPTZ,                  -- When deal exited (NULL if current stage)
  duration_days NUMERIC(10,2),            -- Computed on exit: (exited_at - entered_at) in days
  
  -- Source tracking
  source TEXT,                            -- 'hubspot', 'salesforce'
  source_user TEXT,                       -- User who made the change (if available)
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint: one entry per deal/stage/timestamp combination
  UNIQUE(deal_id, stage, entered_at)
);

-- Indexes for common queries
CREATE INDEX idx_stage_history_deal ON deal_stage_history(deal_id, entered_at);
CREATE INDEX idx_stage_history_workspace ON deal_stage_history(workspace_id, entered_at DESC);
CREATE INDEX idx_stage_history_stage_normalized ON deal_stage_history(stage_normalized, entered_at);

-- Index for finding current stage (exited_at IS NULL)
CREATE INDEX idx_stage_history_current ON deal_stage_history(deal_id) WHERE exited_at IS NULL;

COMMENT ON TABLE deal_stage_history IS 'Complete stage progression history for deals, enabling accurate velocity and waterfall analysis';
COMMENT ON COLUMN deal_stage_history.entered_at IS 'When the deal entered this stage';
COMMENT ON COLUMN deal_stage_history.exited_at IS 'When the deal exited this stage (NULL if currently in this stage)';
COMMENT ON COLUMN deal_stage_history.duration_days IS 'How long the deal stayed in this stage (computed on exit)';
