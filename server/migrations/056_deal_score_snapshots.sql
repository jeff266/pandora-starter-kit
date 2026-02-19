CREATE TABLE IF NOT EXISTS deal_score_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  health_score NUMERIC,
  skill_score NUMERIC,
  active_score NUMERIC,
  active_source TEXT DEFAULT 'health',
  grade TEXT,
  score_delta NUMERIC,
  commentary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS deal_score_snapshots_unique
  ON deal_score_snapshots(workspace_id, deal_id, snapshot_date);
CREATE INDEX IF NOT EXISTS deal_score_snapshots_deal_idx
  ON deal_score_snapshots(workspace_id, deal_id, snapshot_date DESC);
