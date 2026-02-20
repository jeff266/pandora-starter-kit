-- Migration: Add agent lifecycle columns
-- Enables draft → submitted → reviewed → published workflow

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS submitted_for_review_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recoverable_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner_id);

COMMENT ON COLUMN agents.status IS 'draft | submitted | approved | published | archived';
COMMENT ON COLUMN agents.owner_id IS 'User who created/owns this agent (for permission checks)';
COMMENT ON COLUMN agents.recoverable_until IS 'Soft delete recovery window (e.g., 30 days after archived_at)';
