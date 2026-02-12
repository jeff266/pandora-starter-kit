-- Migration 015: Leads Table for Salesforce Lead Object Sync
-- Enables ICP funnel analysis by tracking lead-to-opportunity conversion

-- ============================================================================
-- CREATE leads TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'salesforce',
  source_id TEXT NOT NULL,

  -- Identity
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  title TEXT,
  company TEXT,
  website TEXT,

  -- Classification
  status TEXT,                    -- New, Working, Qualified, Converted, Disqualified
  lead_source TEXT,               -- Web, Referral, Event, Outbound, etc.
  industry TEXT,
  annual_revenue NUMERIC,
  employee_count INTEGER,

  -- Conversion tracking
  is_converted BOOLEAN DEFAULT false,
  converted_at TIMESTAMPTZ,
  converted_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  converted_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  converted_deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,

  -- Salesforce IDs for post-sync linking (resolved to UUIDs after sync)
  sf_converted_contact_id TEXT,
  sf_converted_account_id TEXT,
  sf_converted_opportunity_id TEXT,

  -- Ownership
  owner_id TEXT,
  owner_name TEXT,
  owner_email TEXT,

  -- Custom fields (same pattern as deals/contacts/accounts)
  custom_fields JSONB DEFAULT '{}',

  -- Metadata
  source_data JSONB DEFAULT '{}',
  created_date TIMESTAMPTZ,        -- CRM created date
  last_modified TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(workspace_id, source, source_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_leads_workspace ON leads(workspace_id);
CREATE INDEX IF NOT EXISTS idx_leads_converted ON leads(workspace_id, is_converted);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(workspace_id, lead_source);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_created_date ON leads(workspace_id, created_date DESC);
CREATE INDEX IF NOT EXISTS idx_leads_converted_at ON leads(workspace_id, converted_at DESC) WHERE converted_at IS NOT NULL;

-- Index for post-sync linking (lookups by Salesforce IDs)
CREATE INDEX IF NOT EXISTS idx_leads_sf_converted_contact ON leads(workspace_id, sf_converted_contact_id) WHERE sf_converted_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_sf_converted_account ON leads(workspace_id, sf_converted_account_id) WHERE sf_converted_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_sf_converted_opp ON leads(workspace_id, sf_converted_opportunity_id) WHERE sf_converted_opportunity_id IS NOT NULL;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- After running this migration, verify with:
-- SELECT COUNT(*) FROM leads;
-- SELECT indexname FROM pg_indexes WHERE tablename = 'leads';
