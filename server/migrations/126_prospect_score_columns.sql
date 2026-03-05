-- Migration 126: Extend lead_scores with Prospect Score component columns
-- Part of Prospect Score Consolidation Step 2: Schema Extension

-- Component scores (0-100 per pillar)
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS fit_score INTEGER;
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS engagement_score_component INTEGER;
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS intent_score INTEGER;
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS timing_score INTEGER;

-- Show-your-math fields
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS score_factors JSONB;
  -- Array of factor objects, each with:
  -- { field, label, value, contribution, maxPossible, direction,
  --   category, benchmark: { populationAvg, percentile, wonDealAvg },
  --   explanation }

ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS score_summary TEXT;
  -- Human-readable one-liner, < 280 chars
  -- Example: "Strong ICP fit (VP Ops at 180-person SaaS),
  --   3 meetings this month, no deal association yet."

-- Segment fields (for recursive tree, Tier 4)
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS segment_id TEXT;
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS segment_label TEXT;
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS segment_benchmarks JSONB;
  -- { meetingRate, conversionRate, winRate, avgDealSize, avgSalesCycle }

-- Action fields
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS recommended_action TEXT;
  -- 'prospect' | 'reengage' | 'multi_thread' | 'nurture' | 'disqualify'
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS top_positive_factor TEXT;
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS top_negative_factor TEXT;

-- Scoring metadata
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS score_confidence NUMERIC(3,2);
  -- 0.00-1.00, based on data completeness + model accuracy
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS source_object TEXT;
  -- 'lead' | 'contact' | 'deal' — which CRM object this came from

-- Weight redistribution tracking
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS available_pillars TEXT[];
  -- Which of the 4 pillars had data: ['fit','engagement','intent','timing']
ALTER TABLE lead_scores ADD COLUMN IF NOT EXISTS effective_weights JSONB;
  -- The actual weights used after redistribution:
  -- { fit: 0.39, engagement: 0.33, intent: 0.28, timing: 0 }

-- Index for segment queries
CREATE INDEX IF NOT EXISTS idx_lead_scores_segment
  ON lead_scores(workspace_id, segment_id)
  WHERE segment_id IS NOT NULL;

-- Index for action recommendations
CREATE INDEX IF NOT EXISTS idx_lead_scores_action
  ON lead_scores(workspace_id, recommended_action)
  WHERE recommended_action IS NOT NULL;

-- Index for component score queries
CREATE INDEX IF NOT EXISTS idx_lead_scores_components
  ON lead_scores(workspace_id, entity_type, fit_score, engagement_score_component, intent_score, timing_score)
  WHERE fit_score IS NOT NULL;
