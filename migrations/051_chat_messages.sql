-- Migration 051: Unified chat_messages log across all surfaces
-- Replaces monte_carlo_queries with a generalized chat log

CREATE TABLE IF NOT EXISTS chat_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id    TEXT NOT NULL,
  surface       TEXT NOT NULL
                  CHECK (surface IN (
                    'ask_pandora',
                    'mc_query',
                    'slack',
                    'deal_dossier',
                    'account_dossier'
                  )),
  role          TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content       TEXT NOT NULL,
  intent_type   TEXT,
  scope         JSONB,
  token_cost    INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session
  ON chat_messages (workspace_id, session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_surface
  ON chat_messages (workspace_id, surface, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_recent
  ON chat_messages (workspace_id, created_at DESC);

-- Migrate existing monte_carlo_queries rows → chat_messages (user turns)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'monte_carlo_queries') THEN
    INSERT INTO chat_messages (
      id, workspace_id, session_id, surface, role,
      content, intent_type, scope, token_cost, created_at
    )
    SELECT
      gen_random_uuid(),
      workspace_id,
      run_id::text,
      'mc_query',
      'user',
      question,
      intent_type,
      jsonb_build_object('type', 'mc_run', 'runId', run_id::text, 'pipelineId', pipeline_id),
      NULL,
      created_at
    FROM monte_carlo_queries
    ON CONFLICT DO NOTHING;

    -- Migrate assistant turns
    INSERT INTO chat_messages (
      id, workspace_id, session_id, surface, role,
      content, intent_type, scope, token_cost, created_at
    )
    SELECT
      gen_random_uuid(),
      workspace_id,
      run_id::text,
      'mc_query',
      'assistant',
      answer,
      intent_type,
      jsonb_build_object('type', 'mc_run', 'runId', run_id::text, 'pipelineId', pipeline_id),
      NULL,
      created_at + interval '1 second'
    FROM monte_carlo_queries
    ON CONFLICT DO NOTHING;

    DROP TABLE monte_carlo_queries;
  END IF;
END $$;
