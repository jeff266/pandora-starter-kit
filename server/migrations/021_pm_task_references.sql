-- PM Task References
-- Tracks PM tool tasks created by Pandora skills for RevOps operators

CREATE TABLE IF NOT EXISTS pm_task_references (
  id SERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_action_id TEXT NOT NULL,
  connector_type TEXT NOT NULL, -- 'monday', 'asana', 'linear', 'jira', 'clickup'
  external_id TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP,
  UNIQUE(workspace_id, source_action_id)
);

CREATE INDEX IF NOT EXISTS idx_pm_task_references_workspace
  ON pm_task_references(workspace_id);

CREATE INDEX IF NOT EXISTS idx_pm_task_references_source_action
  ON pm_task_references(source_action_id);

CREATE INDEX IF NOT EXISTS idx_pm_task_references_connector
  ON pm_task_references(connector_type);

COMMENT ON TABLE pm_task_references IS
  'Tracks tasks created in PM tools (Monday, Asana, Linear, Jira, ClickUp) by Pandora skills';

COMMENT ON COLUMN pm_task_references.source_action_id IS
  'Unique identifier for the skill action that generated this task (e.g., dq_{runId}_{field})';

COMMENT ON COLUMN pm_task_references.external_id IS
  'Task ID in the external PM tool (e.g., Monday item ID)';

COMMENT ON COLUMN pm_task_references.url IS
  'Direct URL to view the task in the PM tool';
