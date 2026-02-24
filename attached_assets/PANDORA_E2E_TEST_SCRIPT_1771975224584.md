# Pandora End-to-End Test Script

Run these tests in order. Each builds on the previous.
Log results as you go — PASS / FAIL / ISSUE noted.

Estimated time: 60-90 minutes

---

## Pre-flight (5 min)

- [ ] Verify app is running and you can log in
- [ ] Verify you can switch between workspaces (Frontera, Imubit, GrowthBook, GrowthX)
- [ ] Pick **Frontera** as primary test workspace (HubSpot — most data, safest to test)

---

## Test 1: Command Center Home (10 min)

Open Command Center for Frontera.

**Metrics Row:**
- [ ] All 5 metric cards load with real numbers (not $0 or NaN)
- [ ] Click "Show Math" on Total Pipeline → formula + deal count appear
- [ ] Click "Show Math" on Win Rate → formula + won/lost counts appear
- [ ] Click "Show Data" → deals table opens with actual deal rows
- [ ] CSV export downloads a real file
- [ ] Toggle a metric card off via gear icon → card disappears
- [ ] Refresh page → card is still hidden (preference persisted)
- [ ] Toggle it back on

**Pipeline Chart:**
- [ ] Horizontal bars show stages with amounts
- [ ] At least one stage has an AI flag/annotation (e.g., "X deals stale")
- [ ] Clicking a stage or flag does something (navigates or expands)
- [ ] Funnel/Kanban/Table buttons show "Coming soon" (not crash)

**Actions Widget:**
- [ ] Shows severity counts (critical/warning/info) with numbers
- [ ] "View All Actions" navigates to Actions page
- [ ] Top action items listed with real deal names

**Signals Widget:**
- [ ] Shows signal type counts
- [ ] Hot accounts listed (or empty state if no signals yet)

**Findings Feed:**
- [ ] Shows recent skill findings with skill names and timestamps
- [ ] Severity badges display correctly

**Sections:**
- [ ] Collapse a section → collapse persists on refresh
- [ ] Change time range (This Week → This Month) → metrics update

**Issues found:**
```
1. 
2. 
3. 
```

---

## Test 2: Market Signals (15 min)

### 2A: Set API Key
- [ ] Confirm SERPER_API_KEY (or SERPER_DEV_API_KEY) is set in Replit secrets
- [ ] If not set: add it now, restart server

### 2B: Single Account Scan via API
Pick a Frontera account with an active deal > $25K:

```bash
# Find a good test account
# Use the app's Accounts page, or:
curl -s "https://YOUR_APP_URL/api/workspaces/FRONTERA_WORKSPACE_ID/accounts?limit=5&sort=deal_amount_desc" | jq '.[] | {id, name}'
```

Trigger a scan:
```bash
curl -X POST "https://YOUR_APP_URL/api/workspaces/FRONTERA_WS_ID/accounts/ACCOUNT_ID/scan-signals" \
  -H "Content-Type: application/json" \
  -b "YOUR_SESSION_COOKIE"
```

- [ ] API returns 200 with { account_name, signals_found, composite_score }
- [ ] signals_found > 0 (or 0 is OK if the company is very small/niche)
- [ ] No server crash or 500 error

### 2C: Verify Signals in UI
- [ ] Navigate to the scanned account's detail page
- [ ] AccountSignalsTimeline shows the new market signal(s)
- [ ] Signal cards display: type icon, title, severity, source, date
- [ ] If no signals found: empty state message (not blank screen)

### 2D: Chat Tool Test
- [ ] Open Ask Pandora chat
- [ ] Type: "What's the latest news about [account name you just scanned]?"
- [ ] Chat invokes enrich_market_signals tool
- [ ] Response includes signal summaries

### 2E: Batch Scan (optional, costs ~$0.25)
```bash
curl -X POST "https://YOUR_APP_URL/api/workspaces/FRONTERA_WS_ID/signals/batch-scan" \
  -H "Content-Type: application/json" \
  -d '{"limit": 5, "min_deal_amount": 25000}' \
  -b "YOUR_SESSION_COOKIE"
```

- [ ] Returns { accounts_scanned, total_signals, total_cost_usd }
- [ ] No errors in the errors array

**Issues found:**
```
1. 
2. 
3. 
```

---

## Test 3: Actions Queue (10 min)

Navigate to the Actions page.

### 3A: Actions Display
- [ ] Actions load (should see some of the 432 actions)
- [ ] Each action card shows: severity badge, title, deal name, impact amount
- [ ] Filters work: filter by severity → list updates
- [ ] Filter by action type → list updates
- [ ] Summary cards at top show correct counts

