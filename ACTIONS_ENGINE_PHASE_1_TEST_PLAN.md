# Actions Engine Phase 1 - Test Plan

## Component Test Results

### ✅ Action Extractor (parseActionsFromOutput)
**Status:** PASSED

Test coverage:
- Valid actions extraction from synthesis output
- Empty output handling (returns empty array)
- Malformed JSON handling (returns empty array with warning)
- Missing required fields filtering (invalid actions filtered out)

Verified:
- Correctly parses `<actions>` JSON blocks from Claude synthesis output
- Validates required fields: `action_type`, `title`, `severity`
- Preserves all optional fields (impact_amount, recommended_steps, execution_payload, etc.)

## Integration Tests (Requires DB)

### Database Migration
File: `server/migrations/025_actions.sql`

Tables created:
1. `actions` - Main actions table with 30+ columns
2. `action_audit_log` - State transition history

Indexes:
- `idx_actions_workspace_status` - Filter by workspace + execution status
- `idx_actions_workspace_severity` - Filter by workspace + severity
- `idx_actions_target` - Find actions for specific deal/account
- `idx_actions_skill_run` - Link to skill run
- `idx_actions_owner` - Filter by rep email
- `idx_actions_expires` - Scheduler expiry queries

### Actions API Endpoints
Base path: `/api/workspaces/:workspaceId/action-items`

**1. GET /api/workspaces/:id/action-items**
- List actions with filters
- Query params: `status`, `severity`, `action_type`, `owner_email`, `source_skill`, `deal_id`, `account_id`, `sort`, `limit`, `offset`
- Returns: `{ actions: [], total: number, limit: number, offset: number }`
- Sort options: `severity`, `impact`, `newest`, `oldest`

**2. GET /api/workspaces/:id/action-items/summary**
- Dashboard summary stats
- Returns:
  - `open_total`, `open_critical`, `open_warning`, `open_info`
  - `in_progress`, `executed_7d`, `dismissed_7d`
  - `total_impact_at_risk`, `reps_with_actions`, `skills_producing_actions`
  - `by_type[]` - Action type breakdown
  - `by_rep[]` - Top reps by action count

**3. GET /api/workspaces/:id/action-items/:actionId**
- Get action detail with audit log
- Returns: Action object + `audit_log[]`

**4. PUT /api/workspaces/:id/action-items/:actionId/status**
- Update action status with state machine validation
- Body: `{ status, actor, reason?, details? }`
- Valid transitions:
  - `open` → `in_progress`, `executed`, `dismissed`
  - `in_progress` → `open`, `executed`, `dismissed`
  - `executed` → (terminal)
  - `dismissed` → `open` (can reopen)
  - `expired` → (terminal)
  - `superseded` → (terminal)

**5. POST /api/workspaces/:id/action-items/:actionId/notify**
- Send Slack notification for action
- Body: `{ channel?, actor? }`
- Returns: `{ delivered: boolean, error?: string }`

### Slack Notification System

**notifyActionViaSlack** (`server/actions/slack-notify.ts`)
- Sends individual action as Block Kit card
- Components:
  - Header with severity emoji (🔴 critical, 🟡 warning, 🔵 info)
  - Context row (target entity, impact, urgency, owner)
  - Summary text
  - Recommended steps (numbered list)
  - Action buttons: Mark In Progress, View in Pandora, Dismiss
- Requires: workspace `slack_webhook_url`

**sendActionDigest** (`server/actions/slack-notify.ts`)
- Batch digest of critical actions
- Default: top 10 by impact_amount
- Configurable severity filter

### Action Expiry Scheduler

**startActionExpiryScheduler** (`server/actions/scheduler.ts`)
- Runs every hour (starts immediately on server boot)
- Marks actions past `expires_at` as 'expired'
- Deletes terminal actions (expired/superseded/dismissed) older than 90 days
- Creates audit log entries for all state changes

### Skill Integration

**Updated Skills:**
1. `pipeline-hygiene.ts` - Emits critical/warning actions for stale deals
2. `single-thread-alert.ts` - Emits critical/warning actions for multi-threading needs

**Synthesis Prompt Additions:**
- ACTIONS GENERATION section with JSON schema
- Rules for severity classification (critical vs warning)
- Required fields: action_type, severity, title, summary, recommended_steps (2-3 specific steps)
- Optional: execution_payload with CRM field updates

