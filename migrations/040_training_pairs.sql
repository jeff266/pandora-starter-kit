-- Training pairs for LLM fine-tuning data capture
-- Every AI call through the LLM router is logged here so we can
-- fine-tune a Llama 3.1 8B model on Fireworks for GTM classification.

CREATE TABLE training_pairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- What produced this pair
  capability TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  skill_id TEXT,
  skill_run_id UUID,
  source_context TEXT,

  -- The training data
  system_prompt TEXT,
  user_prompt TEXT NOT NULL,
  assistant_response TEXT NOT NULL,

  -- Structured I/O
  input_schema JSONB,
  output_schema JSONB,

  -- Quality signals
  quality_score SMALLINT,
  quality_source TEXT,
  was_overridden BOOLEAN DEFAULT FALSE,
  override_value JSONB,

  -- Token economics
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER,

  -- Export tracking
  exported_at TIMESTAMPTZ,
  export_batch TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_training_pairs_export
  ON training_pairs(capability, quality_score)
  WHERE exported_at IS NULL;

CREATE INDEX idx_training_pairs_overrides
  ON training_pairs(capability)
  WHERE was_overridden = TRUE;

CREATE INDEX idx_training_pairs_workspace
  ON training_pairs(workspace_id, created_at DESC);

CREATE INDEX idx_training_pairs_skill_run
  ON training_pairs(skill_run_id)
  WHERE skill_run_id IS NOT NULL;

CREATE INDEX idx_training_pairs_quality
  ON training_pairs(capability, quality_score)
  WHERE quality_score >= 3;
