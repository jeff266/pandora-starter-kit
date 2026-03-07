CREATE TABLE slack_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  source_action_id UUID,
  source_skill_id TEXT,
  recipient_slack_id TEXT,
  recipient_name TEXT,
  draft_message TEXT NOT NULL,
  edited_message TEXT,
  context JSONB,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'approved'|'sent'|'dismissed'
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  dismiss_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON slack_drafts(workspace_id, status);
CREATE INDEX ON slack_drafts(source_action_id);
