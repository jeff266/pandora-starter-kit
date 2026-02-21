-- Migration 051: Report Viewer + Sharing
-- Adds sections_content storage to generations and sharing infrastructure

-- Add sections_content to report_generations for the viewer
ALTER TABLE report_generations
  ADD COLUMN IF NOT EXISTS sections_content JSONB;

COMMENT ON COLUMN report_generations.sections_content IS 'Full SectionContent[] array for viewer rendering';

-- Share links for public/private report access
CREATE TABLE IF NOT EXISTS report_share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_template_id UUID NOT NULL REFERENCES report_templates(id) ON DELETE CASCADE,
  generation_id UUID REFERENCES report_generations(id) ON DELETE CASCADE,  -- null = share all generations
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  share_token VARCHAR(32) NOT NULL UNIQUE,  -- URL-safe random token
  access_type VARCHAR(20) NOT NULL DEFAULT 'public',  -- public, workspace, specific_emails
  allowed_emails JSONB DEFAULT '[]',
  password_hash VARCHAR(255),
  include_download BOOLEAN DEFAULT true,

  expires_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ,
  access_count INTEGER DEFAULT 0,

  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT valid_access_type CHECK (access_type IN ('public', 'workspace', 'specific_emails'))
);

CREATE INDEX IF NOT EXISTS idx_report_share_links_token ON report_share_links(share_token);
CREATE INDEX IF NOT EXISTS idx_report_share_links_template ON report_share_links(report_template_id);
CREATE INDEX IF NOT EXISTS idx_report_share_links_generation ON report_share_links(generation_id);

COMMENT ON TABLE report_share_links IS 'Shareable report links with access control';
COMMENT ON COLUMN report_share_links.share_token IS 'URL-safe random token for /shared/:token route';
COMMENT ON COLUMN report_share_links.generation_id IS 'Null means share all generations of the template';
