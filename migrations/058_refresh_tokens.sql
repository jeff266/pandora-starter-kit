-- Migration: Refresh Tokens
-- JWT refresh token storage with token rotation and expiry

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user
  ON refresh_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires
  ON refresh_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash
  ON refresh_tokens(token_hash);

COMMENT ON TABLE refresh_tokens IS 'JWT refresh token storage for session management';
COMMENT ON COLUMN refresh_tokens.token_hash IS 'SHA-256 hash of raw token - never store raw tokens';
COMMENT ON COLUMN refresh_tokens.expires_at IS '7 days from creation - expired tokens cleaned daily';
COMMENT ON COLUMN refresh_tokens.last_used_at IS 'Updated on each successful refresh for analytics';
