CREATE TABLE IF NOT EXISTS skill_schedules (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id VARCHAR(36) NOT NULL,
  skill_id VARCHAR(100) NOT NULL,
  cron VARCHAR(100),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_skill_schedules_workspace ON skill_schedules(workspace_id);
