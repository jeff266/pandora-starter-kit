# RBAC Phase 2 Test Guide for Replit

## Quick Test

Run this command with your demo workspace ID:

```bash
npx tsx server/scripts/test-rbac-phase2-replit.ts <workspace_id>
```

**Example:**
```bash
npx tsx server/scripts/test-rbac-phase2-replit.ts 00000000-0000-0000-0000-000000000002
```

---

## What It Tests

### ✅ Test 1: Permission Configuration (Option B)
Verifies that `system-roles.ts` has correct permissions:
- Member: `data.deals_view = false` (see only own deals)
- Viewer: `data.deals_view = false` (see only own deals)
- Manager: `data.deals_view = true` (see all deals)
- Analyst: `data.deals_view = true` (see all deals)

### ✅ Test 2: DataScope Computation
Verifies `getDataVisibilityScope()` returns:
- Member: `dealsFilter: 'own'`
- Viewer: `dealsFilter: 'own'`
- Manager: `dealsFilter: 'all'`
- Analyst: `dealsFilter: 'all'`

### ✅ Test 3: SQL Scope Filter Generation
Verifies `buildDealScopeFilter()` generates:
- Member/Viewer: `AND owner_email = $1` with params `['user@example.com']`
- Admin/Manager/Analyst: Empty filter (no restriction)

### ✅ Test 4: Database Scoping (Real Queries)
Runs actual SQL queries with scope filters:
- Counts deals for each workspace member
- Verifies members/viewers see fewer deals than total
- Verifies managers/analysts see all deals

### ✅ Test 5: Migration 154 Applied
Checks database for updated permissions:
- Member roles in `workspace_roles` have `data.deals_view = false`
- Viewer roles in `workspace_roles` have `data.deals_view = false`

### ✅ Test 6: Skill Permissions Protected
Confirms skill execution routes require `skills.run_manual` permission

---

## Expected Output

```
╔════════════════════════════════════════════════════════════╗
║       RBAC Phase 2 Integration Test for Replit            ║
╚════════════════════════════════════════════════════════════╝

Workspace: 00000000-0000-0000-0000-000000000002

=== Test 1: Permission Configuration (Option B) ===

✅ Member role permissions: Member has data.deals_view = false (sees only own deals)
✅ Viewer role permissions: Viewer has data.deals_view = false (sees only own deals)
✅ Manager role permissions: Manager has data.deals_view = true (sees all deals)
✅ Analyst role permissions: Analyst has data.deals_view = true (sees all deals)

=== Test 2: DataScope Computation ===

✅ Member dataScope: Member gets dealsFilter: 'own'
✅ Viewer dataScope: Viewer gets dealsFilter: 'own'
✅ Manager dataScope: Manager gets dealsFilter: 'all'
✅ Analyst dataScope: Analyst gets dealsFilter: 'all'

=== Test 3: SQL Scope Filter Generation ===

✅ Deal scope filter SQL: Correct SQL: AND owner_email = $1
✅ Deal scope filter params: Correct params: ["test@example.com"]
✅ Account scope filter SQL: Correct SQL: AND owner_email = $1
✅ Admin scope filter (should be empty): Admin has no filter (sees all)

=== Test 4: Database Scoping (Real Queries) ===

Found 6 workspace members
Total deals in workspace: 45

✅ admin (admin@workspace.com): See all 45 deals - Got 45 deals
✅ analyst (analyst@workspace.com): See all 45 deals - Got 45 deals
✅ manager (manager@workspace.com): See all 45 deals - Got 45 deals
✅ member (member@workspace.com): See only own deals (12) - Got 12 deals
✅ viewer (viewer@workspace.com): See only own deals (8) - Got 8 deals

=== Test 5: Migration 154 Applied ===

✅ Member roles updated in DB: Found 4 member role(s) with data.deals_view = false
✅ Viewer roles updated in DB: Found 4 viewer role(s) with data.deals_view = false

=== Test 6: Skill Permissions Protected ===

✅ Skill execution routes: Routes protected with requirePermission middleware

═══════════════════════════════════════════════════════════

Tests run: 18
✅ Passed: 18
❌ Failed: 0

🎉 ALL TESTS PASSED - RBAC Phase 2 is working correctly!

✅ Option B implemented (member/viewer see only own deals)
✅ Deal scoping working
✅ Account scoping working
✅ Pipeline summary scoping working
✅ Skill permissions protected
✅ Migration 154 applied
```

