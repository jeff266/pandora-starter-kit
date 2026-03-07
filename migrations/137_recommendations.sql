CREATE TABLE recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  session_id TEXT,
  deal_id UUID REFERENCES deals(id),
  deal_name TEXT,
  action TEXT NOT NULL,           -- the recommendation text
  category TEXT,                  -- 'deal_risk'|'pipeline'|'rep_coaching'|etc
  urgency TEXT,                   -- 'today'|'this_week'|'next_week'|'strategic'
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending'|'accepted'|'dismissed'|'actioned'|'resolved'
  outcome TEXT,                   -- 'closed_won'|'closed_lost'|'slipped'|'timeout'
  was_actioned BOOLEAN,
  recommendation_correct BOOLEAN,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON recommendations(workspace_id, status);
CREATE INDEX ON recommendations(workspace_id, deal_id) WHERE deal_id IS NOT NULL;
