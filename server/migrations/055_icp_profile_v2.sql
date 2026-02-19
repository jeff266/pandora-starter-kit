-- Add conversation_insights column to icp_profiles
ALTER TABLE icp_profiles
  ADD COLUMN IF NOT EXISTS conversation_insights JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS conversation_data_tier INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conversation_calls_analyzed INTEGER DEFAULT 0;

-- ICP changelog table
CREATE TABLE IF NOT EXISTS icp_changelog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES icp_profiles(id) ON DELETE SET NULL,
  version TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('regeneration', 'manual_edit', 'connector_change')),
  changed_by TEXT DEFAULT NULL,
  change_note TEXT DEFAULT NULL,
  diff JSONB DEFAULT NULL,
  accounts_affected INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_icp_changelog_workspace ON icp_changelog(workspace_id, created_at DESC);
