CREATE TABLE IF NOT EXISTS skill_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  trigger_type TEXT,
  params JSONB NOT NULL DEFAULT '{}',
  result JSONB,
  output_text TEXT,
  steps JSONB NOT NULL DEFAULT '[]',
  token_usage JSONB NOT NULL DEFAULT '{"compute": 0, "deepseek": 0, "claude": 0}',
  duration_ms INTEGER,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_skill_runs_workspace_skill_created
  ON skill_runs (workspace_id, skill_id, created_at DESC);

CREATE INDEX idx_skill_runs_workspace_status
  ON skill_runs (workspace_id, status);

CREATE INDEX idx_skill_runs_skill_created
  ON skill_runs (skill_id, created_at DESC);
