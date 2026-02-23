-- Migration 083: CSV Import Infrastructure
-- Tracks CSV/Excel import history and staging data

-- ============================================================================
-- CSV Imports
-- ============================================================================
CREATE TABLE IF NOT EXISTS csv_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  row_count INTEGER NOT NULL,
  column_mappings JSONB NOT NULL,
  records_imported INTEGER NOT NULL DEFAULT 0,
  records_matched INTEGER NOT NULL DEFAULT 0,
  records_unmatched INTEGER NOT NULL DEFAULT 0,
  unmatched_records JSONB,
  average_confidence REAL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  imported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT csv_imports_check_status CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_csv_imports_workspace ON csv_imports(workspace_id);
CREATE INDEX IF NOT EXISTS idx_csv_imports_status ON csv_imports(status);
CREATE INDEX IF NOT EXISTS idx_csv_imports_created ON csv_imports(created_at);

COMMENT ON TABLE csv_imports IS 'Tracks CSV/Excel file imports for enrichment data';
COMMENT ON COLUMN csv_imports.column_mappings IS 'User-confirmed mapping of CSV columns to Pandora schema fields';
COMMENT ON COLUMN csv_imports.unmatched_records IS 'Records that could not be matched to CRM accounts';
COMMENT ON COLUMN csv_imports.status IS 'Import status: pending, processing, completed, failed';
