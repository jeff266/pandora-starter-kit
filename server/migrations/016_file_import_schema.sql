-- Migration 016: File Import Schema
-- Adds import_batches and stage_mappings tables for CSV/Excel file import connector

-- Import batch tracking
CREATE TABLE IF NOT EXISTS import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  entity_type TEXT NOT NULL,
  filename TEXT NOT NULL,
  source_crm TEXT,
  row_count INTEGER NOT NULL,
  records_inserted INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  records_skipped INTEGER DEFAULT 0,
  classification JSONB,
  warnings TEXT[],
  status TEXT NOT NULL DEFAULT 'pending',
  replace_strategy TEXT DEFAULT 'replace',
  uploaded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_import_batches_workspace ON import_batches(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_batches_status ON import_batches(workspace_id, status);

-- Stage mappings — workspace-level configuration persisted across imports
CREATE TABLE IF NOT EXISTS stage_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  source TEXT NOT NULL DEFAULT 'csv_import',
  raw_stage TEXT NOT NULL,
  normalized_stage TEXT NOT NULL,
  is_open BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, source, raw_stage)
);

CREATE INDEX IF NOT EXISTS idx_stage_mappings_workspace ON stage_mappings(workspace_id, source);

-- Verify source tracking columns exist on entity tables (should already be present)
ALTER TABLE deals ADD COLUMN IF NOT EXISTS source_data JSONB DEFAULT '{}';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source_data JSONB DEFAULT '{}';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS source_data JSONB DEFAULT '{}';
