# CSV Import Test Plan - Salesforce Export

## Test Data Files
Location: `/Users/jeffignacio/Downloads/`

| File | Rows | Entity Type | Purpose |
|------|------|-------------|---------|
| accounts.csv | 22,007 | Account | Account master data |
| contacts.csv | 99,804 | Contact | Contact master data |
| opportunity contact role.csv | 328 | Deal Contact Role | Deal-to-contact relationships |
| opportunities.csv | 2,717 | Deal | Deal/Opportunity master data |
| opportunity field history.csv | 2,291 | Deal History | Deal stage change history |

## Prerequisites

1. **Server Running**: Pandora server running locally or on Replit
2. **Clean Workspace**: Create a new test workspace or use existing workspace ID
3. **Environment Variables**: `DATABASE_URL` configured correctly
4. **API Access**: Can access `/api/workspaces/:id/import/*` endpoints

## Test Execution Order

### Phase 1: Account Import (Foundation)
**Rationale**: Import accounts first so contacts and deals can be linked properly

### Phase 2: Contact Import
**Rationale**: Import contacts after accounts for proper account linking

### Phase 3: Deal Import
**Rationale**: Import deals after accounts so deal-account relationships work

### Phase 4: Deal Contact Role Import
**Rationale**: Import contact roles after deals and contacts exist

### Phase 5: Deal Field History Import
**Rationale**: Import stage history after deals exist

---

## PHASE 1: Account Import

### Test 1.1: Upload accounts.csv

**API Endpoint**: `POST /api/workspaces/:id/import/upload?entityType=account`

**Request**:
```bash
curl -X POST "http://localhost:3000/api/workspaces/{WORKSPACE_ID}/import/upload?entityType=account" \
  -F "file=@/Users/jeffignacio/Downloads/accounts.csv"
```

**Expected Response**:
- `batchId`: UUID for this import batch
- `entityType`: "account"
- `totalRows`: 22,007
- `headers`: Array of CSV column headers
- `mapping`: AI or heuristic column mappings
- `warnings`: Array of warnings (if any)
- `previewRows`: First 5 rows with mapped fields
- `deduplication`: Deduplication analysis (if existing accounts found)

**Expected Column Mappings** (from accounts.csv structure):
```json
{
  "name": { "columnIndex": 2, "columnHeader": "Account Name" },
  "owner": { "columnIndex": 1, "columnHeader": "Account Owner" },
  "industry": { "columnIndex": 6, "columnHeader": "Industry" },
  "employee_count": { "columnIndex": 7, "columnHeader": "Employees" },
  "annual_revenue": { "columnIndex": 8, "columnHeader": "Annual Revenue" },
  "domain": { "columnIndex": 9, "columnHeader": "Website" },
  "external_id": { "columnIndex": 10, "columnHeader": "Account ID" }
}
```

**Validation Checks**:
- [ ] Response includes valid `batchId`
- [ ] `totalRows` = 22,007
- [ ] All expected columns are mapped
- [ ] `unmappedColumns` contains only non-essential columns
- [ ] `previewRows` shows correctly mapped data
- [ ] No critical warnings about missing required fields

**Test Data Inspection**:
Sample first row:
```
Account Name: Terminal 49
Account Owner: Audrey Maldonado
Industry: information technology & services
Employees: 19
Annual Revenue: 1000000
Website: http://www.terminal49.com
Account ID: 0018c000029LRkl
```

---

### Test 1.2: Confirm Account Import

**API Endpoint**: `POST /api/workspaces/:id/import/confirm`

**Request**:
```bash
curl -X POST "http://localhost:3000/api/workspaces/{WORKSPACE_ID}/import/confirm" \
  -H "Content-Type: application/json" \
  -d '{
    "batchId": "{BATCH_ID_FROM_1.1}",
    "strategy": "replace"
  }'
```

**Expected Response**:
- `success`: true
- `records_inserted`: ~22,007 (may be slightly less if duplicates/empty rows)
- `records_updated`: 0 (first import)
- `records_skipped`: count of skipped rows

