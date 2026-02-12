-- Migration: Deal-Contact associations and enhanced activities tracking
-- Adds OpportunityContactRole junction table and activity enhancements

-- Deal-Contact association table (OpportunityContactRole from Salesforce)
CREATE TABLE IF NOT EXISTS deal_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  role TEXT,
  is_primary BOOLEAN DEFAULT false,
  source TEXT NOT NULL DEFAULT 'salesforce',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, deal_id, contact_id, source)
);

CREATE INDEX idx_deal_contacts_deal ON deal_contacts(deal_id);
CREATE INDEX idx_deal_contacts_contact ON deal_contacts(contact_id);
CREATE INDEX idx_deal_contacts_workspace ON deal_contacts(workspace_id);

-- Add indexes for activities to improve query performance
CREATE INDEX IF NOT EXISTS idx_activities_deal ON activities(deal_id);
CREATE INDEX IF NOT EXISTS idx_activities_contact ON activities(contact_id);
CREATE INDEX IF NOT EXISTS idx_activities_timestamp ON activities(timestamp);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(activity_type);
