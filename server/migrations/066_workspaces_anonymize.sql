-- Migration: Workspaces Anonymize
-- Add plan and force_anonymize columns to workspaces table

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'starter',
  ADD COLUMN IF NOT EXISTS force_anonymize BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN workspaces.plan IS 'Subscription plan: starter | growth | pro | enterprise';
COMMENT ON COLUMN workspaces.force_anonymize IS 'Workspace-level anonymization override (takes precedence over user preference)';