**Validation Checks**:
- [ ] Import completes without errors
- [ ] `records_inserted` is close to 22,007
- [ ] Database query confirms accounts exist:
  ```sql
  SELECT COUNT(*) FROM accounts WHERE workspace_id = '{WORKSPACE_ID}';
  -- Expected: ~22,007
  ```
- [ ] Sample accounts have correct data:
  ```sql
  SELECT name, industry, employee_count, external_id
  FROM accounts
  WHERE workspace_id = '{WORKSPACE_ID}'
  LIMIT 5;
  ```
- [ ] `source_data` JSONB field contains import metadata

---

### Test 1.3: Verify Account Import in History

**API Endpoint**: `GET /api/workspaces/:id/import/history`

**Request**:
```bash
curl "http://localhost:3000/api/workspaces/{WORKSPACE_ID}/import/history"
```

**Validation Checks**:
- [ ] Import batch appears in history
- [ ] `entity_type` = "account"
- [ ] `filename` = "accounts.csv"
- [ ] `status` = "applied"
- [ ] `records_inserted` matches expected count

---

## PHASE 2: Contact Import

### Test 2.1: Upload contacts.csv

**API Endpoint**: `POST /api/workspaces/:id/import/upload?entityType=contact`

**Request**:
```bash
curl -X POST "http://localhost:3000/api/workspaces/{WORKSPACE_ID}/import/upload?entityType=contact" \
  -F "file=@/Users/jeffignacio/Downloads/contacts.csv"
```

**Expected Column Mappings**:
```json
{
  "external_id": { "columnIndex": 0, "columnHeader": "Contact ID" },
  "full_name": { "columnIndex": 1, "columnHeader": "Full Name" },
  "email": { "columnIndex": 2, "columnHeader": "Email" },
  "title": { "columnIndex": 3, "columnHeader": "Title" },
  "first_name": { "columnIndex": 4, "columnHeader": "First Name" },
  "last_name": { "columnIndex": 5, "columnHeader": "Last Name" }
}
```

**Validation Checks**:
- [ ] Response includes valid `batchId`
- [ ] `totalRows` = 99,804
- [ ] Email column is correctly identified (required field)
- [ ] WARNING: Should indicate accounts already imported (good for linking)
- [ ] No warnings about missing accounts

**Test Data Inspection**:
Sample first row:
```
Contact ID: 0038c00002b53JK
Full Name: Michael Simcoe
Email: michael@venditan.com
Title: Head of eCommerce Development
First Name: Michael
Last Name: Simcoe
```

---

### Test 2.2: Confirm Contact Import

**API Endpoint**: `POST /api/workspaces/:id/import/confirm`

**Request**:
```bash
curl -X POST "http://localhost:3000/api/workspaces/{WORKSPACE_ID}/import/confirm" \
  -H "Content-Type: application/json" \
  -d '{
    "batchId": "{BATCH_ID_FROM_2.1}",
    "strategy": "replace"
  }'
```

**Expected Response**:
- `records_inserted`: ~99,804
- `records_updated`: 0
- `records_linked_to_accounts`: count of contacts linked to existing accounts

**Validation Checks**:
- [ ] Import completes without errors
- [ ] Database query confirms contacts exist:
  ```sql
  SELECT COUNT(*) FROM contacts WHERE workspace_id = '{WORKSPACE_ID}';
  -- Expected: ~99,804
  ```
- [ ] Sample contact-to-account linking works:
  ```sql
  SELECT c.full_name, c.email, c.title, a.name as account_name
  FROM contacts c
  LEFT JOIN accounts a ON c.account_id = a.id AND c.workspace_id = a.workspace_id
  WHERE c.workspace_id = '{WORKSPACE_ID}'
  AND c.email = 'michael@venditan.com';
  -- Expected: Account name should be populated if linking worked
  ```

---

## PHASE 3: Deal Import

### Test 3.1: Upload opportunities.csv

**API Endpoint**: `POST /api/workspaces/:id/import/upload?entityType=deal`

**Request**:
```bash
curl -X POST "http://localhost:3000/api/workspaces/{WORKSPACE_ID}/import/upload?entityType=deal" \
  -F "file=@/Users/jeffignacio/Downloads/opportunities.csv"
```

