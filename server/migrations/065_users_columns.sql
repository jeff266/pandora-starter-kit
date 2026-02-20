-- Migration: Users Columns
-- Add account_type, anonymize_mode, is_pandora_staff, last_login_at to users table

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS anonymize_mode BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_pandora_staff BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

COMMENT ON COLUMN users.account_type IS 'Account type: standard | multi_workspace';
COMMENT ON COLUMN users.anonymize_mode IS 'User preference for anonymizing data in UI';
COMMENT ON COLUMN users.is_pandora_staff IS 'Internal Pandora staff flag for elevated access';
COMMENT ON COLUMN users.last_login_at IS 'Timestamp of most recent login';
