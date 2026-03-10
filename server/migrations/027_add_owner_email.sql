-- Add owner_email column for role-based access control
-- Currently deals.owner stores owner NAME, but we need EMAIL for RBAC filtering

ALTER TABLE deals ADD COLUMN IF NOT EXISTS owner_email TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS owner_email TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS owner_email TEXT;

-- Add indexes for filtering by owner_email
CREATE INDEX IF NOT EXISTS idx_deals_owner_email ON deals(workspace_id, owner_email) WHERE owner_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_accounts_owner_email ON accounts(workspace_id, owner_email) WHERE owner_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_owner_email ON contacts(workspace_id, owner_email) WHERE owner_email IS NOT NULL;

-- Note: owner_email will be populated during next sync
-- Existing records will have NULL owner_email until re-synced
