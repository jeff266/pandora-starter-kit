CREATE TABLE IF NOT EXISTS llm_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  providers JSONB NOT NULL DEFAULT '{}',
  routing JSONB NOT NULL DEFAULT '{
    "extract": "fireworks/deepseek-v3-0324",
    "reason": "anthropic/claude-sonnet-4-20250514",
    "generate": "anthropic/claude-sonnet-4-20250514",
    "classify": "fireworks/deepseek-v3-0324"
  }',
  default_token_budget INTEGER NOT NULL DEFAULT 50000,
  tokens_used_this_month INTEGER NOT NULL DEFAULT 0,
  budget_reset_at TIMESTAMPTZ NOT NULL DEFAULT (date_trunc('month', NOW()) + INTERVAL '1 month'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT llm_configs_workspace_unique UNIQUE (workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_llm_configs_workspace ON llm_configs(workspace_id);
