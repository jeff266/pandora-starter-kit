-- Add workspace_config JSONB column to workspaces table.
-- This column stores calibration interview state,
-- stage mappings, and other workspace-level configuration.
-- Required by: calibration-interview.ts, stage-mapping-interview.ts,
-- data-dictionary.ts, and the calibration orchestrator routing.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS workspace_config
  JSONB NOT NULL DEFAULT '{}';

-- Index for JSONB queries on calibration state
CREATE INDEX IF NOT EXISTS idx_workspaces_config_calibration
  ON workspaces USING GIN (
    (workspace_config -> 'calibration')
  );

COMMENT ON COLUMN workspaces.workspace_config IS
  'Workspace-level configuration including calibration
   interview state, stage mappings, and filter definitions.
   Structure: { calibration: { status, stage_mappings,
   interview_state, sections_calibrated } }';
