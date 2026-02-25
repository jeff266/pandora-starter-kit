-- Add conversation_signals JSONB column to deals table
-- Stores detailed signal information about which keywords triggered conversation score adjustments

ALTER TABLE deals ADD COLUMN IF NOT EXISTS conversation_signals JSONB DEFAULT '[]';

COMMENT ON COLUMN deals.conversation_signals IS 'Array of conversation signals: [{keyword, call_title, call_date, points}]';

CREATE INDEX IF NOT EXISTS idx_deals_conversation_signals ON deals USING GIN (conversation_signals) WHERE conversation_signals != '[]';
