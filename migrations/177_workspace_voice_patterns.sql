-- Migration 177: Workspace Voice Patterns
-- Stores extracted language patterns from internal calls and static voice config
-- per workspace. One row per workspace (UNIQUE constraint on workspace_id).

CREATE TABLE workspace_voice_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL
    REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Extracted language patterns
  risk_phrases TEXT[] DEFAULT '{}',
  urgency_phrases TEXT[] DEFAULT '{}',
  win_phrases TEXT[] DEFAULT '{}',
  pipeline_vocabulary TEXT[] DEFAULT '{}',
  common_shorthand JSONB DEFAULT '{}',

  -- Coverage metadata
  calls_analyzed INTEGER DEFAULT 0,
  internal_calls_found INTEGER DEFAULT 0,
  analysis_window_days INTEGER DEFAULT 90,

  -- Voice config (Level 1 — static settings)
  tone TEXT DEFAULT 'direct'
    CHECK (tone IN ('direct', 'consultative', 'coaching')),
  detail_level TEXT DEFAULT 'operational'
    CHECK (detail_level IN ('executive', 'operational', 'detailed')),
  framing_style TEXT DEFAULT 'number_first'
    CHECK (framing_style IN ('number_first', 'narrative_first', 'risk_first')),
  sales_motion TEXT DEFAULT 'mixed'
    CHECK (sales_motion IN ('high_velocity', 'enterprise', 'mixed')),
  coverage_target NUMERIC DEFAULT 3.0,

  -- Lifecycle
  extraction_status TEXT DEFAULT 'pending'
    CHECK (extraction_status IN ('pending', 'running', 'complete', 'insufficient_data')),
  last_extracted_at TIMESTAMPTZ,
  next_extraction_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(workspace_id)
);

CREATE INDEX idx_voice_patterns_workspace
  ON workspace_voice_patterns(workspace_id);

-- Seed a default row for every existing workspace
INSERT INTO workspace_voice_patterns (workspace_id)
SELECT id FROM workspaces
ON CONFLICT (workspace_id) DO NOTHING;
