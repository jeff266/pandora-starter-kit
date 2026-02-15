-- ============================================================================
-- Discovery Results Table
-- ============================================================================
-- Created: 2026-02-15
-- Purpose: Cache dimension discovery output for template generation
--
-- Stores the result of runDimensionDiscovery() including:
-- - Which dimensions should appear in a template (discovered structure)
-- - Stage list with metadata
-- - Coverage analysis (what skills/data are available)
-- - Cell budget estimation
-- ============================================================================

CREATE TABLE IF NOT EXISTS discovery_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  template_type TEXT NOT NULL DEFAULT 'sales_process_map',
  result JSONB NOT NULL,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(workspace_id, template_type)
);

-- Query pattern: Get latest discovery for a workspace + template type
CREATE INDEX IF NOT EXISTS idx_discovery_workspace
  ON discovery_results(workspace_id, template_type);

-- Query pattern: Find stale discoveries (older than X)
CREATE INDEX IF NOT EXISTS idx_discovery_freshness
  ON discovery_results(workspace_id, discovered_at DESC);

COMMENT ON TABLE discovery_results IS
  'Cached dimension discovery results for template generation';

COMMENT ON COLUMN discovery_results.template_type IS
  'Template being discovered: sales_process_map, lead_scoring, icp_profile, gtm_blueprint, pipeline_audit, forecast_report';

COMMENT ON COLUMN discovery_results.result IS
  'Complete DiscoveryOutput: stages[], dimensions[], excluded_dimensions[], coverage{}, cell_budget{}';

COMMENT ON COLUMN discovery_results.discovered_at IS
  'When discovery ran - invalidate if workspace config or skill evidence changes significantly';
