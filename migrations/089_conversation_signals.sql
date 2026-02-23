-- Migration: Conversation Signals Classification Layer
-- Purpose: Store structured signals extracted from sales calls
-- Used by: Ask Pandora, deal/account dossiers, Command Center engagement flags

-- Table: conversation_signals
-- Stores individual signals extracted from each conversation
CREATE TABLE IF NOT EXISTS conversation_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,

  -- Signal classification
  signal_type TEXT NOT NULL CHECK (signal_type IN (
    'competitor_mention',   -- a competitor was named
    'pricing_discussed',    -- pricing or cost raised
    'objection',            -- an objection was surfaced
    'buying_signal',        -- positive purchase intent language
    'next_steps',           -- explicit next steps agreed
    'risk_flag',            -- stall, disengagement, concern expressed
    'champion_signal',      -- internal advocacy language
    'decision_criteria',    -- buyer articulated eval criteria
    'timeline_mentioned',   -- specific timeline or deadline stated
    'budget_mentioned'      -- budget range or approval process raised
  )),
  signal_value TEXT NOT NULL,       -- The extracted value: "Gong", "pricing too high", etc.
  confidence NUMERIC NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
  source_quote TEXT,                 -- Supporting quote from transcript (max 300 chars)
  sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative')),

  -- Context
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  rep_email TEXT,                    -- Who was the rep on this call

  -- Processing metadata
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  extraction_method TEXT NOT NULL DEFAULT 'deepseek',  -- 'deepseek' | 'rule_based' | 'manual'
  model_version TEXT,                -- Track which DeepSeek version ran this

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for conversation_signals
CREATE INDEX idx_conv_signals_workspace
  ON conversation_signals(workspace_id, signal_type, extracted_at DESC);

CREATE INDEX idx_conv_signals_conversation
  ON conversation_signals(conversation_id);

CREATE INDEX idx_conv_signals_deal
  ON conversation_signals(deal_id, signal_type)
  WHERE deal_id IS NOT NULL;

CREATE INDEX idx_conv_signals_account
  ON conversation_signals(account_id, signal_type)
  WHERE account_id IS NOT NULL;

CREATE INDEX idx_conv_signals_type_value
  ON conversation_signals(workspace_id, signal_type, signal_value);

-- Table: conversation_signal_runs
-- Tracks which conversations have been processed for idempotent extraction
CREATE TABLE IF NOT EXISTS conversation_signal_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('success', 'skipped', 'error')),
  skip_reason TEXT,                  -- 'no_transcript' | 'too_short' | 'internal'
  signals_extracted INTEGER DEFAULT 0,
  tokens_used INTEGER,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(conversation_id)             -- one run record per conversation
);

CREATE INDEX idx_signal_runs_workspace
  ON conversation_signal_runs(workspace_id, status, processed_at DESC);

-- Comments
COMMENT ON TABLE conversation_signals IS 'Structured signals extracted from sales calls - competitor mentions, objections, buying signals, risk flags';
COMMENT ON COLUMN conversation_signals.signal_type IS 'Type of signal extracted - competitor_mention, pricing_discussed, objection, buying_signal, next_steps, risk_flag, champion_signal, decision_criteria, timeline_mentioned, budget_mentioned';
COMMENT ON COLUMN conversation_signals.signal_value IS 'The extracted value - competitor name, objection topic, timeline stated, etc.';
COMMENT ON COLUMN conversation_signals.confidence IS 'Confidence score 0.0-1.0 from classification model';
COMMENT ON COLUMN conversation_signals.source_quote IS 'Supporting quote from transcript (max 300 chars)';
COMMENT ON COLUMN conversation_signals.extraction_method IS 'Method used for extraction - deepseek, rule_based, manual';

COMMENT ON TABLE conversation_signal_runs IS 'Tracks which conversations have been processed for signal extraction - ensures idempotent processing';
COMMENT ON COLUMN conversation_signal_runs.skip_reason IS 'Reason for skipping - no_transcript, too_short, internal';
