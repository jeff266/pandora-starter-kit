-- Migration: Agent Lifecycle
-- Add lifecycle management columns to agents table

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS submitted_for_review_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recoverable_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_agents_status
  ON agents(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_agents_recovery
  ON agents(recoverable_until)
  WHERE status = 'archived';

COMMENT ON COLUMN agents.status IS 'Agent lifecycle status: draft | pending_review | published | archived';
COMMENT ON COLUMN agents.owner_id IS 'User who created/owns this agent';
COMMENT ON COLUMN agents.recoverable_until IS 'Recovery deadline (archived_at + 90 days), after which agent is permanently deleted';
