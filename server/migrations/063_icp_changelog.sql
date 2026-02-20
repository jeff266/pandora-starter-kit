-- Migration: ICP Changelog Table
-- Creates table to track changes to ICP profiles over time
-- Supports manual edits, automated updates, and version history

CREATE TABLE IF NOT EXISTS icp_changelog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES icp_profiles(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  change_type TEXT NOT NULL, -- 'manual_edit', 'automated_refresh', 'version_increment', etc.
  changed_by TEXT, -- User email, agent name, or 'system'
  change_note TEXT, -- Optional description of the change
  diff JSONB NOT NULL, -- { field: "...", before: {...}, after: {...} }
  accounts_affected INTEGER, -- Number of accounts impacted by this change
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_icp_changelog_workspace ON icp_changelog(workspace_id);
CREATE INDEX idx_icp_changelog_profile ON icp_changelog(profile_id);
CREATE INDEX idx_icp_changelog_created ON icp_changelog(created_at DESC);

-- Composite index for workspace + profile lookups
CREATE INDEX idx_icp_changelog_workspace_profile ON icp_changelog(workspace_id, profile_id);

-- Comment for documentation
COMMENT ON TABLE icp_changelog IS 'Tracks all changes to ICP profiles including manual edits, automated refreshes, and version updates';
COMMENT ON COLUMN icp_changelog.change_type IS 'Type of change: manual_edit, automated_refresh, version_increment, field_update, etc.';
COMMENT ON COLUMN icp_changelog.diff IS 'JSONB containing field name and before/after values';
COMMENT ON COLUMN icp_changelog.accounts_affected IS 'Number of accounts whose scores may have changed due to this update';
