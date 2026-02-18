-- Per-workspace skill schedule overrides
-- Allows enabling/disabling skills and overriding cron expressions per workspace
CREATE TABLE IF NOT EXISTS skill_schedules (
  workspace_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  cron TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, skill_id)
);
