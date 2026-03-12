-- Migration 167: Add approval tracking columns to actions table
-- Required by action-approver.ts for HITL approval workflow

ALTER TABLE actions ADD COLUMN IF NOT EXISTS approval_status TEXT CHECK (
  approval_status IN ('pending', 'approved', 'rejected', 'blocked', 'failed')
);

ALTER TABLE actions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE actions ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);
ALTER TABLE actions ADD COLUMN IF NOT EXISTS block_reason TEXT;

-- Index for efficient lookup of pending approvals per workspace
CREATE INDEX IF NOT EXISTS idx_actions_approval_status
  ON actions (workspace_id, approval_status)
  WHERE approval_status = 'pending';