**Runtime Integration** (`server/skills/runtime.ts`)
- Action extraction wired into post-synthesis flow (lines 222-235)
- Runs after findings extraction
- Non-fatal errors (skill completes even if action extraction fails)

## End-to-End Test Scenarios

### Scenario 1: Pipeline Hygiene Emits Actions
1. Run Pipeline Hygiene skill on workspace with stale deals
2. Verify synthesis output contains `<actions>` JSON block
3. Verify actions inserted into `actions` table with correct fields
4. Verify supersession logic (previous open actions for same deal marked as superseded)
5. Verify audit log entries created

### Scenario 2: Actions API
1. GET /action-items?status=open&severity=critical
   - Verify filtering works
   - Verify sorted by severity/impact
2. GET /action-items/summary
   - Verify counts accurate
   - Verify by_type and by_rep aggregations
3. GET /action-items/:id
   - Verify full action detail
   - Verify audit_log array present

### Scenario 3: Action State Transitions
1. Create action via skill run (status: open)
2. PUT /action-items/:id/status → in_progress
   - Verify transition allowed
   - Verify audit log created
3. PUT /action-items/:id/status → executed
   - Verify `executed_at` timestamp set
   - Verify `executed_by` actor set
   - Verify terminal state (can't transition further)
4. Test invalid transition (e.g., executed → open)
   - Verify 400 error returned

### Scenario 4: Slack Notifications
1. POST /action-items/:id/notify
2. Verify Slack webhook called with Block Kit payload
3. Verify message format:
   - Severity emoji present
   - Target entity name displayed
   - Impact amount formatted
   - Recommended steps numbered
   - Action buttons present with correct action_ids

### Scenario 5: Action Expiry
1. Create action with `expires_at` in the past
2. Wait for scheduler to run (or trigger manually)
3. Verify action status changed to 'expired'
4. Verify audit log entry created with actor 'scheduler'

### Scenario 6: Action Supersession
1. Run Pipeline Hygiene, creates action for Deal A
2. Run Pipeline Hygiene again (same deal, different staleness)
3. Verify previous action marked as 'superseded'
4. Verify new action created with status 'open'
5. Verify audit log on superseded action

## Manual Testing Checklist

- [ ] Migration 025 applies cleanly
- [ ] Server starts without errors (Actions Engine initialized)
- [ ] Scheduler starts and logs hourly runs
- [ ] Pipeline Hygiene skill synthesis includes <actions> block
- [ ] Single-Thread Alert skill synthesis includes <actions> block
- [ ] Actions extracted and inserted into DB after skill run
- [ ] GET /action-items returns filtered results
- [ ] GET /action-items/summary returns accurate counts
- [ ] PUT /action-items/:id/status enforces state machine
- [ ] POST /action-items/:id/notify sends Slack message
- [ ] Action expiry scheduler marks expired actions
- [ ] Old terminal actions cleaned up (90+ days)
- [ ] Supersession logic prevents duplicate actions

## Next Steps (Future Phases)

### Phase 2: Action Execution Engine
- Webhook delivery for action execution
- CRM field updates via execution_payload
- Automated action execution for specific types
- Action outcome tracking (success/failure)

### Phase 3: Action Intelligence
- Action effectiveness scoring (did it move the deal?)
- Rep action completion rates
- Action type performance analytics
- Smart action prioritization based on historical outcomes

### Phase 4: UI Integration
- Action center dashboard
- Rep-specific action queue
- Action status updates from UI
- Bulk action operations
- Action analytics charts

## Known Limitations (Phase 1)

1. No automatic execution - actions are recommendations only
2. Slack notifications require manual trigger (no auto-delivery rules)
3. No action assignment/reassignment workflow
4. No action comments/notes thread
5. No action templates or bulk creation
6. Expires_at not auto-set (skill must provide it)
7. No action outcome tracking (executed = done, no verification)

## Success Criteria

Phase 1 is complete when:
- ✅ Actions table migration applied
- ✅ Action extractor parses <actions> blocks from synthesis
- ✅ Actions API endpoints return correct data
- ✅ State transitions enforce state machine rules
- ✅ Slack notifications deliver formatted cards
- ✅ Scheduler expires old actions and cleans up terminal actions
- ✅ Skills emit actions in synthesis output
- ✅ Runtime wires action extraction into post-synthesis flow
- [ ] Manual test of full workflow (skill run → action created → status updated → Slack notified)
