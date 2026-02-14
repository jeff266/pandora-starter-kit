-- Add skill_evidence JSONB column to agent_runs for evidence architecture
-- Stores accumulated evidence from all skills that produced it during an agent run
-- Keyed by skill outputKey, used by WorkbookGenerator and Command Center downstream

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS
  skill_evidence JSONB DEFAULT '{}';

-- Index for efficient queries on agent runs with evidence
CREATE INDEX IF NOT EXISTS idx_agent_runs_has_evidence
  ON agent_runs ((skill_evidence IS NOT NULL AND skill_evidence != '{}'::jsonb))
  WHERE skill_evidence IS NOT NULL AND skill_evidence != '{}'::jsonb;
