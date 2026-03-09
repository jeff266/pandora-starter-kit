-- Migration 135: conversation_enrichments table
-- One row per conversation per enrichment version.
-- Written by the weekly Sunday enrichment job; read by all skills
-- that previously touched conversations.transcript_text directly.

CREATE TABLE IF NOT EXISTS conversation_enrichments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  enriched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  enrichment_version INT NOT NULL DEFAULT 1,

  -- ── CALL QUALITY ─── Deal Hygiene, Rep Scorecard, Coaching ────────────
  is_substantive BOOLEAN,
  customer_talk_pct NUMERIC(5,2),
  rep_talk_pct NUMERIC(5,2),
  longest_rep_monologue_seconds INT,
  questions_asked_by_rep INT,
  call_energy TEXT CHECK (call_energy IN ('high','medium','low')),
  next_steps_agreed BOOLEAN,
  action_items_count INT,
  action_items JSONB DEFAULT '[]',

  -- ── BUYER SIGNALS ─── Winning Path, Stage Progression, ICP ───────────
  buyer_signals JSONB DEFAULT '[]',
  buyer_verbalized_use_case BOOLEAN,
  buyer_verbalized_success_metric BOOLEAN,
  decision_criteria_discussed BOOLEAN,
  technical_depth TEXT CHECK (technical_depth IN ('none','surface','deep')),
  executive_present BOOLEAN,
  champion_language BOOLEAN,
  buyer_asked_about_pricing BOOLEAN,
  buyer_referenced_internal_discussions BOOLEAN,

  -- ── COMPETITION ─── Competition skill, Monte Carlo ────────────────────
  competitor_mentions JSONB DEFAULT '[]',
  competitor_count INT DEFAULT 0,
  competitive_intensity TEXT CHECK (
    competitive_intensity IN ('none','light','heavy')),
  pricing_discussed BOOLEAN,
  alternatives_mentioned BOOLEAN,

  -- ── OBJECTIONS ─── Objection Tracker, Deal Hygiene, Coaching ─────────
  objections_raised JSONB DEFAULT '[]',
  objection_count INT DEFAULT 0,
  unresolved_objection_count INT DEFAULT 0,
  blocking_objection_present BOOLEAN,

  -- ── SENTIMENT ─── Lead Scoring, Monte Carlo, Relationship Health ──────
  sentiment TEXT CHECK (sentiment IN ('positive','neutral','negative')),
  sentiment_vs_prior TEXT CHECK (
    sentiment_vs_prior IN ('improving','stable','declining')),
  buyer_engagement_quality TEXT CHECK (
    buyer_engagement_quality IN ('high','medium','low')),

  -- ── RELATIONSHIP ─── Relationship Health, Winning Path ───────────────
  champion_present BOOLEAN,
  champion_email TEXT,
  new_stakeholder_introduced BOOLEAN,
  executive_sponsor_language BOOLEAN,
  stakeholder_count_on_call INT,

  -- ── METHODOLOGY ─── Coaching, Rep Scorecard ───────────────────────────
  -- Only populated if workspace has methodology configured
  methodology_framework TEXT,
  methodology_coverage JSONB DEFAULT '[]',
  -- [{dimension_id, dimension_label, covered: boolean,
  --   confidence: 'high'|'medium'|'low', evidence_phrases: [string]}]
  methodology_score NUMERIC(5,2),
  methodology_gaps JSONB DEFAULT '[]',
  -- [{dimension_id, dimension_label, gap_description}]

  -- ── STAGE CONTEXT ─── Stage Progression (written by reconciliation) ───
  stage_name TEXT,
  stage_entered_at TIMESTAMPTZ,
  transition_type TEXT CHECK (
    transition_type IN ('progressor','staller','pending')),
  days_into_stage_at_call INT,

  -- ── META ──────────────────────────────────────────────────────────────
  deepseek_model_used TEXT,
  enrichment_duration_ms INT,
  transcript_chars_processed INT,
  confidence_overall TEXT CHECK (
    confidence_overall IN ('high','medium','low')),
  gong_native_metrics JSONB,
  -- {talk_ratio, interactivity, question_count, longest_monologue_seconds}

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(conversation_id, enrichment_version)
);

-- Optimized for per-skill query patterns
CREATE INDEX IF NOT EXISTS idx_ce_workspace_deal
  ON conversation_enrichments(workspace_id, deal_id);
CREATE INDEX IF NOT EXISTS idx_ce_stage_transition
  ON conversation_enrichments(workspace_id, stage_name, transition_type)
  WHERE transition_type IN ('progressor','staller');
CREATE INDEX IF NOT EXISTS idx_ce_competitor
  ON conversation_enrichments(workspace_id, competitor_count)
  WHERE competitor_count > 0;
CREATE INDEX IF NOT EXISTS idx_ce_champion
  ON conversation_enrichments(workspace_id, champion_language)
  WHERE champion_language = true;
CREATE INDEX IF NOT EXISTS idx_ce_blocking_objection
  ON conversation_enrichments(workspace_id, blocking_objection_present)
  WHERE blocking_objection_present = true;
CREATE INDEX IF NOT EXISTS idx_ce_methodology
  ON conversation_enrichments(workspace_id, methodology_framework)
  WHERE methodology_framework IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ce_enriched_at
  ON conversation_enrichments(workspace_id, enriched_at DESC);
