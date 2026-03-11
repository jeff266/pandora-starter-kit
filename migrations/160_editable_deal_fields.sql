-- Editable Deal Fields Configuration
-- Admins configure which CRM fields should be editable inline on Deal Detail page

CREATE TABLE IF NOT EXISTS editable_deal_fields (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Local field mapping
  field_name TEXT NOT NULL,              -- Column name in deals table (e.g., 'next_steps', 'amount')
  field_label TEXT NOT NULL,             -- Display label (e.g., 'Next Steps', 'Deal Amount')
  field_type TEXT NOT NULL,              -- 'text' | 'number' | 'date' | 'picklist' | 'textarea' | 'boolean'

  -- CRM mapping
  crm_property_name TEXT NOT NULL,       -- CRM API name (e.g., 'next_step' for HubSpot, 'Next_Steps__c' for Salesforce)
  crm_property_label TEXT,               -- Original CRM label

  -- Configuration
  is_editable BOOLEAN DEFAULT true,
  is_required BOOLEAN DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0,
  help_text TEXT,                        -- Optional tooltip/helper text

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by_user_id UUID REFERENCES users(id),

  -- Prevent duplicate field configurations per workspace
  UNIQUE(workspace_id, field_name)
);

CREATE INDEX idx_editable_deal_fields_workspace ON editable_deal_fields(workspace_id) WHERE is_editable = true;
CREATE INDEX idx_editable_deal_fields_display_order ON editable_deal_fields(workspace_id, display_order);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_editable_deal_fields_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER editable_deal_fields_updated_at
  BEFORE UPDATE ON editable_deal_fields
  FOR EACH ROW
  EXECUTE FUNCTION update_editable_deal_fields_updated_at();
