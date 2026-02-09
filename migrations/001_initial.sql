CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connector_name TEXT NOT NULL,
  auth_method TEXT NOT NULL DEFAULT 'oauth',
  credentials JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  last_sync_at TIMESTAMPTZ,
  sync_cursor JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, connector_name)
);

CREATE TABLE IF NOT EXISTS deals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_data JSONB NOT NULL DEFAULT '{}',
  name TEXT,
  amount NUMERIC(15, 2),
  stage TEXT,
  close_date DATE,
  owner TEXT,
  account_id UUID,
  contact_id UUID,
  probability NUMERIC(5, 2),
  forecast_category TEXT,
  pipeline TEXT,
  days_in_stage INTEGER,
  last_activity_date TIMESTAMPTZ,
  custom_fields JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, source, source_id)
);

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_data JSONB NOT NULL DEFAULT '{}',
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  title TEXT,
  seniority TEXT,
  department TEXT,
  account_id UUID,
  lifecycle_stage TEXT,
  engagement_score NUMERIC(5, 2),
  phone TEXT,
  last_activity_date TIMESTAMPTZ,
  custom_fields JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, source, source_id)
);

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_data JSONB NOT NULL DEFAULT '{}',
  name TEXT,
  domain TEXT,
  industry TEXT,
  employee_count INTEGER,
  annual_revenue NUMERIC(15, 2),
  health_score NUMERIC(5, 2),
  open_deal_count INTEGER DEFAULT 0,
  owner TEXT,
  custom_fields JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, source, source_id)
);

CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_data JSONB NOT NULL DEFAULT '{}',
  activity_type TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  actor TEXT,
  subject TEXT,
  body TEXT,
  deal_id UUID,
  contact_id UUID,
  account_id UUID,
  direction TEXT,
  duration_seconds INTEGER,
  custom_fields JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, source, source_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_data JSONB NOT NULL DEFAULT '{}',
  call_date TIMESTAMPTZ,
  duration_seconds INTEGER,
  participants JSONB NOT NULL DEFAULT '[]',
  deal_id UUID,
  account_id UUID,
  transcript_text TEXT,
  summary TEXT,
  action_items JSONB NOT NULL DEFAULT '[]',
  objections JSONB NOT NULL DEFAULT '[]',
  sentiment_score NUMERIC(5, 2),
  talk_listen_ratio JSONB,
  topics JSONB NOT NULL DEFAULT '[]',
  competitor_mentions JSONB NOT NULL DEFAULT '[]',
  custom_fields JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, source, source_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_data JSONB NOT NULL DEFAULT '{}',
  title TEXT,
  description TEXT,
  status TEXT,
  assignee TEXT,
  due_date DATE,
  created_date TIMESTAMPTZ,
  completed_date TIMESTAMPTZ,
  priority TEXT,
  project TEXT,
  deal_id UUID,
  account_id UUID,
  custom_fields JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, source, source_id)
);

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_data JSONB NOT NULL DEFAULT '{}',
  title TEXT,
  doc_type TEXT,
  content_text TEXT,
  summary TEXT,
  mime_type TEXT,
  url TEXT,
  deal_id UUID,
  account_id UUID,
  author TEXT,
  last_modified_at TIMESTAMPTZ,
  custom_fields JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, source, source_id)
);

CREATE TABLE IF NOT EXISTS migrations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deals_workspace ON deals(workspace_id);
CREATE INDEX IF NOT EXISTS idx_contacts_workspace ON contacts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_accounts_workspace ON accounts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_activities_workspace ON activities(workspace_id);
CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_documents_workspace ON documents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_connections_workspace ON connections(workspace_id);
CREATE INDEX IF NOT EXISTS idx_deals_source ON deals(workspace_id, source, source_id);
CREATE INDEX IF NOT EXISTS idx_contacts_source ON contacts(workspace_id, source, source_id);
CREATE INDEX IF NOT EXISTS idx_accounts_source ON accounts(workspace_id, source, source_id);
