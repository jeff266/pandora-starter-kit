-- Migration 014: ICP Discovery and Lead Scoring Schema
-- Extends deal_contacts and adds account_signals, icp_profiles, lead_scores tables

-- ============================================================================
-- 1. EXTEND deal_contacts TABLE
-- ============================================================================

-- Add enrichment and buying role columns to deal_contacts
ALTER TABLE deal_contacts ADD COLUMN IF NOT EXISTS
  buying_role TEXT;                    -- champion, economic_buyer, decision_maker,
                                      -- technical_evaluator, influencer, coach, blocker, end_user

ALTER TABLE deal_contacts ADD COLUMN IF NOT EXISTS
  role_source TEXT DEFAULT 'crm_contact_role';  -- crm_contact_role, crm_deal_field,
                                                -- title_match, activity_inference, llm_classification

ALTER TABLE deal_contacts ADD COLUMN IF NOT EXISTS
  role_confidence NUMERIC;            -- 0.0-1.0

ALTER TABLE deal_contacts ADD COLUMN IF NOT EXISTS
  enrichment_status TEXT DEFAULT 'pending';  -- pending, enriched, failed, skipped

ALTER TABLE deal_contacts ADD COLUMN IF NOT EXISTS
  enriched_at TIMESTAMPTZ;

ALTER TABLE deal_contacts ADD COLUMN IF NOT EXISTS
  apollo_data JSONB DEFAULT '{}';     -- verified_email, current_title, seniority, department,
                                      -- linkedin_url, company_name, company_size, company_industry

ALTER TABLE deal_contacts ADD COLUMN IF NOT EXISTS
  linkedin_data JSONB DEFAULT '{}';   -- career_history, education, skills, headline

ALTER TABLE deal_contacts ADD COLUMN IF NOT EXISTS
  linkedin_scraped_at TIMESTAMPTZ;

ALTER TABLE deal_contacts ADD COLUMN IF NOT EXISTS
  tenure_months INTEGER;

ALTER TABLE deal_contacts ADD COLUMN IF NOT EXISTS
  career_trajectory TEXT;             -- ascending, lateral, descending, new_to_role

ALTER TABLE deal_contacts ADD COLUMN IF NOT EXISTS
  seniority_verified TEXT;            -- c_level, vp, director, manager, individual_contributor

ALTER TABLE deal_contacts ADD COLUMN IF NOT EXISTS
  department_verified TEXT;

-- Populate buying_role from existing role column where possible
UPDATE deal_contacts
SET buying_role = CASE
  WHEN LOWER(role) LIKE '%decision%' THEN 'decision_maker'
  WHEN LOWER(role) LIKE '%champion%' THEN 'champion'
  WHEN LOWER(role) LIKE '%economic%' OR LOWER(role) LIKE '%budget%' THEN 'economic_buyer'
  WHEN LOWER(role) LIKE '%technical%' OR LOWER(role) LIKE '%evaluat%' THEN 'technical_evaluator'
  WHEN LOWER(role) LIKE '%influenc%' THEN 'influencer'
  WHEN LOWER(role) LIKE '%executive%' OR LOWER(role) LIKE '%sponsor%' THEN 'executive_sponsor'
  WHEN LOWER(role) LIKE '%end user%' OR LOWER(role) LIKE '%user%' THEN 'end_user'
  ELSE role  -- keep original if no match
END
WHERE buying_role IS NULL AND role IS NOT NULL;

-- ============================================================================
-- 2. CREATE account_signals TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS account_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Company enrichment (from Serper/Apollo)
  industry_verified TEXT,
  employee_count INTEGER,
  annual_revenue NUMERIC,
  funding_stage TEXT,
  technologies JSONB DEFAULT '[]',

  -- Signals (from Serper news search)
  recent_news JSONB DEFAULT '[]',
  hiring_signals JSONB DEFAULT '[]',
  expansion_signals JSONB DEFAULT '[]',
  risk_signals JSONB DEFAULT '[]',

  -- Composite
  signal_score NUMERIC,               -- 0-100

  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stale_after TIMESTAMPTZ,             -- scraped_at + 90 days

  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_account_signals_account ON account_signals(account_id);
CREATE INDEX IF NOT EXISTS idx_account_signals_workspace ON account_signals(workspace_id, scraped_at DESC);

-- ============================================================================
-- 3. CREATE icp_profiles TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS icp_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',       -- draft, active, superseded

  -- Model outputs
  personas JSONB NOT NULL DEFAULT '[]',
  buying_committees JSONB NOT NULL DEFAULT '[]',
  company_profile JSONB NOT NULL DEFAULT '{}',

  -- Scoring weights (used by lead scoring)
  scoring_weights JSONB NOT NULL DEFAULT '{}',
  scoring_method TEXT NOT NULL DEFAULT 'point_based',
  model_accuracy NUMERIC,
  model_metadata JSONB DEFAULT '{}',

  -- Training data stats
  deals_analyzed INTEGER,
  won_deals INTEGER,
  lost_deals INTEGER,
  contacts_enriched INTEGER,

  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by TEXT DEFAULT 'icp-discovery',

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_icp_active ON icp_profiles(workspace_id, status)
  WHERE status = 'active';

-- ============================================================================
-- 4. CREATE lead_scores TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS lead_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  entity_type TEXT NOT NULL,                  -- 'contact', 'deal'
  entity_id UUID NOT NULL,

  total_score NUMERIC NOT NULL,               -- 0-100
  score_breakdown JSONB NOT NULL DEFAULT '{}',
  score_grade TEXT,                            -- A, B, C, D, F

  icp_fit_score NUMERIC,                      -- 0-100
  icp_fit_details JSONB DEFAULT '{}',

  icp_profile_id UUID REFERENCES icp_profiles(id) ON DELETE SET NULL,
  scoring_method TEXT NOT NULL,               -- point_based, regression

  scored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  previous_score NUMERIC,
  score_change NUMERIC,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_scores_entity ON lead_scores(workspace_id, entity_type, total_score DESC);
CREATE INDEX IF NOT EXISTS idx_lead_scores_grade ON lead_scores(workspace_id, entity_type, score_grade);

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- After running this migration, verify with:
-- SELECT COUNT(*) FROM deal_contacts WHERE buying_role IS NOT NULL;
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('account_signals', 'icp_profiles', 'lead_scores');
-- SELECT indexname FROM pg_indexes WHERE tablename IN ('account_signals', 'icp_profiles', 'lead_scores');
