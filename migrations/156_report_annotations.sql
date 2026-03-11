-- Migration 156: Report Annotation fields for V2 review mode
-- Adds version tracking, human annotation storage, and parent-child generation linking

ALTER TABLE report_generations
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS parent_generation_id UUID REFERENCES report_generations(id),
  ADD COLUMN IF NOT EXISTS human_annotations JSONB,
  ADD COLUMN IF NOT EXISTS annotated_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS annotated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_rg_parent_generation
  ON report_generations(parent_generation_id)
  WHERE parent_generation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rg_version
  ON report_generations(workspace_id, version);

COMMENT ON COLUMN report_generations.version IS '1 = AI original, 2+ = human-edited V2/V3';
COMMENT ON COLUMN report_generations.parent_generation_id IS 'Links a V2 annotation back to its original V1 generation';
COMMENT ON COLUMN report_generations.human_annotations IS 'Array of annotation objects: { block_id, type: strike|override|note, original_value, new_value, annotated_by, annotated_at }';
COMMENT ON COLUMN report_generations.annotated_by IS 'User who saved the annotated version';
COMMENT ON COLUMN report_generations.annotated_at IS 'When the annotated version was saved';