**Expected Column Mappings**:
```json
{
  "owner": { "columnIndex": 1, "columnHeader": "Opportunity Owner" },
  "account_name": { "columnIndex": 2, "columnHeader": "Account Name" },
  "name": { "columnIndex": 3, "columnHeader": "Opportunity Name" },
  "stage": { "columnIndex": 4, "columnHeader": "Stage" },
  "amount": { "columnIndex": 6, "columnHeader": "Amount" },
  "probability": { "columnIndex": 7, "columnHeader": "Probability (%)" },
  "close_date": { "columnIndex": 9, "columnHeader": "Close Date" },
  "created_date": { "columnIndex": 10, "columnHeader": "Created Date" },
  "external_id": { "columnIndex": 26, "columnHeader": "Opportunity ID" }
}
```

**Validation Checks**:
- [ ] Response includes valid `batchId`
- [ ] `totalRows` = 2,717
- [ ] Stage mapping is triggered
- [ ] `stageMapping.uniqueStages` contains all unique stages from the file
- [ ] AI classifies stages (or heuristic fallback)
- [ ] WARNING: Should indicate accounts already imported (good for linking)

**Expected Unique Stages**:
Based on sample data:
- "11 - Closed Lost"
- "10 - Closed Won"
- "1 - Sales Qualified Lead (SQL)"
- "2 - Sales Qualified Opportunity (SQO)"
- (and others...)

---

### Test 3.2: Review Stage Mapping

**Inspect Response** from Test 3.1:

```json
{
  "stageMapping": {
    "uniqueStages": [
      "1 - Sales Qualified Lead (SQL)",
      "2 - Sales Qualified Opportunity (SQO)",
      "10 - Closed Won",
      "11 - Closed Lost",
      ...
    ],
    "newMappings": {
      "10 - Closed Won": {
        "normalized": "closed_won",
        "is_open": false,
        "display_order": 100
      },
      "11 - Closed Lost": {
        "normalized": "closed_lost",
        "is_open": false,
        "display_order": 101
      },
      "1 - Sales Qualified Lead (SQL)": {
        "normalized": "qualification",
        "is_open": true,
        "display_order": 1
      },
      ...
    },
    "source": "ai"
  }
}
```

**Manual Validation**:
- [ ] All unique stages have mappings
- [ ] "Closed Won" stages mapped to `normalized: "closed_won"`
- [ ] "Closed Lost" stages mapped to `normalized: "closed_lost"`
- [ ] Open stages have `is_open: true`
- [ ] Closed stages have `is_open: false`
- [ ] `display_order` is logical (early stages = lower numbers)

**Manual Override** (if needed):
If AI mapping is incorrect, prepare override for Test 3.3:
```json
{
  "overrides": {
    "stageMapping": {
      "10 - Closed Won": {
        "normalized": "closed_won",
        "is_open": false,
        "display_order": 100
      },
      "11 - Closed Lost": {
        "normalized": "closed_lost",
        "is_open": false,
        "display_order": 101
      }
    }
  }
}
```

---

### Test 3.3: Confirm Deal Import

**API Endpoint**: `POST /api/workspaces/:id/import/confirm`

**Request** (with stage mapping overrides if needed):
```bash
curl -X POST "http://localhost:3000/api/workspaces/{WORKSPACE_ID}/import/confirm" \
  -H "Content-Type: application/json" \
  -d '{
    "batchId": "{BATCH_ID_FROM_3.1}",
    "strategy": "replace",
    "overrides": {
      "stageMapping": {
        "10 - Closed Won": {
          "normalized": "closed_won",
          "is_open": false,
          "display_order": 100
        },
        "11 - Closed Lost": {
          "normalized": "closed_lost",
          "is_open": false,
          "display_order": 101
        }
      }
    }
  }'
```

**Expected Response**:
- `records_inserted`: ~2,717
- `records_updated`: 0
- `records_linked_to_accounts`: count of deals linked to existing accounts
- `stage_history_created`: count of initial stage history records

**Validation Checks**:
- [ ] Import completes without errors
- [ ] Database query confirms deals exist:
  ```sql
  SELECT COUNT(*) FROM deals WHERE workspace_id = '{WORKSPACE_ID}';
  -- Expected: ~2,717
  ```
