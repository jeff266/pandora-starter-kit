-- Migration 151: Add owner_email column to deals and accounts
-- The HubSpot connector's transform.ts already computes owner_email during sync.
-- This column is the foundation for owner-based RLS data filtering.
-- Existing rows will have NULL until the next HubSpot sync.

ALTER TABLE deals ADD COLUMN IF NOT EXISTS owner_email TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS owner_email TEXT;

CREATE INDEX IF NOT EXISTS idx_deals_owner_email
  ON deals (workspace_id, owner_email)
  WHERE owner_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_owner_email
  ON accounts (workspace_id, owner_email)
  WHERE owner_email IS NOT NULL;
