ALTER TABLE connections ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
