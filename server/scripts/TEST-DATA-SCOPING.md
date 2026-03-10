# Testing Role-Based Data Scoping (Phase 2 RBAC)

This directory contains test scripts to verify that role-based data visibility filtering is working correctly.

## Prerequisites

Before running these tests:

1. **Run email consistency check** to ensure `owner_email` data is clean:
   ```bash
   npx tsx server/scripts/check-email-consistency.ts <workspace_id>
   ```
   Should output: `✅ Email consistency check PASSED`

2. **Ensure workspace has test data**:
   - At least one admin user
   - At least one rep/viewer user
   - Several deals with `owner_email` populated
   - Deals owned by different users

3. **Verify user permissions**:
   ```sql
   -- Check user roles and permissions
   SELECT
     u.email,
     wm.pandora_role,
     wr.permissions->'data.deals_view' as deals_view_all
   FROM workspace_members wm
   JOIN users u ON u.user_id = wm.user_id
   LEFT JOIN workspace_roles wr ON wr.id = wm.role_id
   WHERE wm.workspace_id = '<workspace_id>';
   ```

   Expected:
   - Admin: `deals_view_all = true` → sees all deals
   - Rep/Viewer: `deals_view_all = false` or `null` → sees only own deals

---

## Test Scripts

### 1. Automated TypeScript Test (Recommended)

**File:** `test-data-scoping.ts`

**What it tests:**
- ✅ Admin users see all deals
- ✅ Rep/Viewer users see only their own deals
- ✅ Email normalization works correctly
- ✅ Scope filter SQL is correct
- ✅ Parameter binding is safe

**Usage:**
```bash
npx tsx server/scripts/test-data-scoping.ts <workspace_id>
```

**Example output:**
```
=== Role-Based Data Scoping Test ===
Workspace: ws-abc123
Total deals in workspace: 45

  Testing: admin@company.com (admin)
    Data scope: dealsFilter=all, canExport=true
    Scope SQL: (none - sees all)
    Deals returned: 45 / 45
    Visible owners: alice@company.com, bob@company.com, diego@company.com

  Testing: diego@company.com (viewer)
    Data scope: dealsFilter=own, canExport=false
    Scope SQL: AND owner_email = $1
    Scope params: ["diego@company.com"]
    Deals returned: 12 / 45
    Visible owners: diego@company.com

=== Test Results Summary ===

✅ admin@company.com (admin)
   Filter: all
   Expected: See all deals (admin)
   Returned: 45 / 45 deals

✅ diego@company.com (viewer)
   Filter: own
   Expected: See only deals where owner_email = 'diego@company.com'
   Returned: 12 / 45 deals

✅ ALL TESTS PASSED
   → Role-based data scoping is working correctly
```

---

### 2. Quick curl Test (Manual API Testing)

**File:** `test-data-scoping-curl.sh`

**What it tests:**
- ✅ API endpoints enforce scoping
- ✅ JWT authentication works
- ✅ Admin vs Rep/Viewer behavior differs

**Usage:**
```bash
./server/scripts/test-data-scoping-curl.sh
```

**Interactive prompts:**
1. Enter workspace ID
2. Enter admin JWT token (from browser local storage)
3. Enter rep/viewer JWT token

**How to get JWT tokens:**
1. Log in to Pandora as admin/rep
2. Open browser DevTools → Application → Local Storage
3. Copy `pandora_auth_token` value

**Example output:**
```
Test 1: Admin user (should see all deals)
✅ Admin request succeeded
   HTTP Status: 200
   Total deals: 45
   Deals returned: 5
   Sample deal owner: Alice Smith (alice@company.com)

Test 2: Rep/Viewer user (should see only own deals)
✅ Rep request succeeded
   HTTP Status: 200
   Total deals: 12
   Deals returned: 12
   Unique owner_email values: 1
   ✅ Only one owner (correct)
   Owner: diego@company.com

Comparison:
  Admin sees:      45 deals
  Rep/Viewer sees: 12 deals

✅ PASS: Admin sees more deals than rep (scoping working)
```

---

### 3. SQL Verification (Direct Database Check)

