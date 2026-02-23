-- Migration: Add question_text to token_usage
-- Purpose: Store the user's question (first 500 chars) on cost records
-- Enables "which questions cost the most tokens" queries without table joins

ALTER TABLE token_usage
  ADD COLUMN IF NOT EXISTS question_text TEXT;

COMMENT ON COLUMN token_usage.question_text IS 'First 500 characters of the user message that triggered this LLM call';