- [ ] Sample deal data is correct:
  ```sql
  SELECT name, amount, stage, stage_normalized, close_date, account_id
  FROM deals
  WHERE workspace_id = '{WORKSPACE_ID}'
  AND name LIKE 'Venditan%';
  ```
- [ ] Deal-to-account linking works:
  ```sql
  SELECT d.name as deal_name, d.amount, a.name as account_name
  FROM deals d
  LEFT JOIN accounts a ON d.account_id = a.id AND d.workspace_id = a.workspace_id
  WHERE d.workspace_id = '{WORKSPACE_ID}'
  LIMIT 10;
  -- Expected: account_name should be populated
  ```
- [ ] Won/Lost deals are correctly classified:
  ```sql
  SELECT stage, stage_normalized, COUNT(*)
  FROM deals
  WHERE workspace_id = '{WORKSPACE_ID}'
  GROUP BY stage, stage_normalized;
  -- Expected: "10 - Closed Won" → "closed_won", "11 - Closed Lost" → "closed_lost"
  ```

---

### Test 3.4: Verify Stage Mappings Persisted

**API Endpoint**: `GET /api/workspaces/:id/import/stage-mapping`

**Request**:
```bash
curl "http://localhost:3000/api/workspaces/{WORKSPACE_ID}/import/stage-mapping"
```

**Validation Checks**:
- [ ] All stages from opportunities.csv are in stage_mappings table
- [ ] Each mapping has correct `normalized_stage`, `is_open`, `display_order`
- [ ] Source = "csv_import"

---

## PHASE 4: Deal Contact Role Import

### Test 4.1: Upload opportunity contact role.csv

**Note**: This file contains deal-to-contact relationships. It requires custom handling since it's not a standard entity import.

**Current System Limitation**: The existing import system supports deals, contacts, and accounts as standalone entities. Contact roles (junction table) may require:
1. Custom import endpoint
2. Manual SQL import
3. Post-processing after contact import

**Workaround Option A - Manual SQL Import**:

```sql
-- 1. Create temp table for CSV data
CREATE TEMP TABLE temp_opp_contact_roles (
  opportunity_name TEXT,
  account_name TEXT,
  first_name TEXT,
  last_name TEXT,
  title TEXT,
  email TEXT,
  opportunity_owner TEXT,
  opportunity_id TEXT,
  contact_id TEXT,
  contact_role TEXT,
  opportunity_id_18 TEXT
);

-- 2. Import CSV data using \copy (from psql) or pg-promise
-- (This step requires database client access)

-- 3. Link to existing deals and contacts
INSERT INTO deal_contacts (workspace_id, deal_id, contact_id, role, is_primary)
SELECT
  '{WORKSPACE_ID}',
  d.id as deal_id,
  c.id as contact_id,
  COALESCE(NULLIF(t.contact_role, ''), 'Unknown') as role,
  (t.contact_role = 'Decision Maker') as is_primary
FROM temp_opp_contact_roles t
JOIN deals d ON d.external_id = t.opportunity_id AND d.workspace_id = '{WORKSPACE_ID}'
JOIN contacts c ON c.external_id = t.contact_id AND c.workspace_id = '{WORKSPACE_ID}'
ON CONFLICT (workspace_id, deal_id, contact_id) DO NOTHING;
```

**Validation Checks**:
- [ ] Rows inserted into `deal_contacts` table
- [ ] Query to verify linking:
  ```sql
  SELECT d.name as deal_name, c.full_name as contact_name, dc.role
  FROM deal_contacts dc
  JOIN deals d ON dc.deal_id = d.id
  JOIN contacts c ON dc.contact_id = c.id
  WHERE dc.workspace_id = '{WORKSPACE_ID}'
  LIMIT 20;
  ```
- [ ] Count matches expected:
  ```sql
  SELECT COUNT(*) FROM deal_contacts WHERE workspace_id = '{WORKSPACE_ID}';
  -- Expected: ~328 (may be less if contacts/deals not found)
  ```

