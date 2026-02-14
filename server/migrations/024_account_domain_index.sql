-- Add index for domain-based account linking
-- Improves performance of account-deal and account-contact linking

CREATE INDEX IF NOT EXISTS idx_accounts_domain
ON accounts (workspace_id, LOWER(domain))
WHERE domain IS NOT NULL;

COMMENT ON INDEX idx_accounts_domain IS 'Accelerates domain-based account linking for deals and contacts';