---

## Troubleshooting

### ❌ "No workspace members found"

**Problem:** Workspace has no active members

**Fix:**
```bash
# Check workspace members
npx tsx server/scripts/check-email-consistency.ts <workspace_id>
```

---

### ❌ "Migration 154 may not have run"

**Problem:** `workspace_roles` table still has old permissions

**Fix:**
```bash
# Check migration status
psql $DATABASE_URL -c "SELECT version FROM migrations ORDER BY version DESC LIMIT 5;"

# If migration 154 is missing, run migrations:
npm run migrate
```

---

### ❌ "Member has data.deals_view = true"

**Problem:** Code changes not loaded or migration not applied

**Fix:**
1. Restart the server to reload `system-roles.ts`
2. Run migration 154 if not applied
3. Verify file at `server/permissions/system-roles.ts` line 55 has `'data.deals_view': false`

---

### ❌ "Member sees all deals (expected to see only own)"

**Problem:** Test data has all deals owned by the member

**Solution:** This is OK if the member actually owns all deals in the workspace. Verify with:
```sql
SELECT owner_email, COUNT(*)
FROM deals
WHERE workspace_id = '<workspace_id>'
GROUP BY owner_email;
```

If only one owner exists, add deals owned by different users for better testing.

---

## Manual API Testing

Test scoping via API endpoints:

### 1. Get auth token for different roles

**Admin:**
```bash
# Login as admin, copy token from browser localStorage
ADMIN_TOKEN="<token>"
```

**Member/Viewer:**
```bash
# Login as member/viewer, copy token
MEMBER_TOKEN="<token>"
```

### 2. Test GET /api/deals

**Admin (should see all):**
```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3001/api/workspaces/<workspace_id>/deals
```

**Member (should see only own):**
```bash
curl -H "Authorization: Bearer $MEMBER_TOKEN" \
  http://localhost:3001/api/workspaces/<workspace_id>/deals
```

### 3. Test impersonation

**Admin impersonates member:**
```bash
# Create impersonation session
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"targetUserId": "<member_user_id>"}' \
  http://localhost:3001/api/workspaces/<workspace_id>/members/impersonate

# Use returned token to query deals (should be scoped to member)
IMPERSONATION_TOKEN="<token_from_response>"

curl -H "Authorization: Bearer $IMPERSONATION_TOKEN" \
  http://localhost:3001/api/workspaces/<workspace_id>/deals
```

---

## Files Modified (For Reference)

### Core Implementation
- `server/permissions/system-roles.ts` - Updated member/viewer permissions
- `server/middleware/apply-data-scope.ts` - Scope filter builders
- `migrations/154_update_member_viewer_deal_visibility.sql` - Database migration

### Routes with Scoping
- `server/routes/data.ts` - Applied to `/deals`, `/accounts`, `/pipeline-summary`
- `server/tools/deal-query.ts` - Updated `getPipelineSummary()`

### Skill Protection
- `server/routes/skills.ts` - Added `requirePermission` to 2 routes
- `server/routes/custom-skills.ts` - Added `requirePermission` to 1 route

### Tests
- `server/scripts/test-rbac-phase2-replit.ts` - This test script
- `server/scripts/test-data-scoping.ts` - User-by-user test
- `server/scripts/TEST-DATA-SCOPING.md` - Full documentation

---

## Success Criteria

All 18 tests should pass:
- [x] 4 tests for permission configuration
- [x] 4 tests for dataScope computation
- [x] 4 tests for SQL filter generation
- [x] N tests for database scoping (one per workspace member)
- [x] 2 tests for migration 154
- [x] 1 test for skill permissions

**Exit code 0 = Success!**
