ALTER TABLE deal_contacts ADD COLUMN IF NOT EXISTS previous_companies JSONB DEFAULT '[]';

ALTER TABLE account_signals ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id);
ALTER TABLE account_signals ADD COLUMN IF NOT EXISTS signals JSONB NOT NULL DEFAULT '[]';
ALTER TABLE account_signals ADD COLUMN IF NOT EXISTS signal_summary TEXT;
ALTER TABLE account_signals ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE account_signals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_deal_contacts_role ON deal_contacts(workspace_id, buying_role);
CREATE INDEX IF NOT EXISTS idx_deal_contacts_enrichment ON deal_contacts(workspace_id, enrichment_status);
CREATE INDEX IF NOT EXISTS idx_account_signals_account ON account_signals(account_id);

CREATE INDEX IF NOT EXISTS idx_icp_profiles_active ON icp_profiles(workspace_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_lead_scores_contact ON lead_scores(workspace_id, entity_id) WHERE entity_type = 'contact';
CREATE INDEX IF NOT EXISTS idx_lead_scores_deal ON lead_scores(workspace_id, entity_id) WHERE entity_type = 'deal';
