-- T005: User-awareness schema additions
-- Add pandora_role to workspace_members (Pandora data-visibility role, separate from access-control role)
ALTER TABLE workspace_members
  ADD COLUMN IF NOT EXISTS pandora_role TEXT;

-- Add target type and assignment columns to targets table
ALTER TABLE targets
  ADD COLUMN IF NOT EXISTS target_type TEXT NOT NULL DEFAULT 'company',
  ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_to_email TEXT;

-- Backfill existing targets as company-wide (already handled by DEFAULT 'company' above)
-- No data migration needed