**Quick verification query:**
```sql
-- Check that deals have owner_email populated
SELECT
  workspace_id,
  COUNT(*) as total_deals,
  COUNT(owner_email) as deals_with_owner,
  COUNT(DISTINCT owner_email) as unique_owners
FROM deals
WHERE workspace_id = '<workspace_id>'
GROUP BY workspace_id;
```

**Expected:**
- `deals_with_owner` should equal `total_deals` (all deals have owner_email)
- `unique_owners` should be > 1 (multiple owners to test scoping)

**Test scope filter manually:**
```sql
-- Simulate admin query (no filter)
SELECT COUNT(*) FROM deals WHERE workspace_id = '<workspace_id>';

-- Simulate rep query (with owner_email filter)
SELECT COUNT(*) FROM deals
WHERE workspace_id = '<workspace_id>'
  AND owner_email = 'diego@company.com';
```

---

## Troubleshooting

### ❌ Test fails: "owner_email IS NULL"

**Problem:** Deals don't have `owner_email` populated

**Fix:**
```bash
# Re-sync HubSpot to populate owner_email
curl -X POST http://localhost:3001/api/workspaces/<workspace_id>/connectors/hubspot/sync
```

---

### ❌ Admin and rep see same number of deals

**Possible causes:**

1. **Rep owns all deals** (legitimate):
   ```sql
   -- Check if rep owns all deals
   SELECT owner_email, COUNT(*) FROM deals
   WHERE workspace_id = '<workspace_id>'
   GROUP BY owner_email;
   ```

2. **Rep has admin permissions** (misconfiguration):
   ```sql
   -- Check rep permissions
   SELECT
     u.email,
     wm.pandora_role,
     wr.permissions
   FROM workspace_members wm
   JOIN users u ON u.user_id = wm.user_id
   LEFT JOIN workspace_roles wr ON wr.id = wm.role_id
   WHERE wm.workspace_id = '<workspace_id>'
     AND u.email = '<rep_email>';
   ```

   Fix: Update role permissions if `data.deals_view = true` for non-admins

---

### ❌ Email mismatch: User email doesn't match owner_email

**Problem:** User login email differs from CRM owner email

**Example:**
- User logs in as: `Diego.Martinez@company.com`
- Deals have: `diego.martinez@company.com`

**Fix:** Run email consistency check:
```bash
npx tsx server/scripts/check-email-consistency.ts <workspace_id>
```

If variants found, either:
- **Option A:** Update user email in database to match CRM
- **Option B:** Re-sync to normalize owner_email

---

## Test Coverage Checklist

Before deploying to production, verify:

- [ ] Admin users see all deals
- [ ] Rep users see only their own deals
- [ ] Viewer users see only their own deals
- [ ] Email case-insensitivity works (Diego@company.com = diego@company.com)
- [ ] Plus-addressing stripped (diego+test@company.com = diego@company.com)
- [ ] Users with no email see empty result set (fail closed)
- [ ] Impersonation works (admin "View as" rep)
- [ ] Pagination works with scoping
- [ ] Filtering (stage, amount) works alongside scoping
- [ ] Performance is acceptable (< 200ms for typical queries)

---

## Next Steps After Testing

Once all tests pass:

1. **Apply scoping to other endpoints:**
   - T3: `/api/dashboard/pipeline-summary`
   - T4: `/api/accounts`
   - T5: Skills and agents

2. **Test impersonation flow:**
   ```bash
   # Admin impersonates Diego
   POST /api/auth/impersonate/:userId
   # Then query /api/deals and verify only Diego's deals shown
   ```

3. **Frontend UI updates:**
   - Hide navigation items based on permissions
   - Hide export button for non-exporters
   - Show "View as" indicator during impersonation

4. **Load testing:**
   - Test with 10,000+ deals
   - Verify `owner_email` index is used
   - Check query performance

---

## Related Files

- **Helper:** `server/middleware/apply-data-scope.ts` (scope filter builder)
- **Middleware:** `server/middleware/workspace-context.ts` (attaches dataScope to req)
- **Permissions:** `server/permissions/data-visibility.ts` (computes dataScope from role)
- **Migration:** `server/migrations/151_add_owner_email.sql` (adds owner_email column)
- **Diagnostic:** `server/scripts/check-email-consistency.ts` (validates email data)
