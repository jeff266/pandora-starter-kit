# Ask Pandora Role Scoping Test Guide (RBAC T10)

## Quick Test

Run this command with your workspace ID:

```bash
npx tsx server/scripts/test-ask-pandora-scoping.ts <workspace_id>
```

**Example:**
```bash
npx tsx server/scripts/test-ask-pandora-scoping.ts 00000000-0000-0000-0000-000000000002
```

---

## What It Tests

### ✅ Test 1: RBAC Permissions Configuration
Verifies that `system-roles.ts` has correct permissions:
- Member: `data.deals_view = false` (sees only own deals)
- Viewer: `data.deals_view = false` (sees only own deals)
- Admin: `data.deals_view = true` (sees all deals)
- Manager: `data.deals_view = true` (sees all deals)
- Analyst: `data.deals_view = true` (sees all deals)

### ✅ Test 2: Pipeline Resolver Scoping
Verifies `resolveDefaultPipeline()` returns correct scoping based on role:
- Member: `owner_only=true, mode='owner_only'`
- Viewer: `owner_only=true, mode='owner_only'`
- Admin: `owner_only=false` (sees all)
- Manager: `owner_only=false` (sees all)
- Analyst: `owner_only=false` (sees all)

### ✅ Test 3: SessionContext Integration
Verifies SessionContext correctly stores:
- `userId` field
- `userRole` field
- `activeScope` with repEmail

### ✅ Test 4: Real Data Scoping (Database Queries)
Tests actual data visibility for each workspace member:
- Counts total deals in workspace
- Verifies each user's expected deal visibility based on role
- Admin/Manager/Analyst should see all deals
- Member/Viewer should see only their own deals

### ✅ Test 5: Slack User Resolution
Checks Slack integration readiness:
- Counts users with `slack_user_id`
- Tests `resolveSlackUser()` SQL query
- Verifies role resolution works for Slack users

### ✅ Test 6: ConversationTurnInput Interface
Confirms interface updates:
- `userId` field present
- `userRole` field present

---

## Expected Output

```
╔════════════════════════════════════════════════════════════╗
║       Ask Pandora Role Scoping Test (RBAC T10)            ║
╚════════════════════════════════════════════════════════════╝

Workspace: 00000000-0000-0000-0000-000000000002

=== Test 1: RBAC Permissions Configuration ===

✅ Member permissions: Member has data.deals_view = false (scoped to own deals)
✅ Viewer permissions: Viewer has data.deals_view = false (scoped to own deals)
✅ Admin permissions: Admin has data.deals_view = true (sees all deals)
✅ Manager permissions: Manager has data.deals_view = true (sees all deals)
✅ Analyst permissions: Analyst has data.deals_view = true (sees all deals)

=== Test 2: Pipeline Resolver Scoping ===

✅ Member pipeline resolution: Member gets owner_only=true, mode='owner_only'
✅ Viewer pipeline resolution: Viewer gets owner_only=true, mode='owner_only'
✅ Admin pipeline resolution: Admin gets owner_only=false (sees all deals)
✅ Manager pipeline resolution: Manager gets owner_only=false (sees all deals)
✅ Analyst pipeline resolution: Analyst gets owner_only=false (sees all deals)

=== Test 3: SessionContext Integration ===

✅ SessionContext userId: SessionContext correctly stores userId
✅ SessionContext userRole: SessionContext correctly stores userRole
✅ SessionContext activeScope: SessionContext correctly stores activeScope

=== Test 4: Real Data Scoping (Database Queries) ===

Found 6 workspace members

Total deals in workspace: 45

✅ admin (admin@workspace.com): Should see all 45 deals (has data.deals_view=true)
✅ analyst (analyst@workspace.com): Should see all 45 deals (has data.deals_view=true)
✅ manager (manager@workspace.com): Should see all 45 deals (has data.deals_view=true)
✅ member (member@workspace.com): Should see only own deals (12 of 45) (has data.deals_view=false)
✅ viewer (viewer@workspace.com): Should see only own deals (8 of 45) (has data.deals_view=false)

=== Test 5: Slack User Resolution ===

✅ Slack users in workspace: Found 3 user(s) with Slack IDs
✅ Slack user resolution query: Successfully resolved Slack user to role: member

=== Test 6: ConversationTurnInput Interface ===

✅ ConversationTurnInput has userId: userId field exists in ConversationTurnInput
✅ ConversationTurnInput has userRole: userRole field exists in ConversationTurnInput

═══════════════════════════════════════════════════════════

Tests run: 19
✅ Passed: 19
❌ Failed: 0

🎉 ALL TESTS PASSED - Ask Pandora role scoping is working correctly!

✅ RBAC permissions configured correctly
✅ Pipeline resolver uses data.deals_view permission
✅ SessionContext integration complete
✅ Data scoping applied based on user role
✅ Slack user resolution ready
✅ ConversationTurnInput interface updated
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

### ❌ "Member has data.deals_view = true"

**Problem:** Code changes not loaded

**Fix:**
1. Restart the server to reload `system-roles.ts`
2. Verify file at `server/permissions/system-roles.ts` line 55 has `'data.deals_view': false`

---

### ❌ "Pipeline resolver returns wrong scoping"

**Problem:** `resolveDefaultPipeline` not using RBAC permissions

**Fix:**
1. Check `server/chat/pipeline-resolver.ts` line 382-391
2. Verify it imports `SYSTEM_ROLE_PERMISSIONS`
3. Verify it checks `rolePermissions['data.deals_view']`

---

### ❌ "SessionContext missing userId or userRole"

**Problem:** SessionContext not being created with user context

**Fix:**
1. Check `server/chat/orchestrator.ts` around line 165
2. Verify `sessionContext.userId = userId;` is present
3. Verify `sessionContext.userRole = userRole;` is present

---

## Manual Testing with Ask Pandora

### 1. Test as Admin

**Login as admin user, then:**
```
Ask Pandora: "What deals are at risk?"
```

**Expected:** Should see ALL deals in the workspace

---

### 2. Test as Member/Viewer

**Login as member/viewer user, then:**
```
Ask Pandora: "What deals are at risk?"
```

**Expected:** Should see ONLY deals owned by that user

---

### 3. Test via Slack

**As member user in Slack:**
```
/pandora What deals are closing this week?
```

**Expected:** Should see only own deals

**As admin user in Slack:**
```
/pandora What deals are closing this week?
```

**Expected:** Should see all deals

---

### 4. Verify Tool Call Enrichment

**Check logs for:**
```
[PandoraAgent] Enriched tool input with:
  _requesting_user_id: user-abc-123
  _requesting_user_role: member
