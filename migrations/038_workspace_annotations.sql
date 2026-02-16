-- Workspace annotations: entity-level knowledge from user interactions
CREATE TABLE IF NOT EXISTS workspace_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  entity_name TEXT,
  annotation_type TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  source_thread_id TEXT,
  source_message_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  references_finding_id UUID,
  references_skill_run_id UUID
);

CREATE INDEX IF NOT EXISTS idx_annotations_entity ON workspace_annotations(workspace_id, entity_type, entity_id)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_annotations_workspace ON workspace_annotations(workspace_id, annotation_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_annotations_expiry ON workspace_annotations(expires_at)
  WHERE expires_at IS NOT NULL AND resolved_at IS NULL;

-- Lightweight feedback signals on responses and findings
CREATE TABLE IF NOT EXISTS feedback_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  signal_metadata JSONB DEFAULT '{}',
  source TEXT NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_workspace ON feedback_signals(workspace_id, signal_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_target ON feedback_signals(target_type, target_id);
