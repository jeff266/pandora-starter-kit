-- Finding preferences table
-- Persists Watch / Dismiss signals from the Concierge brief card buttons.
-- dismissed preferences expire after 7 days so a re-surfaced finding
-- can appear again if it remains unresolved.
-- watch preferences have no expiry — stay pinned until removed.

CREATE TABLE IF NOT EXISTS finding_preferences (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID      NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL,
  finding_id TEXT        NOT NULL,
  preference TEXT        NOT NULL CHECK (preference IN ('watch', 'dismissed')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, user_id, finding_id)
);

CREATE INDEX IF NOT EXISTS idx_finding_prefs_lookup
  ON finding_preferences (workspace_id, user_id, finding_id);
