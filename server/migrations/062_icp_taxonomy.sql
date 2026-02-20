-- ICP Taxonomy Builder storage
-- Stores enriched ICP insights with web search signals per scope

CREATE TABLE IF NOT EXISTS icp_taxonomy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scope_id TEXT NOT NULL DEFAULT 'default',
  generated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Core taxonomy data
  vertical TEXT, -- 'healthcare', 'industrial', 'software', 'generic'
  top_accounts JSONB NOT NULL, -- Top 50 won accounts with Serper signals

  -- DeepSeek classifications
  account_classifications JSONB, -- Array of classified accounts

  -- Claude synthesis
  taxonomy_report JSONB NOT NULL, -- Final synthesized taxonomy

  -- Metadata
  accounts_analyzed INT NOT NULL,
  won_deals_count INT NOT NULL,
  serper_searches INT NOT NULL,
  token_usage JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_icp_taxonomy_workspace_scope
  ON icp_taxonomy(workspace_id, scope_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_icp_taxonomy_vertical
  ON icp_taxonomy(workspace_id, vertical);

-- Add taxonomy reference to icp_profiles for integration
ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS taxonomy_id UUID REFERENCES icp_taxonomy(id);
ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS scope_id TEXT DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_icp_profiles_scope ON icp_profiles(workspace_id, scope_id, generated_at DESC);
