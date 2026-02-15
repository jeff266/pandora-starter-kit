-- ============================================================================
-- Workspace Downloads Table Migration
-- ============================================================================
-- Created: 2026-02-15
-- Purpose: Persisted downloadable files for agent/deliverable outputs
--
-- This supports the Channel Delivery layer (Layer 7):
-- - Agents generate XLSX/PDF reports via renderers
-- - Files are persisted to workspace storage
-- - Download links are provided to users
-- - TTL-based cleanup for temp files
-- ============================================================================

CREATE TABLE IF NOT EXISTS workspace_downloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ownership
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_run_id UUID REFERENCES agent_runs(id) ON DELETE CASCADE,
  deliverable_id UUID, -- From deliverables table if template-based

  -- File metadata
  filename TEXT NOT NULL,
  format TEXT NOT NULL,  -- 'xlsx', 'pdf', 'pptx'
  file_path TEXT NOT NULL,  -- Relative path in workspace storage
  file_size_bytes INTEGER,

  -- Access control
  created_by TEXT,  -- User email or 'system'
  is_public BOOLEAN DEFAULT false,

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,  -- Null = permanent, timestamp = auto-cleanup
  downloaded_count INTEGER DEFAULT 0,
  last_downloaded_at TIMESTAMPTZ
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Primary query: workspace downloads list (newest first)
CREATE INDEX idx_workspace_downloads_workspace
  ON workspace_downloads (workspace_id, created_at DESC);

-- Agent run association
CREATE INDEX idx_workspace_downloads_agent_run
  ON workspace_downloads (agent_run_id)
  WHERE agent_run_id IS NOT NULL;

-- Deliverable association
CREATE INDEX idx_workspace_downloads_deliverable
  ON workspace_downloads (deliverable_id)
  WHERE deliverable_id IS NOT NULL;

-- Cleanup job: find expired files
CREATE INDEX idx_workspace_downloads_cleanup
  ON workspace_downloads (expires_at);

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE workspace_downloads IS 'Persisted downloadable files from agent runs and deliverables';
COMMENT ON COLUMN workspace_downloads.file_path IS 'Relative path within workspace storage directory (e.g., "downloads/2026/02/abc123.xlsx")';
COMMENT ON COLUMN workspace_downloads.expires_at IS 'Null = permanent file, timestamp = auto-cleanup after expiry';
COMMENT ON COLUMN workspace_downloads.is_public IS 'If true, accessible without authentication via public link';




