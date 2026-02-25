-- Add conversation_modifier column to deals table
-- This stores the sentiment modifier derived from recent conversation summaries

ALTER TABLE deals ADD COLUMN IF NOT EXISTS conversation_modifier INT DEFAULT 0;

COMMENT ON COLUMN deals.conversation_modifier IS 'Sentiment modifier (-20 to +20) from recent conversation summaries';
