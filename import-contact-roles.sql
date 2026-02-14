-- PHASE 4: Contact Role Import
-- Import opportunity contact role.csv into deal_contacts table

-- 1. Create temp table
CREATE TEMP TABLE temp_opp_contact_roles (
  opportunity_name TEXT,
  account_name TEXT,
  first_name TEXT,
  last_name TEXT,
  title TEXT,
  mailing_street TEXT,
  mailing_city TEXT,
  mailing_state TEXT,
  mailing_zip TEXT,
  mailing_country TEXT,
  phone TEXT,
  email TEXT,
  opportunity_owner TEXT,
  opportunity_id TEXT,
  contact_id TEXT,
  contact_role TEXT,
  owner_role TEXT,
  opportunity_id_18 TEXT
);

-- 2. Import CSV data
\copy temp_opp_contact_roles FROM '/tmp/opportunity_contact_role_utf8.csv' WITH (FORMAT csv, HEADER true, DELIMITER ',', QUOTE '"');

-- 3. Link to existing deals and contacts
INSERT INTO deal_contacts (workspace_id, deal_id, contact_id, role, is_primary, source)
SELECT
  'b5318340-37f0-4815-9a42-d6644b01a298'::uuid,
  d.id as deal_id,
  c.id as contact_id,
  COALESCE(NULLIF(t.contact_role, ''), 'Unknown') as role,
  (t.contact_role IN ('Decision Maker', 'Economic Decision Maker')) as is_primary,
  'csv_import' as source
FROM temp_opp_contact_roles t
JOIN deals d ON d.source_data->'original_row'->>'Opportunity ID' = t.opportunity_id
  AND d.workspace_id = 'b5318340-37f0-4815-9a42-d6644b01a298'::uuid
JOIN contacts c ON c.source_data->'original_row'->>'Contact ID' = t.contact_id
  AND c.workspace_id = 'b5318340-37f0-4815-9a42-d6644b01a298'::uuid
ON CONFLICT (workspace_id, deal_id, contact_id, source) DO NOTHING;

-- 4. Show import results
SELECT
  COUNT(*) as total_contact_roles,
  COUNT(DISTINCT deal_id) as deals_with_contacts,
  COUNT(DISTINCT contact_id) as contacts_linked,
  COUNT(*) FILTER (WHERE is_primary) as primary_contacts
FROM deal_contacts
WHERE workspace_id = 'b5318340-37f0-4815-9a42-d6644b01a298';

-- 5. Sample data verification
SELECT
  d.name as deal_name,
  CONCAT(c.first_name, ' ', c.last_name) as contact_name,
  dc.role,
  dc.is_primary
FROM deal_contacts dc
JOIN deals d ON dc.deal_id = d.id
JOIN contacts c ON dc.contact_id = c.id
WHERE dc.workspace_id = 'b5318340-37f0-4815-9a42-d6644b01a298'
LIMIT 20;
