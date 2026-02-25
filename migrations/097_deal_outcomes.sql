-- Deal outcomes table for tracking scores at deal close
-- Used to build experimental scoring models

CREATE TABLE IF NOT EXISTS deal_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL,
  deal_name TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('won', 'lost')),

  -- Scores at time of close
  crm_score NUMERIC,
  skill_score NUMERIC,
  conversation_score NUMERIC,
  composite_score NUMERIC NOT NULL,

  -- Deal attributes at close
  amount NUMERIC,
  days_open INTEGER,
  stage_duration_days INTEGER,

  -- Metadata
  closed_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(workspace_id, deal_id)
);

CREATE INDEX idx_deal_outcomes_workspace ON deal_outcomes(workspace_id);
CREATE INDEX idx_deal_outcomes_closed_at ON deal_outcomes(workspace_id, closed_at);
CREATE INDEX idx_deal_outcomes_outcome ON deal_outcomes(workspace_id, outcome);

COMMENT ON TABLE deal_outcomes IS 'Records deal scores at time of close for experimental scoring optimization';
COMMENT ON COLUMN deal_outcomes.crm_score IS 'Health score from CRM data (activity, stage velocity)';
COMMENT ON COLUMN deal_outcomes.skill_score IS 'Risk score from AI findings';
COMMENT ON COLUMN deal_outcomes.conversation_score IS 'Score derived from conversation sentiment';
COMMENT ON COLUMN deal_outcomes.composite_score IS 'Weighted composite of all available scores';
