DROP INDEX IF EXISTS idx_deals_conversation_signals;
ALTER TABLE deals DROP COLUMN IF EXISTS conversation_signals;
