-- Migration 179: standing_hypotheses + intervention_log
-- Enables the GTM Intelligence Loop: failure mode tracking, threshold monitoring,
-- and intervention attribution over time.

-- Table: standing_hypotheses
-- One row per hypothesis derived from pre-mortem, stack trace, or Concierge recommendation.
-- Monitored weekly by the Monday briefing; alerts when current_value crosses alert_threshold.
CREATE TABLE IF NOT EXISTS standing_hypotheses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL CHECK (source IN ('pre_mortem', 'stack_trace', 'user_confirmed', 'concierge_recommendation')),
  hypothesis TEXT NOT NULL,
  metric TEXT NOT NULL,
  current_value NUMERIC,
  alert_threshold NUMERIC NOT NULL,
  alert_direction TEXT NOT NULL CHECK (alert_direction IN ('below', 'above')),
  review_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'refuted', 'expired')),
  linked_intervention_id UUID,
  weekly_values JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_standing_hypotheses_workspace
  ON standing_hypotheses(workspace_id, status, review_date);

CREATE INDEX IF NOT EXISTS idx_standing_hypotheses_source
  ON standing_hypotheses(workspace_id, source, created_at DESC);

-- Table: intervention_log
-- Timestamps GTM changes captured via crumb trail (Concierge affirmations),
-- document ingestion, or auto-detected CRM structural changes.
CREATE TABLE IF NOT EXISTS intervention_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL CHECK (source IN ('crm_structural', 'user_confirmed', 'document_ingestion', 'concierge_recommendation')),
  intervention_type TEXT NOT NULL,
  description TEXT NOT NULL,
  effective_date DATE NOT NULL,
  linked_hypothesis_id UUID REFERENCES standing_hypotheses(id) ON DELETE SET NULL,
  metrics_before JSONB,
  metrics_after JSONB,
  status TEXT NOT NULL DEFAULT 'monitoring' CHECK (status IN ('monitoring', 'attributed', 'inconclusive', 'expired')),
  review_at DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intervention_log_workspace
  ON intervention_log(workspace_id, status, effective_date DESC);

CREATE INDEX IF NOT EXISTS idx_intervention_log_hypothesis
  ON intervention_log(linked_hypothesis_id)
  WHERE linked_hypothesis_id IS NOT NULL;

-- Add FK from standing_hypotheses → intervention_log now that intervention_log exists
ALTER TABLE standing_hypotheses
  ADD CONSTRAINT fk_standing_hypotheses_intervention
  FOREIGN KEY (linked_intervention_id)
  REFERENCES intervention_log(id)
  ON DELETE SET NULL;
