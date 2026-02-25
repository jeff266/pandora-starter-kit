-- Forecast Annotation State Table
-- Tracks user actions (dismiss/snooze) for forecast annotations
-- Annotations themselves are stored in skill_runs.output.annotations
-- This table only persists user lifecycle state

CREATE TABLE IF NOT EXISTS forecast_annotation_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  annotation_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'dismissed', 'snoozed')),
  snoozed_until DATE,
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, annotation_id)
);

CREATE INDEX idx_fas_workspace ON forecast_annotation_state(workspace_id);
CREATE INDEX idx_fas_state ON forecast_annotation_state(workspace_id, state) WHERE state != 'dismissed';
