-- Migration: Add 'rep' system role type
-- Extend workspace_roles system_type to support sales rep role

-- Note: workspace_roles.system_type is a TEXT column with values:
-- 'admin' | 'manager' | 'analyst' | 'viewer' | 'member' | NULL
-- Adding 'rep' as a valid system_type for sales representatives

-- This is informational only - no ALTER TYPE needed since system_type is TEXT
-- Just documenting that 'rep' is now a valid system_type value

COMMENT ON COLUMN workspace_roles.system_type IS 'System role type: admin | manager | rep | analyst | viewer | member | NULL for custom roles';

-- Ensure workspace roles are created for existing workspaces
-- This will be handled by application code when roles are queried
