-- ============================================================================
-- Agent Runs Table Migration
-- ============================================================================
-- Created: 2026-02-14
-- Purpose: Store agent execution results with accumulated evidence from multiple skills
--
-- Agents are compositions of skills:
-- - Run multiple skills in sequence
-- - Cache skill outputs (configurable TTL)
-- - Cross-skill synthesis (Claude call over combined results)
-- - Deliverable generation (Slack + Excel export)
--
-- Agent runs accumulate evidence from all constituent skills:
-- - skillEvidence: Record<outputKey, SkillEvidence>
-- - Used by workbook generator for multi-skill exports
-- - Used by agent synthesis prompts for narrative generation
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID UNIQUE NOT NULL,

  -- Context
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,

  -- Execution status
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'partial')),

  -- Skill execution results
  skill_results JSONB NOT NULL DEFAULT '[]'::jsonb,  -- Array of { skillId, status, duration, error }

  -- Accumulated evidence from all skills
  skill_evidence JSONB,  -- Record<outputKey, SkillEvidence>

  -- Synthesis output
  synthesized_output TEXT,

  -- Performance
  token_usage JSONB,     -- { skills: number, synthesis: number, total: number }
  duration_ms INTEGER,

  -- Error tracking
  error TEXT,

  -- Slack delivery
  slack_message_ts TEXT,
  slack_channel_id TEXT,

  -- Timestamps
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Primary query: latest run per agent per workspace
CREATE INDEX idx_agent_runs_latest
  ON agent_runs (workspace_id, agent_id, completed_at DESC NULLS LAST);

-- Agent run history (for run comparison, analytics)
CREATE INDEX idx_agent_runs_history
  ON agent_runs (agent_id, workspace_id, started_at DESC);

-- Slack message tracking
CREATE INDEX idx_agent_runs_slack
  ON agent_runs (slack_channel_id, slack_message_ts)
  WHERE slack_message_ts IS NOT NULL;

-- Evidence search (GIN index for JSONB queries)
CREATE INDEX idx_agent_runs_evidence
  ON agent_runs USING GIN (skill_evidence);

-- Export queries (find runs with completed status for download)
CREATE INDEX idx_agent_runs_export
  ON agent_runs (workspace_id, agent_id, run_id, status)
  WHERE status = 'completed';

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE agent_runs IS 'Agent execution results with accumulated evidence from multiple skills';
COMMENT ON COLUMN agent_runs.skill_results IS 'Array of { skillId, status, duration, error?, cached? } for each skill step';
COMMENT ON COLUMN agent_runs.skill_evidence IS 'Accumulated SkillEvidence objects keyed by outputKey from agent definition';
COMMENT ON COLUMN agent_runs.synthesized_output IS 'Cross-skill synthesis narrative (if synthesis enabled in agent definition)';
COMMENT ON COLUMN agent_runs.token_usage IS '{ skills: total from all skills, synthesis: from synthesis step, total: sum }';
