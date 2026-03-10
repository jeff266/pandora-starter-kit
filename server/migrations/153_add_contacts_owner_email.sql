-- Add owner_email to contacts table for future role-based data scoping
--
-- Context:
--   Migration 151 added owner_email to deals and accounts.
--   This completes the triad by adding it to contacts.
--
-- Current State:
--   Column will be NULL until HubSpot contacts transform is updated.
--   No queries currently read contacts.owner_email — no runtime impact.
--
-- Future Use:
--   When RLS (row-level security) filtering lands, contacts can be scoped
--   directly via owner_email instead of JOIN through deal_contacts.
--
-- Options for populating this column (deferred decisions):
--   A) Update HubSpot contacts sync to resolve owner from contact properties
--   B) Backfill from deal associations (contact inherits deal owner)
--   C) Accept NULL and filter contacts via JOIN when needed

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS owner_email TEXT;

-- Add index for efficient filtering when RLS scoping is implemented
CREATE INDEX IF NOT EXISTS idx_contacts_owner_email
  ON contacts(workspace_id, owner_email)
  WHERE owner_email IS NOT NULL;

-- Note: No data backfill at this time
-- The column sits harmlessly NULL until sync/backfill logic is added
