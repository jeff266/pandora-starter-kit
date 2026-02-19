-- Migration 059: Add manual scope override capability to deals table
--
-- Allows admins to manually reassign miscategorized deals to different scopes.
-- Manual overrides survive CRM syncs — stampDealScopes() skips deals with
-- scope_override IS NOT NULL.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS scope_override TEXT DEFAULT NULL;

-- Partial index — overrides will always be a small minority of deals
CREATE INDEX IF NOT EXISTS idx_deals_scope_override
  ON deals(workspace_id, scope_override)
  WHERE scope_override IS NOT NULL;

COMMENT ON COLUMN deals.scope_override IS 'Manual scope assignment — when set, protects deal from automatic scope stamping during sync';
