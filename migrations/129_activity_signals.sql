-- Migration 129: activity_signals table
--
-- Stores structured signals extracted from CRM activity body content
-- Mirrors conversation_signals pattern proven by Gong call extraction

CREATE TABLE IF NOT EXISTS activity_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  activity_id UUID NOT NULL,
  deal_id UUID,
  account_id UUID,
  signal_type TEXT NOT NULL,
  -- 'framework_signal' | 'notable_quote' | 'blocker_mention'
  -- | 'buyer_signal' | 'timeline_mention' | 'stakeholder_mention'
  -- | 'untracked_participant'
  signal_value TEXT,
  framework_field TEXT,
  -- MEDDIC: metrics | economic_buyer | decision_criteria
  --         decision_process | identify_pain | champion
  -- BANT:   budget | authority | need | timeline
  -- SPICED: situation | pain | impact | critical_event | decision
  source_quote TEXT,
  speaker_type TEXT,          -- 'prospect' | 'rep' | 'unknown'
  speaker_confidence NUMERIC,
  verbatim BOOLEAN DEFAULT false,
  confidence NUMERIC,
  extraction_method TEXT,     -- 'deepseek' | 'keyword' | 'header_parse'
  model_version TEXT,
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_activity_signals_workspace_deal
  ON activity_signals (workspace_id, deal_id);

CREATE INDEX IF NOT EXISTS idx_activity_signals_workspace_activity
  ON activity_signals (workspace_id, activity_id);

CREATE INDEX IF NOT EXISTS idx_activity_signals_workspace_type
  ON activity_signals (workspace_id, signal_type);

CREATE INDEX IF NOT EXISTS idx_activity_signals_workspace_framework
  ON activity_signals (workspace_id, framework_field);

COMMENT ON TABLE activity_signals IS 'Structured signals extracted from CRM activity body content using DeepSeek LLM';
COMMENT ON COLUMN activity_signals.signal_type IS 'untracked_participant: email addresses in CC/BCC not in CRM';
COMMENT ON COLUMN activity_signals.extraction_method IS 'header_parse: zero-cost email header extraction, deepseek: LLM extraction';
