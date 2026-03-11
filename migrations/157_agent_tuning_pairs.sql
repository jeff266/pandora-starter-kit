-- Migration 157: agent_tuning_pairs
-- Structured input/output training pairs for the fine-tuning pipeline.
-- Populated automatically when a CRO/VP annotates a report with metric overrides.
-- Each row represents one human correction: model output vs preferred human output.

CREATE TABLE IF NOT EXISTS agent_tuning_pairs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id          TEXT,
  generation_id     UUID REFERENCES report_generations(id) ON DELETE SET NULL,
  skill_id          TEXT,
  source            TEXT NOT NULL DEFAULT 'report_annotation',
  block_id          TEXT,
  input_context     TEXT NOT NULL,
  preferred_output  TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_tuning_pairs_workspace
  ON agent_tuning_pairs(workspace_id);

CREATE INDEX IF NOT EXISTS idx_agent_tuning_pairs_agent
  ON agent_tuning_pairs(workspace_id, agent_id)
  WHERE agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_tuning_pairs_skill
  ON agent_tuning_pairs(workspace_id, skill_id)
  WHERE skill_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_tuning_pairs_source
  ON agent_tuning_pairs(source, created_at DESC);

COMMENT ON TABLE agent_tuning_pairs IS 'Structured input/output correction pairs for fine-tuning. Each row is one human override: input_context = original model value, preferred_output = human correction.';
COMMENT ON COLUMN agent_tuning_pairs.source IS 'Origin of the pair: report_annotation, feedback_promotion, manual';
COMMENT ON COLUMN agent_tuning_pairs.input_context IS 'The original value produced by the model';
COMMENT ON COLUMN agent_tuning_pairs.preferred_output IS 'The human-corrected value — the preferred training target';
COMMENT ON COLUMN agent_tuning_pairs.skill_id IS 'The skill that produced the original output, pulled from report_generations.skills_run';
