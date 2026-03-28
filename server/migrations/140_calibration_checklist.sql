-- Migration 140: calibration_checklist Table
-- Stores 100-question calibration bank with confidence state and dependencies
-- Part of Phase 1 of WorkspaceIntelligence architecture

CREATE TABLE IF NOT EXISTS calibration_checklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Question identity
  question_id TEXT NOT NULL,       -- e.g. 'land_motion_field', 'pipeline_active_stages'
  domain TEXT NOT NULL CHECK (domain IN (
    'business', 'metrics', 'taxonomy', 'pipeline', 'segmentation', 'data_quality'
  )),
  question TEXT NOT NULL,          -- human readable

  -- Answer
  answer JSONB,                    -- flexible per question type
  answer_source TEXT CHECK (answer_source IN (
    'TRANSCRIPT', 'DOCUMENT', 'CRM_SCAN', 'FORWARD_DEPLOY', 'CONFIRMATION_LOOP', 'USER'
  )),

  -- Confidence
  status TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (status IN ('CONFIRMED', 'INFERRED', 'UNKNOWN', 'BLOCKED')),
  confidence NUMERIC DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),

  -- Dependencies
  depends_on TEXT[],               -- question_ids that must be answered first
  skill_dependencies TEXT[],       -- skill_ids that require this question answered

  -- Confirmation loop
  pandora_computed_answer JSONB,   -- what Pandora calculated
  human_confirmed BOOLEAN DEFAULT FALSE,
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (workspace_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_calibration_checklist_workspace ON calibration_checklist(workspace_id);
CREATE INDEX IF NOT EXISTS idx_calibration_checklist_domain ON calibration_checklist(workspace_id, domain);
CREATE INDEX IF NOT EXISTS idx_calibration_checklist_status ON calibration_checklist(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_calibration_checklist_skill_deps ON calibration_checklist USING gin(skill_dependencies);

COMMENT ON TABLE calibration_checklist IS 'Calibration question bank with confidence state, dependencies, and confirmation loop workflow';
COMMENT ON COLUMN calibration_checklist.question_id IS 'Unique question identifier (e.g. land_motion_field, pipeline_active_stages)';
COMMENT ON COLUMN calibration_checklist.domain IS 'Domain category: business | metrics | taxonomy | pipeline | segmentation | data_quality';
COMMENT ON COLUMN calibration_checklist.answer IS 'Flexible JSONB answer structure per question type';
COMMENT ON COLUMN calibration_checklist.answer_source IS 'How answer was obtained: TRANSCRIPT | DOCUMENT | CRM_SCAN | FORWARD_DEPLOY | CONFIRMATION_LOOP | USER';
COMMENT ON COLUMN calibration_checklist.status IS 'Confirmation state: CONFIRMED (user validated) | INFERRED (auto-detected) | UNKNOWN | BLOCKED (dependency not met)';
COMMENT ON COLUMN calibration_checklist.confidence IS 'Confidence score 0-1 for inferred answers';
COMMENT ON COLUMN calibration_checklist.depends_on IS 'Array of question_ids that must be answered before this question can be resolved';
COMMENT ON COLUMN calibration_checklist.skill_dependencies IS 'Array of skill_ids that require this question to be CONFIRMED to run in LIVE mode';
COMMENT ON COLUMN calibration_checklist.pandora_computed_answer IS 'Pandora auto-computed answer for confirmation loop';
COMMENT ON COLUMN calibration_checklist.human_confirmed IS 'Whether user confirmed Pandora computed answer matches expectation';
