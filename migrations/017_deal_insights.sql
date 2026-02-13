-- Migration 017: Deal Insights Extraction
-- Stores qualification insights (MEDDPIC/BANT/SPICED) extracted from conversation transcripts
-- Spec: PANDORA_DEAL_INSIGHTS_SPEC.md

CREATE TABLE deal_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,

  -- What was extracted
  insight_type TEXT NOT NULL,           -- 'champion', 'economic_buyer', 'decision_criteria',
                                        -- 'metrics', 'pain_point', 'timeline', 'competition',
                                        -- 'budget', 'authority', 'need', 'paper_process',
                                        -- 'implicate_pain', 'critical_event', 'decision_process',
                                        -- 'situation', 'impact', 'next_steps', 'custom'
  insight_key TEXT NOT NULL,            -- workspace-specific label, e.g., 'MEDDPIC_Champion'
                                        -- or user-defined label like 'Technical Requirements'
  value TEXT NOT NULL,                  -- the extracted insight (plain text)
  confidence NUMERIC NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),

  -- Provenance
  source_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  source_quote TEXT,                    -- relevant transcript excerpt, max 500 chars
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Versioning
  superseded_by UUID REFERENCES deal_insights(id) ON DELETE SET NULL,
  is_current BOOLEAN NOT NULL DEFAULT true,

  -- CRM export tracking
  exported_to_crm BOOLEAN NOT NULL DEFAULT false,
  exported_at TIMESTAMPTZ,
  crm_field_name TEXT,                  -- which CRM field this was pushed to

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Current state of a deal's qualification
CREATE INDEX idx_deal_insights_current
  ON deal_insights(deal_id, insight_type)
  WHERE is_current = true;

-- Workspace-wide coverage queries
CREATE INDEX idx_deal_insights_workspace
  ON deal_insights(workspace_id, insight_type, is_current)
  WHERE is_current = true;

-- History for a specific insight on a deal
CREATE INDEX idx_deal_insights_history
  ON deal_insights(deal_id, insight_key, extracted_at);

-- Find insights from a specific conversation
CREATE INDEX idx_deal_insights_conversation
  ON deal_insights(source_conversation_id);

-- Trigger to update updated_at
CREATE TRIGGER deal_insights_updated_at
  BEFORE UPDATE ON deal_insights
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE deal_insights IS 'Qualification insights (MEDDPIC/BANT/SPICED) extracted from conversation transcripts via DeepSeek. Append-only with versioning via is_current flag.';
COMMENT ON COLUMN deal_insights.insight_type IS 'Type of insight: champion, economic_buyer, decision_criteria, metrics, pain_point, timeline, competition, budget, authority, need, etc.';
COMMENT ON COLUMN deal_insights.insight_key IS 'Workspace-specific label for display, e.g., "MEDDPIC Champion" or "Technical Requirements"';
COMMENT ON COLUMN deal_insights.value IS 'Extracted insight value, 1-2 sentences with names and specifics from the call';
COMMENT ON COLUMN deal_insights.confidence IS 'DeepSeek extraction confidence, 0.0-1.0. Higher for explicit statements, lower for inferences.';
COMMENT ON COLUMN deal_insights.source_quote IS 'Most relevant 1-2 sentences from transcript supporting this insight, max 500 chars';
COMMENT ON COLUMN deal_insights.superseded_by IS 'If this insight was replaced by a newer extraction, points to the new insight_id';
COMMENT ON COLUMN deal_insights.is_current IS 'True for the latest version of this insight type on this deal. False for historical versions.';
COMMENT ON COLUMN deal_insights.exported_to_crm IS 'True if this insight has been pushed to a CRM custom field (HubSpot/Salesforce)';
