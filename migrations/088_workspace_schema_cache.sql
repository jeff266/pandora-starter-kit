-- Migration: Workspace Schema Cache
-- Purpose: Cache discovered CRM object schemas to avoid repeated API calls
-- Used by: query_schema tool for Ask Pandora dynamic field discovery

CREATE TABLE IF NOT EXISTS workspace_schema_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  object_type TEXT NOT NULL CHECK (object_type IN ('deals', 'companies', 'contacts')),
  crm_source TEXT NOT NULL CHECK (crm_source IN ('hubspot', 'salesforce')),
  schema_json JSONB NOT NULL,
  field_count INTEGER NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ttl_hours INTEGER NOT NULL DEFAULT 24,
  UNIQUE(workspace_id, object_type, crm_source)
);

CREATE INDEX idx_workspace_schema_cache_workspace
  ON workspace_schema_cache(workspace_id);

CREATE INDEX idx_workspace_schema_cache_lookup
  ON workspace_schema_cache(workspace_id, object_type, crm_source);

COMMENT ON TABLE workspace_schema_cache IS 'Caches discovered CRM field schemas to enable dynamic property queries without repeated API calls';
COMMENT ON COLUMN workspace_schema_cache.schema_json IS 'Array of SchemaField objects with internal_name, label, type, options, population_rate, is_custom';
COMMENT ON COLUMN workspace_schema_cache.ttl_hours IS 'Cache validity window - refreshes when fetched_at + ttl_hours < now';
