-- Migration 136: Hypothesis Drafts Table
-- Add review workflow for auto-generated hypotheses

CREATE TABLE IF NOT EXISTS hypothesis_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Same fields as standing_hypotheses
  hypothesis_text TEXT NOT NULL,
  metric TEXT NOT NULL,
  metric_key TEXT,
  current_value NUMERIC,
  alert_threshold NUMERIC,
  alert_direction TEXT DEFAULT 'below',
  unit TEXT NOT NULL DEFAULT '$',

  -- Draft metadata
  source TEXT NOT NULL DEFAULT 'auto_generated',
  -- 'auto_generated' | 'user_created' | 'suggested'

  source_skill_run_id UUID,  -- which skill run suggested this
  review_notes TEXT,          -- reviewer comments
  status TEXT NOT NULL DEFAULT 'pending_review',
  -- 'pending_review' | 'approved' | 'rejected'

  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID,
  promoted_to_hypothesis_id UUID REFERENCES standing_hypotheses(id)
);

CREATE INDEX IF NOT EXISTS idx_hypothesis_drafts_workspace
  ON hypothesis_drafts(workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_hypothesis_drafts_pending
  ON hypothesis_drafts(workspace_id)
  WHERE status = 'pending_review';

COMMENT ON TABLE hypothesis_drafts IS 'Review queue for auto-generated hypotheses before promotion to standing_hypotheses';
COMMENT ON COLUMN hypothesis_drafts.source IS 'How this hypothesis was created: auto_generated | user_created | suggested';
COMMENT ON COLUMN hypothesis_drafts.status IS 'Review status: pending_review | approved | rejected';
COMMENT ON COLUMN hypothesis_drafts.promoted_to_hypothesis_id IS 'If approved, the standing_hypotheses.id it was promoted to';
