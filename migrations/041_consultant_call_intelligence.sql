-- ============================================
-- Migration 041: Consultant Call Intelligence
-- Adds user-scoped consultant connectors and call distribution tracking
-- ============================================

-- ============================================
-- Consultant Connectors (user-scoped, not workspace-scoped)
-- ============================================

CREATE TABLE IF NOT EXISTS consultant_connectors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  source TEXT NOT NULL,                     -- 'fireflies' | 'gong' | 'otter'
  status TEXT NOT NULL DEFAULT 'connected', -- 'connected' | 'disconnected' | 'error'
  credentials JSONB NOT NULL DEFAULT '{}',
  last_synced_at TIMESTAMPTZ,
  sync_config JSONB DEFAULT '{}',           -- { sync_interval_hours: 6 }
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, source)                   -- one connector per source per user
);

-- ============================================
-- Allow conversations without a workspace (in transit)
-- ============================================

-- Drop the NOT NULL constraint on workspace_id so consultant calls can be staged
-- without an assigned workspace. The existing UNIQUE(workspace_id, source, source_id)
-- constraint still works: NULLs are distinct in PostgreSQL unique constraints.
ALTER TABLE conversations ALTER COLUMN workspace_id DROP NOT NULL;

-- Add source_type to distinguish consultant calls from workspace calls
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'customer';
-- Values: 'customer' (default, from workspace connector), 'consultant' (from consultant connector)

-- Add title column if not present (Fireflies transcripts have titles)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS title TEXT;

-- Partial unique index for deduplication of unassigned consultant calls
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_unassigned_source
  ON conversations (source, source_id)
  WHERE workspace_id IS NULL;

-- Index for finding consultant calls in a workspace
CREATE INDEX IF NOT EXISTS idx_conversations_consultant
  ON conversations (workspace_id, source_type)
  WHERE source_type = 'consultant';

-- ============================================
-- Call Assignment Tracking (distribution ledger)
-- ============================================

CREATE TABLE IF NOT EXISTS consultant_call_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  consultant_connector_id UUID NOT NULL REFERENCES consultant_connectors(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id),  -- NULL = unassigned
  assignment_method TEXT,                        -- 'email_match' | 'calendar_match' | 'transcript_scan' | 'manual'
  assignment_confidence REAL,                    -- 0.0 to 1.0
  assigned_at TIMESTAMPTZ,
  assigned_by TEXT,                              -- 'auto' | user email
  skipped BOOLEAN DEFAULT FALSE,                 -- true = explicitly marked irrelevant
  skip_reason TEXT,                               -- 'internal' | 'personal' | 'irrelevant'
  candidate_workspaces JSONB DEFAULT '[]',        -- [{workspace_id, score, method}]
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(conversation_id)                         -- one assignment per conversation
);

CREATE INDEX IF NOT EXISTS idx_consultant_calls_unassigned
  ON consultant_call_assignments (consultant_connector_id)
  WHERE workspace_id IS NULL AND skipped = FALSE;

CREATE INDEX IF NOT EXISTS idx_consultant_calls_workspace
  ON consultant_call_assignments (workspace_id)
  WHERE workspace_id IS NOT NULL;
