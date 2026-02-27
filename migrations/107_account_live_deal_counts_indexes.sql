-- Indexes to support live deal count computation in accounts list
-- Ensures LATERAL JOINs perform efficiently for 2K+ accounts

CREATE INDEX IF NOT EXISTS idx_deals_account
  ON deals (account_id, workspace_id)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_account
  ON conversations (account_id, workspace_id)
  WHERE account_id IS NOT NULL;

-- Index for stage_normalized filtering in open deal count computation
CREATE INDEX IF NOT EXISTS idx_deals_stage_normalized
  ON deals (workspace_id, stage_normalized)
  WHERE stage_normalized IS NOT NULL;

COMMENT ON INDEX idx_deals_account IS 'Supports live deal count computation for account lists';
COMMENT ON INDEX idx_conversations_account IS 'Supports live conversation stats for account lists';
COMMENT ON INDEX idx_deals_stage_normalized IS 'Supports filtering open vs closed deals';