**Workaround Option B - Add Custom Import Endpoint**:
(Requires code changes - not covered in this test plan)

---

## PHASE 5: Deal Field History Import

### Test 5.1: Upload opportunity field history.csv

**Note**: Similar to contact roles, this requires custom handling for stage_history table.

**Current System Limitation**: The existing import creates initial stage history during deal import, but doesn't support importing historical stage transitions separately.

**Workaround - Manual SQL Import**:

```sql
-- 1. Create temp table
CREATE TEMP TABLE temp_stage_history (
  opportunity_owner TEXT,
  edited_by TEXT,
  field_event TEXT,
  old_value TEXT,
  new_value TEXT,
  edit_date TEXT,
  opportunity_name TEXT
);

-- 2. Import CSV data (requires database client)

-- 3. Insert into deal_stage_history (only for Stage changes)
INSERT INTO deal_stage_history (
  workspace_id, deal_id, stage_raw, stage_normalized,
  entered_at, exited_at, source, metadata
)
SELECT
  '{WORKSPACE_ID}',
  d.id as deal_id,
  t.new_value as stage_raw,
  sm.normalized_stage,
  TO_TIMESTAMP(t.edit_date, 'MM/DD/YYYY, HH:MI AM') as entered_at,
  NULL as exited_at, -- Will be filled by next record
  'file_import_history',
  jsonb_build_object(
    'edited_by', t.edited_by,
    'old_value', t.old_value,
    'import_source', 'opportunity field history.csv'
  )
FROM temp_stage_history t
JOIN deals d ON d.name = t.opportunity_name AND d.workspace_id = '{WORKSPACE_ID}'
LEFT JOIN stage_mappings sm ON sm.raw_stage = t.new_value
  AND sm.workspace_id = '{WORKSPACE_ID}'
  AND sm.source = 'csv_import'
WHERE t.field_event = 'Stage'
ORDER BY d.id, TO_TIMESTAMP(t.edit_date, 'MM/DD/YYYY, HH:MI AM');
```

**Validation Checks**:
- [ ] Stage history records inserted
- [ ] Query to verify:
  ```sql
  SELECT d.name, dsh.stage_raw, dsh.stage_normalized, dsh.entered_at
  FROM deal_stage_history dsh
  JOIN deals d ON dsh.deal_id = d.id
  WHERE dsh.workspace_id = '{WORKSPACE_ID}'
  AND dsh.source = 'file_import_history'
  ORDER BY d.id, dsh.entered_at
  LIMIT 20;
  ```
- [ ] Count matches expected:
  ```sql
  SELECT COUNT(*) FROM deal_stage_history
  WHERE workspace_id = '{WORKSPACE_ID}'
  AND source = 'file_import_history';
  -- Expected: ~2,291 or subset (only Stage field changes)
  ```

---

## POST-IMPORT VALIDATION

### Test 6.1: Data Quality Checks

**Account Validation**:
```sql
-- Check for accounts with missing required fields
SELECT COUNT(*) FROM accounts
WHERE workspace_id = '{WORKSPACE_ID}'
AND (name IS NULL OR name = '');
-- Expected: 0

-- Check external_id uniqueness
SELECT external_id, COUNT(*)
FROM accounts
WHERE workspace_id = '{WORKSPACE_ID}'
GROUP BY external_id
HAVING COUNT(*) > 1;
-- Expected: No duplicates
```

**Contact Validation**:
```sql
-- Check for contacts with missing email
SELECT COUNT(*) FROM contacts
WHERE workspace_id = '{WORKSPACE_ID}'
AND (email IS NULL OR email = '');
-- Expected: Some may be missing (not all contacts have emails)

-- Check account linking
SELECT
  COUNT(*) as total_contacts,
  COUNT(account_id) as linked_to_account,
  ROUND(100.0 * COUNT(account_id) / COUNT(*), 2) as link_pct
FROM contacts
WHERE workspace_id = '{WORKSPACE_ID}';
-- Expected: High link percentage (>80%)
```

