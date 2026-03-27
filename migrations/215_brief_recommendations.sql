-- Recommendation accountability loop (Task #87)
-- Logs recommendations from brief assembly and chat so the next brief
-- can check in: "Last week I said X — here's what happened."
--
-- Index on (workspace_id, check_in_at) WHERE checked_in_at IS NULL
-- makes the weekly "what's due?" poll cheap.

CREATE TABLE IF NOT EXISTS brief_recommendations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID       NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source      TEXT        NOT NULL CHECK (source IN ('brief', 'chat')),
  entity_type TEXT        CHECK (entity_type IN ('deal', 'rep')),
  entity_id   UUID,
  entity_name TEXT        NOT NULL,
  recommendation_text TEXT NOT NULL,
  check_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  checked_in_at TIMESTAMPTZ,
  outcome_text TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS brief_recommendations_checkin_idx
  ON brief_recommendations (workspace_id, check_in_at)
  WHERE checked_in_at IS NULL;
