-- Migration: Add timezone to workspaces table for report scheduling
-- Allows each workspace to specify their timezone for scheduled reports

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/Los_Angeles';

COMMENT ON COLUMN workspaces.timezone IS 'Workspace timezone for scheduled reports (IANA timezone identifier)';
