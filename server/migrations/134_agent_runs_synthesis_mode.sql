-- Migration 134: Add synthesis_mode to agent_runs
-- Tracks whether goal-aware or findings-dump synthesis path was used per run.
-- synthesis_output was added in migration 133; this migration adds the mode column.

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS synthesis_mode TEXT
  DEFAULT 'findings_dump'
  CHECK (synthesis_mode IN ('findings_dump', 'goal_aware'));
