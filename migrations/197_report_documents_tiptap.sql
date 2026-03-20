-- Migration 197: Add tiptap_content to report_documents
-- Enables per-section TipTap editor state storage for Living Documents

ALTER TABLE report_documents
  ADD COLUMN IF NOT EXISTS tiptap_content JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_report_documents_tiptap
  ON report_documents USING gin(tiptap_content);

COMMENT ON COLUMN report_documents.tiptap_content IS 'Per-section TipTap editor state, keyed by section_id. Structure: { "section-1": { type: "doc", content: [...] }, "section-2": {...} }';
