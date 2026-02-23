-- Migration: Intent Classification Log
-- Purpose: Track intent classifier performance and routing decisions
-- Used by: Ask Pandora intent classifier for observability and accuracy improvement

CREATE TABLE IF NOT EXISTS intent_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Input
  question_text TEXT NOT NULL,          -- first 500 chars of user message
  question_length_tokens INTEGER,
  context_length_tokens INTEGER,

  -- Classification result
  category TEXT NOT NULL,               -- data_query | advisory_stateless | advisory_with_data_option | ambiguous
  confidence NUMERIC NOT NULL,
  fast_path BOOLEAN NOT NULL DEFAULT false,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  classifier_model TEXT,                -- 'deepseek' | 'claude' | 'regex' | null

  -- Outcome tracking (for future accuracy improvement)
  user_overrode BOOLEAN,               -- did user pick "mine data" after gating question?

  classified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_intent_log_workspace
  ON intent_classifications(workspace_id, classified_at DESC);

CREATE INDEX idx_intent_log_category
  ON intent_classifications(workspace_id, category, classified_at DESC);

COMMENT ON TABLE intent_classifications IS 'Tracks intent classifier performance for Ask Pandora questions - enables accuracy monitoring and pattern analysis';
COMMENT ON COLUMN intent_classifications.category IS 'Intent category: data_query (needs tools), advisory_stateless (no data), advisory_with_data_option (better with data), ambiguous (uncertain)';
COMMENT ON COLUMN intent_classifications.fast_path IS 'True if classified via regex pattern match (no LLM call)';
COMMENT ON COLUMN intent_classifications.user_overrode IS 'For advisory_with_data_option: did user choose "mine data" path after gating question?';
