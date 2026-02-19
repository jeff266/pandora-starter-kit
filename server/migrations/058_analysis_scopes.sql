-- Migration 058: Create analysis_scopes table + seed default scope
-- Stores named deal segments (New Business, Renewals, Expansion) per workspace.
-- Each row defines a filter that maps to a subset of the normalized deals table.
-- scope_id = 'default' is the system fallback — all deals, no filter.

CREATE TABLE IF NOT EXISTS analysis_scopes (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scope_id                  TEXT        NOT NULL,
  name                      TEXT        NOT NULL,

  -- filter_field = '1=1' and filter_values = '{}' means "match all deals" (default scope)
  -- filter_field = 'pipeline_id'                   means deals.pipeline_id IN filter_values
  -- filter_field = "custom_fields->>'record_type_name'"  means JSONB path match
  filter_field              TEXT        NOT NULL DEFAULT '1=1',
  filter_operator           TEXT        NOT NULL DEFAULT 'in',
  filter_values             TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- Ordered stage sequence for this scope (overrides workspace default if set)
  stage_sequence            TEXT[]      DEFAULT ARRAY[]::TEXT[],

  -- Per-scope field overrides: { "owner_field": "custom_owner", "_source": "hubspot_pipeline" }
  field_overrides           JSONB       NOT NULL DEFAULT '{}',

  -- If false, this scope is excluded from skill fan-out entirely
  included_in_default_scope BOOLEAN     NOT NULL DEFAULT true,

  -- confirmed = true means the workspace owner has verified this scope is correct
  -- Scopes are never auto-confirmed — that is always a user action
  confirmed                 BOOLEAN     NOT NULL DEFAULT false,

  -- confidence from the inference engine: 1.0 = HubSpot pipeline, 0.95 = SF record type,
  -- 0.80 = custom field, null = manually created
  confidence                FLOAT,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(workspace_id, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_analysis_scopes_workspace
  ON analysis_scopes(workspace_id);

CREATE INDEX IF NOT EXISTS idx_analysis_scopes_confirmed
  ON analysis_scopes(workspace_id, confirmed);

-- ============================================================================
-- SEED: Insert default 'All Deals' scope for every existing workspace
-- ============================================================================
-- filter_field = '1=1' and filter_values = '{}' signals "no filter — match all deals".
-- confirmed = true because this is the system default, not an inference result.
-- ON CONFLICT DO NOTHING is safe to re-run.

INSERT INTO analysis_scopes (
  workspace_id,
  scope_id,
  name,
  filter_field,
  filter_operator,
  filter_values,
  confirmed,
  confidence
)
SELECT
  id,
  'default',
  'All Deals',
  '1=1',
  'in',
  ARRAY[]::TEXT[],
  true,
  1.0
FROM workspaces
ON CONFLICT (workspace_id, scope_id) DO NOTHING;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- After running this migration, verify with:

-- 1. Table and seed row exist:
-- SELECT COUNT(*) FROM analysis_scopes;
-- Expected: equals the number of rows in the workspaces table

-- 2. Default scope shape is correct:
-- SELECT scope_id, name, filter_field, confirmed, confidence
-- FROM analysis_scopes
-- LIMIT 5;
-- Expected: scope_id='default', name='All Deals', filter_field='1=1', confirmed=true

-- 3. Index existence:
-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'analysis_scopes';
-- Expected: idx_analysis_scopes_workspace, idx_analysis_scopes_confirmed
