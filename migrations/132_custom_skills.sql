-- Migration 132: Custom Skills
--
-- Adds support for user-created skills via the Skill Builder no-code wizard.
-- Custom skills can use saved queries or inline SQL as their data source,
-- with optional AI classification (DeepSeek) and narrative synthesis (Claude).

CREATE TABLE IF NOT EXISTS custom_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Identity
  skill_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'custom',
  version TEXT NOT NULL DEFAULT '1.0.0',

  -- Data layer
  query_source TEXT NOT NULL CHECK (query_source IN ('saved_query', 'inline_sql')),
  saved_query_id UUID,
  saved_query_name TEXT,
  inline_sql TEXT,

  -- Intelligence config
  classify_enabled BOOLEAN NOT NULL DEFAULT true,
  classify_bad TEXT,
  classify_good TEXT,
  synthesize_enabled BOOLEAN NOT NULL DEFAULT true,
  synthesize_tone TEXT DEFAULT 'Flag risks',
  synthesize_custom_prompt TEXT,

  -- Output / schedule
  output_slack BOOLEAN NOT NULL DEFAULT true,
  output_report BOOLEAN NOT NULL DEFAULT false,
  schedule_cron TEXT,

  -- Runtime state
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_run_at TIMESTAMPTZ,
  run_count INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(workspace_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_custom_skills_workspace ON custom_skills(workspace_id, status);
