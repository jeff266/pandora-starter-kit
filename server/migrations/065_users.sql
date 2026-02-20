-- Migration: Create global users table
-- Separates platform identity from workspace membership

CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  avatar_url      TEXT,
  password_hash   TEXT,
  account_type    TEXT NOT NULL DEFAULT 'standard',
  anonymize_mode  BOOLEAN NOT NULL DEFAULT false,
  is_pandora_staff BOOLEAN NOT NULL DEFAULT false,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

COMMENT ON TABLE users IS 'Global user identity table - one record per unique user across all workspaces';