**Deal Validation**:
```sql
-- Check for deals with missing required fields
SELECT COUNT(*) FROM deals
WHERE workspace_id = '{WORKSPACE_ID}'
AND (name IS NULL OR name = '' OR amount IS NULL);
-- Expected: Low count

-- Check stage normalization
SELECT stage, stage_normalized, COUNT(*)
FROM deals
WHERE workspace_id = '{WORKSPACE_ID}'
GROUP BY stage, stage_normalized
ORDER BY COUNT(*) DESC;
-- Expected: All stages have normalized values

-- Check won/lost classification
SELECT
  stage_normalized,
  COUNT(*) as deal_count,
  SUM(amount) as total_value
FROM deals
WHERE workspace_id = '{WORKSPACE_ID}'
AND stage_normalized IN ('closed_won', 'closed_lost')
GROUP BY stage_normalized;
-- Expected: Significant counts in both categories
```

---

### Test 6.2: Import Freshness Check

**API Endpoint**: `GET /api/workspaces/:id/import/freshness`

**Request**:
```bash
curl "http://localhost:3000/api/workspaces/{WORKSPACE_ID}/import/freshness"
```

**Validation Checks**:
- [ ] Shows 3 entity types (account, contact, deal)
- [ ] `lastImportedAt` is today's date
- [ ] `daysSinceImport` = 0
- [ ] `isStale` = false
- [ ] `recordCount` matches imported counts

---

### Test 6.3: Re-Link All (Post-Import Fix)

**API Endpoint**: `POST /api/workspaces/:id/import/relink`

**Purpose**: Re-run account/contact/deal linking logic to fix any missed relationships

**Request**:
```bash
curl -X POST "http://localhost:3000/api/workspaces/{WORKSPACE_ID}/import/relink"
```

**Validation Checks**:
- [ ] Response shows counts of linked records
- [ ] Verify improved linking:
  ```sql
  SELECT
    COUNT(*) as total_deals,
    COUNT(account_id) as linked_to_account,
    ROUND(100.0 * COUNT(account_id) / COUNT(*), 2) as link_pct
  FROM deals
  WHERE workspace_id = '{WORKSPACE_ID}';
  -- Expected: >90% linked
  ```

---

## EDGE CASE TESTING

### Test 7.1: Duplicate Import (Merge Strategy)

**Purpose**: Test what happens when re-importing same file with merge strategy

**Request**:
```bash
# 1. Re-upload accounts.csv
curl -X POST "http://localhost:3000/api/workspaces/{WORKSPACE_ID}/import/upload?entityType=account" \
  -F "file=@/Users/jeffignacio/Downloads/accounts.csv"

# 2. Confirm with merge strategy
curl -X POST "http://localhost:3000/api/workspaces/{WORKSPACE_ID}/import/confirm" \
  -H "Content-Type: application/json" \
  -d '{
    "batchId": "{BATCH_ID}",
    "strategy": "merge"
  }'
```

**Validation Checks**:
- [ ] `records_updated` > 0 (existing accounts updated)
- [ ] `records_inserted` = 0 (no new accounts)
- [ ] Total account count unchanged
- [ ] Existing account data preserved

---

### Test 7.2: Rollback Import

**API Endpoint**: `DELETE /api/workspaces/:id/import/batch/:batchId`

**Request**:
```bash
curl -X DELETE "http://localhost:3000/api/workspaces/{WORKSPACE_ID}/import/batch/{BATCH_ID}"
```

**Validation Checks**:
- [ ] Import batch status changes to "rolled_back"
- [ ] All records from that batch are deleted:
  ```sql
  SELECT COUNT(*) FROM accounts
  WHERE workspace_id = '{WORKSPACE_ID}'
  AND source_data->>'import_batch_id' = '{BATCH_ID}';
  -- Expected: 0
  ```

---

### Test 7.3: Large File Performance

**Purpose**: Test system performance with the large contacts.csv file (99,804 rows)

**Metrics to Track**:
- [ ] Upload time: ___ seconds
- [ ] AI classification time: ___ seconds
- [ ] Confirm/apply time: ___ seconds
- [ ] Total import time: ___ seconds

**Memory/Performance**:
- [ ] Server doesn't crash
- [ ] No timeout errors
- [ ] Database insert performance acceptable

---