### 3B: Status Transitions
Pick a low-priority INFO action (something you don't mind changing):
- [ ] Click "Mark In Progress" → status changes, card updates
- [ ] Click "Snooze" → pick a duration → action disappears from open list
- [ ] Click "Dismiss" → asks for reason → enters reason → action dismissed

### 3C: Action Card for CRM-Writable Type
Find an action with type: update_close_date, close_stale_deal, or clean_data:
- [ ] "Execute in CRM" button is visible (not grayed out)
- [ ] Click it → ExecutionDialog opens
- [ ] Loading state shows while preview fetches

**If preview loads:**
- [ ] Shows current CRM values (fetched live from HubSpot)
- [ ] Shows proposed new values
- [ ] CRM deep link is clickable (opens HubSpot in new tab)
- [ ] Proposed values are editable (input fields)
- [ ] Audit note preview shows
- [ ] **CLICK CANCEL — do not execute yet**

**If preview fails:**
- [ ] Note the error message
- [ ] Common issues: token expired (reconnect HubSpot), missing external_id, no CRM connected

### 3D: Non-Writable Action
Find a notify_rep or escalate_deal action:
- [ ] Execute button is disabled with tooltip "doesn't write to CRM"

**Issues found:**
```
1. 
2. 
3. 
```

---

## Test 4: Account & Deal Detail Pages (10 min)

### 4A: Account Detail
Navigate to an account with deals and signals:
- [ ] Account page loads with account info
- [ ] AccountScorecard shows ICP score + breakdown (if scored)
- [ ] AccountSignalsTimeline shows signals (from Test 2 or prior data)
- [ ] Signal filter dropdowns work (category, priority)

### 4B: Deal Detail
Navigate to a deal from the Actions page (click a deal name):
- [ ] Deal page loads
- [ ] DealIntelligencePanel shows (if wired):
  - Active actions for this deal
  - Recent findings
  - Stakeholder list with contacts
- [ ] If DealIntelligencePanel isn't wired yet: note this as a gap

**Issues found:**
```
1. 
2. 
3. 
```

---

## Test 5: Signals & Actions on Command Center (5 min)

Go back to Command Center. After Test 2 (market signals), the data should be richer.

- [ ] Signals Widget now shows the signals you just created
- [ ] If you scanned 5 accounts, signal counts should be higher
- [ ] Hot accounts list includes the accounts you scanned
- [ ] Actions widget still shows correct counts after Test 3 status changes

---

## Test 6: Cross-Workspace Sanity (5 min)

Switch to **Imubit** workspace (Salesforce):
- [ ] Command Center loads with Imubit data (different pipeline, different numbers)
- [ ] Metrics show Imubit's pipeline (should be much larger — $148M+ in deals)
- [ ] Actions show Imubit's actions (different from Frontera)
- [ ] Switching back to Frontera → Frontera data returns

Switch to **GrowthBook** or **GrowthX** (HubSpot):
- [ ] Command Center loads (may have less data — that's fine)
- [ ] No crashes or cross-workspace data leakage

---

## Test 7: CRM Write-Back — Live Test (10 min)

**⚠️ Only do this if you're comfortable writing to a real HubSpot workspace.**
**Pick a LOW-VALUE test deal that you can safely modify.**

### Option A: Safe Test — Create a Test Deal First
1. In HubSpot, create a test deal: "Pandora Test Deal" with amount $1, stage Discovery
2. Wait for next sync (or trigger manual sync)
3. Find the test deal in Pandora
4. Find or create an action for it
5. Execute → verify HubSpot updates
6. Delete the test deal from HubSpot after

### Option B: Test on Real Deal (careful)
1. Find a stale, low-value deal that genuinely needs a close date update
2. Click Execute in CRM on its action
3. Preview shows current values → verify they match HubSpot
4. Modify the proposed value if needed
5. Click "Confirm & Execute"
- [ ] Success toast appears
- [ ] Action status changes to "executed"
- [ ] Go to HubSpot → verify the field actually changed
- [ ] Verify audit note was created on the deal in HubSpot

**If execution fails:**
- [ ] Error message is helpful (not generic "something went wrong")
- [ ] Note the error for debugging

**Issues found:**
```
1. 
2. 
3. 
```

---

## Results Summary

After completing all tests, tally:

| Test Area | Pass | Fail | Issues |
|-----------|------|------|--------|
| Command Center Home | /14 | | |
| Market Signals | /5 | | |
| Actions Queue | /10 | | |
| Account & Deal Pages | /5 | | |
| CC Data Refresh | /4 | | |
| Cross-Workspace | /3 | | |
| CRM Write-Back | /4 | | |
| **Total** | **/45** | | |

**Critical issues (blocking):**
```
1. 
2. 
```

**Medium issues (should fix before client demo):**
```
1. 
2. 
```

**Low issues (polish, can wait):**
```
1. 
2. 
```

**Things that worked better than expected:**
```
1. 
2. 
```

---

## What to Do With Results

- **40+ pass:** You're demo-ready. Fix medium issues, then start showing clients.
- **30-39 pass:** Solid foundation. Fix critical + medium, then demo.
- **20-29 pass:** Needs a focused bug-fix session before demoing.
- **Under 20:** Something systemic is broken. Share the results and we'll triage.

Bring the filled-out results back and we'll prioritize fixes.
