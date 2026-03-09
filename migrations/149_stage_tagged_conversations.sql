-- Stage Tagged Conversations
-- Pre-labels conversations as progressor/staller so Stage Progression
-- quarterly runs read clean pools without recomputing from scratch each time.

CREATE TABLE IF NOT EXISTS stage_tagged_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,

  -- Stage context at time of call
  stage_name TEXT NOT NULL,
  stage_normalized TEXT NOT NULL,
  entered_stage_at TIMESTAMPTZ NOT NULL,
  exited_stage_at TIMESTAMPTZ,
  days_in_stage_at_call INT,

  -- Classification
  transition_type TEXT CHECK (
    transition_type IN ('progressor', 'staller', 'pending')
  ),
  stall_threshold_days INT NOT NULL,

  -- Resolution tracking
  resolved_at TIMESTAMPTZ,
  resolution_reason TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- One tag per conversation per stage
  UNIQUE(conversation_id, stage_name)
);

-- Primary read pattern for quarterly Stage Progression run
CREATE INDEX IF NOT EXISTS idx_stc_quarterly_read
  ON stage_tagged_conversations(workspace_id, stage_name, transition_type)
  WHERE transition_type IN ('progressor', 'staller');

-- Resolution loop — find pending rows to re-evaluate
CREATE INDEX IF NOT EXISTS idx_stc_pending
  ON stage_tagged_conversations(workspace_id, transition_type)
  WHERE transition_type = 'pending';

-- Per-workspace, per-deal lookup for dedup
CREATE INDEX IF NOT EXISTS idx_stc_deal
  ON stage_tagged_conversations(deal_id, stage_name);
