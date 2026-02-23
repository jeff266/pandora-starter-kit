-- Migration: Enriched Accounts Table
-- Purpose: Normalized firmographic data from Apollo, Webhook, CSV enrichment sources
-- Used by: ICP Discovery skill for pattern detection

CREATE TABLE IF NOT EXISTS enriched_accounts (
  id TEXT PRIMARY KEY DEFAULT ('enr_' || gen_random_uuid()),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Account matching fields (at least one required)
  domain TEXT,
  company_name TEXT,
  crm_account_id TEXT,  -- Links back to CRM account if matched

  -- Firmographic signals (all optional)
  industry TEXT,
  employee_count INTEGER,
  employee_range TEXT,
  revenue_range TEXT,
  funding_stage TEXT,

  -- Geography
  hq_country TEXT,
  hq_state TEXT,
  hq_city TEXT,

  -- Technology & growth
  tech_stack TEXT[],
  growth_signal TEXT,  -- 'growing', 'stable', 'contracting'

  -- Additional metadata
  founded_year INTEGER,
  public_or_private TEXT,  -- 'public', 'private', 'nonprofit'

  -- Enrichment tracking
  enrichment_source TEXT NOT NULL,  -- 'apollo', 'webhook', 'csv'
  enriched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confidence_score REAL NOT NULL DEFAULT 0.0,  -- 0.0 to 1.0

  -- Idempotency for webhook connector
  pandora_batch_id TEXT,

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT enriched_accounts_check_identifier
    CHECK (domain IS NOT NULL OR company_name IS NOT NULL),
  CONSTRAINT enriched_accounts_check_confidence
    CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
  CONSTRAINT enriched_accounts_check_source
    CHECK (enrichment_source IN ('apollo', 'webhook', 'csv'))
);

-- Indexes for lookups
CREATE INDEX idx_enriched_accounts_workspace ON enriched_accounts(workspace_id);
CREATE INDEX idx_enriched_accounts_domain ON enriched_accounts(domain) WHERE domain IS NOT NULL;
CREATE INDEX idx_enriched_accounts_company_name ON enriched_accounts(company_name) WHERE company_name IS NOT NULL;
CREATE INDEX idx_enriched_accounts_crm_account ON enriched_accounts(crm_account_id) WHERE crm_account_id IS NOT NULL;
CREATE INDEX idx_enriched_accounts_source ON enriched_accounts(workspace_id, enrichment_source);
CREATE INDEX idx_enriched_accounts_batch ON enriched_accounts(pandora_batch_id) WHERE pandora_batch_id IS NOT NULL;

-- Composite index for ICP Discovery queries (high confidence records only)
CREATE INDEX idx_enriched_accounts_icp ON enriched_accounts(workspace_id, confidence_score)
  WHERE confidence_score >= 0.5;

-- Updated_at trigger
CREATE TRIGGER enriched_accounts_updated_at
  BEFORE UPDATE ON enriched_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE enriched_accounts IS 'Normalized firmographic enrichment data from Apollo, Webhook, CSV sources';
COMMENT ON COLUMN enriched_accounts.domain IS 'Primary match key - preferred for unambiguous account linking';
COMMENT ON COLUMN enriched_accounts.company_name IS 'Fallback match key - fuzzy matching with manual review if confidence < 0.7';
COMMENT ON COLUMN enriched_accounts.confidence_score IS 'Auto-calculated based on field completeness: 0.9-1.0=High, 0.7-0.89=Medium, 0.5-0.69=Low';
COMMENT ON COLUMN enriched_accounts.pandora_batch_id IS 'Idempotency key for webhook connector to prevent duplicate enrichment';
