-- Migration 135: Google Docs Feedback Loop
-- Add columns to track Google Doc exports for feedback collection

ALTER TABLE report_documents
  ADD COLUMN IF NOT EXISTS google_doc_id TEXT,
  ADD COLUMN IF NOT EXISTS google_doc_url TEXT,
  ADD COLUMN IF NOT EXISTS google_doc_exported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS google_doc_last_read_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS google_doc_original_text TEXT;

CREATE INDEX IF NOT EXISTS idx_report_documents_google_doc
  ON report_documents(workspace_id, google_doc_id)
  WHERE google_doc_id IS NOT NULL;

COMMENT ON COLUMN report_documents.google_doc_id IS 'Google Drive file ID when exported to Google Docs';
COMMENT ON COLUMN report_documents.google_doc_url IS 'Google Docs web view link';
COMMENT ON COLUMN report_documents.google_doc_exported_at IS 'When this document was first exported to Google Docs';
COMMENT ON COLUMN report_documents.google_doc_last_read_at IS 'When we last read back the Google Doc content for feedback';
COMMENT ON COLUMN report_documents.google_doc_original_text IS 'Plain text baseline at export time for diff comparison';
