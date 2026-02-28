ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS preferred_view VARCHAR(20) DEFAULT 'command';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS default_view VARCHAR(20) DEFAULT 'command';
