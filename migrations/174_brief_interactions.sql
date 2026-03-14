-- Brief interaction instrumentation table
-- Captures behavioral signals from every Concierge session:
-- what the brief surfaced vs. what the user actually engaged with.
-- Foundation for the learning loop that improves brief quality over time.

CREATE TABLE IF NOT EXISTS brief_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL
    REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  session_id UUID NOT NULL,

  -- Context at time of brief generation
  pandora_role TEXT,
  quarter_phase TEXT,        -- 'early'|'mid'|'late'|'final_week'
  attainment_pct NUMERIC,
  days_remaining INTEGER,

  -- What the brief surfaced (top 3 finding IDs in rank order)
  findings_shown JSONB,      -- [{id, skill_id, deal_id, amount, rank}]
  big_deals_shown JSONB,     -- [{id, deal_name, amount, rfm_grade, days_cold}]

  -- What the user did
  cards_drilled_into JSONB,  -- finding IDs the user clicked
  math_modals_opened JSONB,  -- math keys opened
  actions_approved JSONB,    -- action IDs approved
  actions_ignored JSONB,     -- action IDs seen but skipped
  follow_up_questions JSONB, -- text of Ask Pandora questions after brief
  time_on_brief_seconds INTEGER,
  returned_within_hour BOOLEAN DEFAULT false,

  -- Implicit quality signal
  -- true = user engaged with what brief surfaced
  -- false = user ignored brief and asked about something else
  brief_was_relevant BOOLEAN,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brief_interactions_workspace
  ON brief_interactions(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_brief_interactions_user
  ON brief_interactions(user_id, created_at DESC);