## TROUBLESHOOTING

### Issue: "No accounts imported yet" warning during contact/deal import

**Solution**: Import accounts.csv first (Phase 1)

### Issue: Stage mapping has low confidence

**Solution**: Manually review and override stage mappings in confirm request

### Issue: Few contacts/deals linked to accounts

**Causes**:
1. Account names don't match exactly
2. Accounts weren't imported first
3. External IDs missing

**Solutions**:
1. Run re-link endpoint: `POST /api/workspaces/:id/import/relink`
2. Check account name variations:
  ```sql
  SELECT DISTINCT account_name
  FROM contacts
  WHERE workspace_id = '{WORKSPACE_ID}'
  AND account_id IS NULL
  LIMIT 20;
  ```
3. Manual account matching if needed

### Issue: Temp file expired error

**Cause**: Waited too long (>24 hours) between upload and confirm

**Solution**: Re-upload the file

---

## SUCCESS CRITERIA

Import is successful if:

- [ ] **Accounts**: ~22,000 accounts imported with correct data
- [ ] **Contacts**: ~99,800 contacts imported, >80% linked to accounts
- [ ] **Deals**: ~2,700 deals imported, >90% linked to accounts
- [ ] **Stage Mappings**: All unique stages correctly normalized
- [ ] **Won/Lost**: Closed Won and Closed Lost deals properly classified
- [ ] **Data Quality**: <5% missing required fields
- [ ] **Performance**: Large file imports complete within 5 minutes
- [ ] **No Errors**: No 500 errors or crashes during import process

---

## NOTES

### File-Specific Observations

**accounts.csv**:
- Contains Salesforce Account ID in column 11
- Website field may need domain extraction (has full URL)
- Annual Revenue is numeric, no formatting needed

**contacts.csv**:
- Has both First Name/Last Name AND Full Name columns
- Some contacts may not have titles
- Contact ID is Salesforce 15-character ID

**opportunities.csv**:
- Stage names are verbose ("10 - Closed Won")
- Has MEDDIC fields (M, E, C, D, I, C, P columns)
- Probability is percentage (0-100)
- Amount has decimals ($14400.00 format)

**opportunity contact role.csv**:
- Links opportunities to contacts
- Has role field ("Decision Maker", etc.)
- May have empty roles for some contacts

**opportunity field history.csv**:
- Tracks ALL field changes, not just Stage
- Edit Date format: "2/10/2026, 5:56 PM"
- Need to filter for field_event = "Stage" for stage history

### Import Order Importance

**CRITICAL**: Always import in this order:
1. Accounts (foundation)
2. Contacts (depends on accounts)
3. Deals (depends on accounts)
4. Contact Roles (depends on contacts + deals)
5. Field History (depends on deals)

Reversing this order will result in broken relationships and data quality issues.

---

## APPENDIX: Quick Reference

### API Endpoints Summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/workspaces/:id/import/upload` | Upload CSV file |
| POST | `/api/workspaces/:id/import/confirm` | Confirm and apply import |
| GET | `/api/workspaces/:id/import/history` | View import history |
| GET | `/api/workspaces/:id/import/freshness` | Check data freshness |
| POST | `/api/workspaces/:id/import/relink` | Re-run linking logic |
| DELETE | `/api/workspaces/:id/import/batch/:id` | Rollback import |
| POST | `/api/workspaces/:id/import/cancel/:id` | Cancel pending import |
| GET | `/api/workspaces/:id/import/stage-mapping` | Get stage mappings |

### Entity Field Mappings Reference

**Account Required Fields**:
- `name` (required)

**Contact Required Fields**:
- `email` (required)
- At least one of: `full_name`, or (`first_name` + `last_name`)

**Deal Required Fields**:
- `name` (required)
- `amount` (required)
- `stage` (required)
- `close_date` (required)

### Database Tables

- `accounts`: Account master data
- `contacts`: Contact master data
- `deals`: Deal/Opportunity master data
- `deal_contacts`: Junction table for deal-contact relationships
- `deal_stage_history`: Stage transition history
- `stage_mappings`: Stage normalization mappings
- `import_batches`: Import batch tracking
