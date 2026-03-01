CREATE TABLE IF NOT EXISTS weekly_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  brief_type TEXT NOT NULL DEFAULT 'monday_setup'
    CHECK (brief_type IN ('monday_setup', 'pulse', 'friday_recap', 'quarter_close')),

  generated_date DATE NOT NULL DEFAULT CURRENT_DATE,

  period_start DATE,
  period_end DATE,

  days_in_quarter INT,
  days_remaining INT,

  the_number JSONB NOT NULL DEFAULT '{}',
  what_changed JSONB NOT NULL DEFAULT '{}',
  segments JSONB NOT NULL DEFAULT '{}',
  reps JSONB NOT NULL DEFAULT '[]',
  deals_to_watch JSONB NOT NULL DEFAULT '[]',

  ai_blurbs JSONB NOT NULL DEFAULT '{}',

  editorial_focus JSONB NOT NULL DEFAULT '{}',

  section_refreshed_at JSONB NOT NULL DEFAULT '{}',

  status TEXT NOT NULL DEFAULT 'assembling'
    CHECK (status IN ('assembling', 'ready', 'sent', 'edited', 'failed')),
  error_message TEXT,

  sent_to JSONB NOT NULL DEFAULT '[]',
  edited_sections JSONB NOT NULL DEFAULT '{}',
  edited_by TEXT,
  edited_at TIMESTAMPTZ,

  assembly_duration_ms INT,
  ai_tokens_used INT,
  skill_runs_used UUID[],

  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_briefs_workspace_date
  ON weekly_briefs(workspace_id, generated_date);

CREATE INDEX IF NOT EXISTS idx_weekly_briefs_workspace_generated
  ON weekly_briefs(workspace_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_weekly_briefs_status
  ON weekly_briefs(workspace_id, status) WHERE status = 'ready';
