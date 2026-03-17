-- Migration 185: Reports-First Scheduling
-- Enables report-first scheduling model where agents define delivery times
-- and skills run automatically before delivery

-- Add report_type and delivery scheduling to agents
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS report_type TEXT,
  ADD COLUMN IF NOT EXISTS delivery_hour INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS delivery_day_of_week INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS delivery_timezone TEXT DEFAULT 'America/Los_Angeles';

-- Add timezone to workspaces (if not already present)
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/Los_Angeles';

-- skill_runs trigger source (if not already added by prior migration)
ALTER TABLE skill_runs
  ADD COLUMN IF NOT EXISTS trigger_source TEXT DEFAULT 'manual';

-- Index for efficient schedule queries
CREATE INDEX IF NOT EXISTS idx_agents_report_type
  ON agents(workspace_id, report_type)
  WHERE report_type IS NOT NULL;

-- agent_skill_runs: track which agent run triggered which skill runs
-- Enables the Orchestrator to find the right skill evidence
CREATE TABLE IF NOT EXISTS agent_skill_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id UUID NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  skill_run_id UUID,              -- FK to skill_runs.id once completed
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_skill_runs_agent
  ON agent_skill_runs(agent_run_id);
CREATE INDEX IF NOT EXISTS idx_agent_skill_runs_workspace
  ON agent_skill_runs(workspace_id, created_at DESC);
