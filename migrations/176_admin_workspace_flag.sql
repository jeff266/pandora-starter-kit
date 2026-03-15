ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS is_admin_workspace BOOLEAN DEFAULT FALSE;

UPDATE workspaces
  SET is_admin_workspace = TRUE
  WHERE name ILIKE '%RevOps Impact%'
     OR name ILIKE '%admin%';
