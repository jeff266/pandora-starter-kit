-- Sales Rep Roster Management
-- Allows workspace admins to define which deal owners are actual sales reps
-- and assign org roles (AE, SDR, Manager, etc.)

-- Org Roles Table (workspace-specific, admin-editable)
CREATE TABLE IF NOT EXISTS org_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role_name TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, role_name)
);

CREATE INDEX idx_org_roles_workspace ON org_roles(workspace_id);

COMMENT ON TABLE org_roles IS 'Workspace-specific org roles (AE, SDR, Manager, etc.) - distinct from RBAC permissions';
COMMENT ON COLUMN org_roles.is_default IS 'Default roles seeded for all workspaces (AE, SDR, Manager, CSM, etc.)';

-- Sales Reps Table (tracks which deal owners are real reps)
CREATE TABLE IF NOT EXISTS sales_reps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  rep_name TEXT NOT NULL,
  rep_email TEXT,
  is_rep BOOLEAN NOT NULL DEFAULT true,
  org_role_id UUID REFERENCES org_roles(id) ON DELETE SET NULL,
  quota_eligible BOOLEAN NOT NULL DEFAULT true,
  hire_date DATE,
  team TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, rep_name)
);

CREATE INDEX idx_sales_reps_workspace ON sales_reps(workspace_id);
CREATE INDEX idx_sales_reps_is_rep ON sales_reps(workspace_id, is_rep);
CREATE INDEX idx_sales_reps_org_role ON sales_reps(org_role_id);

COMMENT ON TABLE sales_reps IS 'Tracks which deal owners are actual sales reps vs non-reps (admins, test accounts, etc.)';
COMMENT ON COLUMN sales_reps.rep_name IS 'Matches deals.owner field';
COMMENT ON COLUMN sales_reps.is_rep IS 'True = actual sales rep, False = exclude from quota tracking';
COMMENT ON COLUMN sales_reps.quota_eligible IS 'Whether this rep should be included in quota/attainment calculations';

-- Function to seed default org roles for a workspace
CREATE OR REPLACE FUNCTION seed_default_org_roles(p_workspace_id UUID)
RETURNS void AS $$
BEGIN
  INSERT INTO org_roles (workspace_id, role_name, display_order, is_default, is_active)
  VALUES
    (p_workspace_id, 'AE', 1, true, true),
    (p_workspace_id, 'SDR', 2, true, true),
    (p_workspace_id, 'Manager', 3, true, true),
    (p_workspace_id, 'CSM', 4, true, true),
    (p_workspace_id, 'Account Manager', 5, true, true)
  ON CONFLICT (workspace_id, role_name) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION seed_default_org_roles IS 'Seeds default org roles (AE, SDR, Manager, CSM, AM) for a workspace';

-- Seed default roles for all existing workspaces
DO $$
DECLARE
  ws_id UUID;
BEGIN
  FOR ws_id IN SELECT id FROM workspaces LOOP
    PERFORM seed_default_org_roles(ws_id);
  END LOOP;
END;
$$;

-- View to get all deal owners with their rep status
CREATE OR REPLACE VIEW v_deal_owners_with_rep_status AS
WITH deal_stats AS (
  SELECT
    workspace_id,
    owner,
    COUNT(*) FILTER (WHERE stage_normalized NOT IN ('closed_won', 'closed_lost')) as open_deal_count,
    COUNT(*) as total_deal_count,
    MAX(updated_at) as last_activity
  FROM deals
  WHERE owner IS NOT NULL AND owner != ''
  GROUP BY workspace_id, owner
)
SELECT
  ds.workspace_id,
  ds.owner as rep_name,
  sr.id as sales_rep_id,
  COALESCE(sr.is_rep, true) as is_rep,
  COALESCE(sr.quota_eligible, true) as quota_eligible,
  sr.org_role_id,
  r.role_name as org_role,
  sr.rep_email,
  sr.hire_date,
  sr.team,
  ds.open_deal_count,
  ds.total_deal_count,
  ds.last_activity
FROM deal_stats ds
LEFT JOIN sales_reps sr ON sr.workspace_id = ds.workspace_id AND sr.rep_name = ds.owner
LEFT JOIN org_roles r ON r.id = sr.org_role_id;

COMMENT ON VIEW v_deal_owners_with_rep_status IS 'All deal owners with their rep status, org role, and activity metrics';

-- Trigger to auto-create sales_reps entry when new deal owner appears
CREATE OR REPLACE FUNCTION auto_create_sales_rep()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create if owner is not null/empty and doesn't already exist
  IF NEW.owner IS NOT NULL AND NEW.owner != '' THEN
    INSERT INTO sales_reps (workspace_id, rep_name, is_rep, quota_eligible)
    VALUES (NEW.workspace_id, NEW.owner, true, true)
    ON CONFLICT (workspace_id, rep_name) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_create_sales_rep
  AFTER INSERT OR UPDATE OF owner ON deals
  FOR EACH ROW
  WHEN (NEW.owner IS NOT NULL AND NEW.owner != '')
  EXECUTE FUNCTION auto_create_sales_rep();

COMMENT ON TRIGGER trg_auto_create_sales_rep ON deals IS 'Auto-creates sales_reps entry (is_rep=true by default) when new deal owner appears';

-- Backfill sales_reps for existing deal owners
INSERT INTO sales_reps (workspace_id, rep_name, is_rep, quota_eligible)
SELECT DISTINCT workspace_id, owner, true, true
FROM deals
WHERE owner IS NOT NULL AND owner != ''
ON CONFLICT (workspace_id, rep_name) DO NOTHING;
