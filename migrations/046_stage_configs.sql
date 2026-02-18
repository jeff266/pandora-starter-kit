-- 046_stage_configs.sql
-- Stores per-workspace CRM stage display order for the Pipeline by Stage chart.
-- Populated by HubSpot sync (displayOrder) and Salesforce sync (SortOrder).
-- Stages not in this table are appended after mapped stages (NULLS LAST).

CREATE TABLE IF NOT EXISTS stage_configs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pipeline_name  TEXT,
  stage_name     TEXT        NOT NULL,
  display_order  INT         NOT NULL DEFAULT 999,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, stage_name)
);

CREATE INDEX IF NOT EXISTS idx_stage_configs_workspace
  ON stage_configs(workspace_id);

CREATE INDEX IF NOT EXISTS idx_stage_configs_order
  ON stage_configs(workspace_id, display_order ASC);