```

**Expected:** Tools receive user context and apply owner filtering

---

## Files Modified (For Reference)

### Core Implementation
- `server/chat/orchestrator.ts` - SessionContext creation, ConversationTurnInput interface
- `server/routes/chat.ts` - Fetch and pass userRole
- `server/chat/pipeline-resolver.ts` - Use RBAC permissions for scoping

### Slack Integration
- `server/slack/dm-handler.ts` - Slack user resolution
- `server/slack/slash-command.ts` - Slack user resolution
- `server/routes/slack-events.ts` - Slack user resolution (4 locations)

### Data Tools
- `server/chat/pandora-agent.ts` - Pass `_requesting_user_role` to tools
- `server/chat/data-tools.ts` - Apply owner filtering based on role

### Tests
- `server/scripts/test-ask-pandora-scoping.ts` - This test script
- `ASK-PANDORA-SCOPING-TEST.md` - This documentation

---

## Success Criteria

All 19+ tests should pass:
- [x] 5 tests for RBAC permissions
- [x] 5 tests for pipeline resolver
- [x] 3 tests for SessionContext
- [x] N tests for real data scoping (one per workspace member)
- [x] 2 tests for Slack user resolution
- [x] 2 tests for ConversationTurnInput interface

**Exit code 0 = Success!**

---

## Integration with Existing RBAC Tests

This test complements `test-rbac-phase2-replit.ts`:

**RBAC Phase 2 Test (test-rbac-phase2-replit.ts):**
- Tests API endpoint scoping (/api/deals, /api/accounts)
- Tests middleware (apply-data-scope.ts)
- Tests database scoping with real queries
- Tests skill permissions

**Ask Pandora Scoping Test (test-ask-pandora-scoping.ts):**
- Tests Ask Pandora orchestration scoping
- Tests SessionContext integration
- Tests pipeline resolver RBAC integration
- Tests Slack user resolution
- Tests data tool enrichment

**Run both for complete RBAC Phase 2 validation:**
```bash
# Test API endpoints
npx tsx server/scripts/test-rbac-phase2-replit.ts <workspace_id>

# Test Ask Pandora
npx tsx server/scripts/test-ask-pandora-scoping.ts <workspace_id>
```
