CREATE TABLE IF NOT EXISTS deal_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  deal_id UUID NOT NULL REFERENCES deals(id),
  insight_type TEXT NOT NULL,
  insight_key TEXT,
  value TEXT NOT NULL,
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0.5,
  source_conversation_id UUID REFERENCES conversations(id),
  source_quote TEXT,
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_by UUID REFERENCES deal_insights(id),
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  exported_to_crm BOOLEAN NOT NULL DEFAULT FALSE,
  exported_at TIMESTAMPTZ,
  crm_field_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_insights_workspace ON deal_insights(workspace_id);
CREATE INDEX IF NOT EXISTS idx_deal_insights_deal ON deal_insights(deal_id, is_current);
CREATE INDEX IF NOT EXISTS idx_deal_insights_type ON deal_insights(workspace_id, insight_type);
CREATE INDEX IF NOT EXISTS idx_deal_insights_conversation ON deal_insights(source_conversation_id);
