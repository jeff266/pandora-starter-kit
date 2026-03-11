-- Add updated_at to workspace_members for tracking deactivation/reactivation timestamps
ALTER TABLE workspace_members
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE;
