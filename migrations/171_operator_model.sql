-- Migration 171: Operator Model + Loop Execution
-- Adds execution modes, loop configuration, and autonomy tier to agents
-- Adds loop tracking columns to agent_runs

-- ============================================================================
-- Operator identity and execution mode on agents
-- ============================================================================

ALTER TABLE agents ADD COLUMN IF NOT EXISTS role TEXT;

ALTER TABLE agents ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'pipeline';
-- Values: 'pipeline' (existing behavior), 'loop' (reasoning loop), 'auto' (classifier decides)

COMMENT ON COLUMN agents.execution_mode IS 'Execution strategy: pipeline (skills in sequence), loop (reasoning-driven), auto (context-dependent)';

ALTER TABLE agents ADD COLUMN IF NOT EXISTS loop_config JSONB DEFAULT '{}';
-- Schema:
-- {
--   available_skills: string[],   -- skills the loop can choose from
--   max_iterations: number,       -- hard cap (default: 6)
--   termination: 'goal_satisfied' | 'max_iterations',
--   planning_prompt?: string      -- optional override for planning system prompt
-- }

COMMENT ON COLUMN agents.loop_config IS 'Loop executor configuration: available_skills, max_iterations, termination strategy, planning_prompt override';

ALTER TABLE agents ADD COLUMN IF NOT EXISTS post_action_playbook JSONB DEFAULT '[]';
-- Array of playbook entries triggered after agent decisions

COMMENT ON COLUMN agents.post_action_playbook IS 'Playbook actions triggered after agent execution (emit_action, notify, log_finding)';

ALTER TABLE agents ADD COLUMN IF NOT EXISTS autonomy_tier INTEGER NOT NULL DEFAULT 1;
-- 1 = Inform (observe + report)
-- 2 = Recommend (propose actions for approval)
-- 3 = Act (execute within policies)

COMMENT ON COLUMN agents.autonomy_tier IS 'Autonomy level: 1=Inform (observe+report), 2=Recommend (propose), 3=Act (execute)';

ALTER TABLE agents ADD COLUMN IF NOT EXISTS promotion_history JSONB DEFAULT '[]';
-- [{ from_tier, to_tier, promoted_at, promoted_by, evidence: { total_runs, weeks_active } }]

COMMENT ON COLUMN agents.promotion_history IS 'Tier promotion history with evidence (total_runs, weeks_active, approval_rate)';

-- ============================================================================
-- Loop tracking on agent_runs
-- ============================================================================

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS execution_mode TEXT DEFAULT 'pipeline';

COMMENT ON COLUMN agent_runs.execution_mode IS 'How this run executed: pipeline (skill sequence) or loop (reasoning-driven)';

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS loop_iterations INTEGER;

COMMENT ON COLUMN agent_runs.loop_iterations IS 'Number of reasoning iterations completed (loop mode only)';

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS loop_trace JSONB;
-- loop_trace: [{ iteration, observation, plan, skill_executed, evaluation, goal_progress, tokens }]

COMMENT ON COLUMN agent_runs.loop_trace IS 'Detailed loop execution trace: observations, plans, skills executed, evaluations per iteration';

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS termination_reason TEXT;
-- 'goal_satisfied', 'max_iterations', 'token_limit', 'error'

COMMENT ON COLUMN agent_runs.termination_reason IS 'Why the loop terminated: goal_satisfied, max_iterations, token_limit, error';

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_agents_execution_mode ON agents(execution_mode) WHERE execution_mode != 'pipeline';

CREATE INDEX IF NOT EXISTS idx_agents_autonomy_tier ON agents(autonomy_tier);

CREATE INDEX IF NOT EXISTS idx_agent_runs_loop_mode ON agent_runs(workspace_id, execution_mode) WHERE execution_mode = 'loop';
