-- Migration 042: Conversation Signal Columns
-- Adds structured signal extraction columns to the conversations table.
-- Populated by the DeepSeek signal extraction pass after Gong/Fireflies sync.

-- Call classification
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS
  call_disposition TEXT;
  -- 'discovery' | 'demo' | 'proposal_review' | 'negotiation' |
  -- 'technical_deep_dive' | 'check_in' | 'onboarding' | 'escalation' | 'closing' | 'other'

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS
  engagement_quality TEXT;
  -- 'strong' | 'neutral' | 'disengaged'

-- Pricing signals
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS
  pricing_discussed BOOLEAN DEFAULT FALSE;

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS
  pricing_signals JSONB DEFAULT '[]';
  -- [{type: 'objection'|'question'|'comparison'|'approval',
  --   summary: '...', speaker_role: 'prospect'|'rep'}]

-- Product/feature signals
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS
  products_mentioned JSONB DEFAULT '[]';
  -- [{product: '...', feature: '...'|null, context: '...'}]

-- Next steps and commitments
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS
  next_steps JSONB DEFAULT '[]';
  -- [{action: '...', owner: 'rep'|'prospect'|'unknown',
  --   deadline: 'YYYY-MM-DD'|null, status: 'committed'|'tentative'}]

-- Budget signals
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS
  budget_signals JSONB DEFAULT '{}';
  -- {mentioned: bool, range_low: int|null, range_high: int|null,
  --  confidence: 'stated'|'inferred'|'none', context: '...'}

-- Decision maker signals
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS
  decision_makers_mentioned JSONB DEFAULT '[]';
  -- [{title: '...', name: '...'|null, context: '...', involvement: 'blocker'|'champion'|'influencer'|'evaluator'}]

-- Timeline/urgency signals
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS
  timeline_signals JSONB DEFAULT '{}';
  -- {urgency: 'high'|'medium'|'low'|'none', target_date: '...'|null,
  --  driver: '...'|null, context: '...'|null}

-- Competitive context
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS
  competitive_context JSONB DEFAULT '{}';
  -- {evaluating_others: bool, competitors_named: ['...'],
  --  our_position: 'preferred'|'shortlisted'|'behind'|'unknown', context: '...'|null}

-- Risk signals
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS
  risk_signals JSONB DEFAULT '[]';
  -- [{type: 'champion_leaving'|'budget_cut'|'priority_shift'|'competitor_preferred'|
  --         'stalling'|'org_change'|'technical_blocker',
  --   summary: '...', severity: 'high'|'medium'|'low'}]

-- Extraction metadata
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS
  signals_extracted_at TIMESTAMPTZ;

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS
  signals_extraction_version TEXT;

-- Index for efficiently finding un-extracted conversations
CREATE INDEX IF NOT EXISTS idx_conversations_unextracted
  ON conversations (workspace_id)
  WHERE signals_extracted_at IS NULL
    AND (summary IS NOT NULL OR transcript_text IS NOT NULL);

-- Index for signal queries (pricing_discussed, competitive)
CREATE INDEX IF NOT EXISTS idx_conversations_pricing
  ON conversations (workspace_id)
  WHERE pricing_discussed = TRUE;
