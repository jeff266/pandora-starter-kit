-- Migration: Add workspace status for offboarding capability
-- Allows marking workspaces as 'deleting' or 'suspended' to exclude from scheduled operations

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'deleting', 'suspended'));

COMMENT ON COLUMN workspaces.status IS 'Workspace lifecycle status: active (normal), deleting (pending deletion), suspended (paused)';
