-- Migration 182: Sprint planning columns for actions table
-- Enables goal-first sprint view: actions tagged to hypotheses,
-- grouped by week, with expected value and effort metadata.
-- NOTE: Split into individual ALTER TABLE statements to avoid PostgreSQL
-- constraint naming conflicts with multi-column IF NOT EXISTS.

ALTER TABLE actions
  ADD COLUMN IF NOT EXISTS hypothesis_id UUID REFERENCES standing_hypotheses(id) ON DELETE SET NULL;

ALTER TABLE actions
  ADD COLUMN IF NOT EXISTS sprint_week DATE;

ALTER TABLE actions
  ADD COLUMN IF NOT EXISTS expected_value_delta NUMERIC;

ALTER TABLE actions
  ADD COLUMN IF NOT EXISTS effort TEXT CHECK (effort IN ('immediate', 'this_week', 'this_month'));

ALTER TABLE actions
  ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'in_progress', 'executed', 'deferred', 'not_applicable', 'escalated'));

CREATE INDEX IF NOT EXISTS idx_actions_sprint_week
  ON actions(workspace_id, sprint_week)
  WHERE sprint_week IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_actions_hypothesis
  ON actions(hypothesis_id)
  WHERE hypothesis_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_actions_state
  ON actions(workspace_id, state, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_actions_sprint_upsert
  ON actions(workspace_id, title, sprint_week)
  WHERE sprint_week IS NOT NULL;
