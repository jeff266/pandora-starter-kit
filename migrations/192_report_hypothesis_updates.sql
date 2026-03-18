-- Migration 192: Add hypothesis_updates column to report_documents
-- Persists the weekly hypothesis confidence shifts alongside the report.

ALTER TABLE report_documents
  ADD COLUMN IF NOT EXISTS hypothesis_updates JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN report_documents.hypothesis_updates IS
  'Array of HypothesisUpdate objects showing confidence shifts this week';
