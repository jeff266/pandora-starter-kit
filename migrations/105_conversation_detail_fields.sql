-- ============================================================
-- Migration 105: Conversation Detail Fields
-- ============================================================
-- Adds columns for speaker identity resolution, call metrics,
-- CRM follow-through tracking, and deal health impact.
--
-- Depends on: Migration 104 (deal phase inference fields)

-- 1. Resolved participants (speaker identity with role + confidence)
-- This replaces the raw `participants` JSONB with enriched data
-- Both columns coexist: `participants` = raw from source,
-- `resolved_participants` = enriched with internal/external + CRM match
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS resolved_participants JSONB DEFAULT '[]';
  -- Shape: [{
  --   name: string,
  --   email: string | null,
  --   role: 'internal' | 'external' | 'unknown',
  --   confidence: number (0-1),
  --   resolution_method: string,
  --   crm_contact_id: uuid | null,
  --   crm_user_id: uuid | null,
  --   talk_pct: number | null (0-100, computed from sentence timing if available)
  -- }]

COMMENT ON COLUMN conversations.resolved_participants IS
  'Enriched participant list with internal/external classification, CRM matching, and talk percentages';

-- 2. Conversation-level computed metrics (populated at sync or by async job)
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS call_metrics JSONB DEFAULT NULL;
  -- Shape: {
  --   talk_ratio_rep: number | null (0-100),
  --   talk_ratio_buyer: number | null (0-100),
  --   speaker_count_internal: number,
  --   speaker_count_external: number,
  --   question_count: number | null,
  --   longest_monologue_seconds: number | null,
  --   source_of_metrics: 'gong_native' | 'fireflies_derived' | 'unavailable'
  -- }

COMMENT ON COLUMN conversations.call_metrics IS
  'Conversation metrics: talk ratios, speaker counts, question count, monologue length';

-- 3. Post-call CRM follow-through tracking
-- Captures whether the CRM was updated after this conversation
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS post_call_crm_state JSONB DEFAULT NULL;
  -- Shape: {
  --   captured_at: ISO timestamp (when we snapshotted),
  --   deal_stage_at_call: string,
  --   deal_stage_after: string | null (checked 24h+ later),
  --   deal_stage_changed: boolean,
  --   next_step_updated: boolean,
  --   close_date_changed: boolean,
  --   amount_changed: boolean,
  --   activity_logged: boolean,
  --   next_meeting_scheduled: boolean | null
  -- }

COMMENT ON COLUMN conversations.post_call_crm_state IS
  'Tracks CRM updates after conversation: stage changes, activity logging, next meeting scheduling';

-- 4. Conversation-level deal health impact
-- Snapshot of deal health before/after this conversation
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS deal_health_before NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deal_health_after NUMERIC DEFAULT NULL;

COMMENT ON COLUMN conversations.deal_health_before IS
  'Deal health score captured at time of conversation';

COMMENT ON COLUMN conversations.deal_health_after IS
  'Deal health score captured 24h+ after conversation to measure impact';

-- 5. Indexes for the conversation detail page queries
CREATE INDEX IF NOT EXISTS idx_conversations_deal_timeline
  ON conversations (deal_id, call_date DESC)
  WHERE deal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_account_timeline
  ON conversations (account_id, call_date DESC)
  WHERE account_id IS NOT NULL;

-- Index for finding conversations needing participant resolution
CREATE INDEX IF NOT EXISTS idx_conversations_unresolved_participants
  ON conversations (workspace_id, id)
  WHERE resolved_participants = '[]' OR resolved_participants IS NULL;

-- Index for finding conversations needing post-call tracking
CREATE INDEX IF NOT EXISTS idx_conversations_pending_snapshot
  ON conversations (workspace_id, deal_id, call_date)
  WHERE post_call_crm_state IS NULL AND deal_id IS NOT NULL;

-- Index for finding conversations needing follow-through check
CREATE INDEX IF NOT EXISTS idx_conversations_pending_followup
  ON conversations (workspace_id, call_date)
  WHERE post_call_crm_state IS NOT NULL
    AND post_call_crm_state->>'deal_stage_after' IS NULL
    AND call_date < NOW() - INTERVAL '24 hours';
