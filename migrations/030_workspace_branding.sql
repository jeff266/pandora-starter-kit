-- Workspace Branding Configuration
-- Add branding configuration storage for deliverables

-- Add branding column to workspaces
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS branding JSONB DEFAULT NULL;

-- Index for quick lookup
CREATE INDEX IF NOT EXISTS idx_workspaces_branding
  ON workspaces USING gin (branding) WHERE branding IS NOT NULL;

COMMENT ON COLUMN workspaces.branding IS
  'Optional branding config for deliverables: { logo_url, primary_color, secondary_color, company_name, prepared_by, confidentiality_notice, font_family }';
