-- Migration: Add question_text to token_usage
-- Purpose: Store the user's question (first 500 chars) on cost records
-- Enables "which questions cost the most tokens" queries without table joins

-- Only run if token_usage table exists
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'token_usage') THEN
    ALTER TABLE token_usage
      ADD COLUMN IF NOT EXISTS question_text TEXT;

    COMMENT ON COLUMN token_usage.question_text IS 'First 500 characters of the user message that triggered this LLM call';
  END IF;
END $$;
