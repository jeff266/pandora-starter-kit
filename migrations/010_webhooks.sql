-- Add webhook configuration to workspaces
ALTER TABLE workspaces
ADD COLUMN webhook_url TEXT,
ADD COLUMN webhook_secret TEXT;

COMMENT ON COLUMN workspaces.webhook_url IS 'URL to send sync progress and completion webhooks';
COMMENT ON COLUMN workspaces.webhook_secret IS 'Secret for HMAC signature verification (optional)';
