# Pandora Consultant Call Intelligence — Part B: UI + Wiring

## For: Replit
## Effort: 3-4 hours
## Depends on: Part A (Claude Code — APIs must be deployed first), Multi-Workspace Dashboard, Demo Mode

---

## Context

Claude Code has built the backend for consultant call intelligence:
- `consultant_connectors` table + CRUD API
- `consultant_call_assignments` table + distribution engine
- 4-tier auto-matching (email → calendar → transcript → manual)
- Skill context injection for consultant calls
- API endpoints at `/api/consultant/...`

**You are building the frontend: connector setup, triage UI, and visibility guards.**

**Before starting:** Verify the APIs exist by checking:
- `GET /api/consultant/connectors` — should return (possibly empty) array
- `GET /api/consultant/calls/unassigned` — should return (possibly empty) calls list
- `GET /api/consultant/calls/stats` — should return distribution stats

If these endpoints don't exist yet, stub the UI against mock data and wire up when APIs are ready.

---

## Task 1: Consultant Connector Setup

### Location

On the Connectors page, add a section at the TOP — visible only when user has access to multiple workspaces.

### Visibility Guard

```typescript
const { workspaces } = useWorkspaces(); // or however workspace list is accessed
const isConsultant = workspaces && workspaces.length > 1;

// Don't render consultant section for single-workspace users
if (!isConsultant) return null;
```

### UI — No Connector Yet

```
Your Accounts
─────────────────────────────────────────
Connect your personal recording account to automatically 
distribute calls across your client workspaces.

[+ Connect Fireflies]
```

### UI — Connected

```
Your Accounts
──────────────────────────────────────────────────────
┌────────────────────────────────────────────────────┐
│ 🎙️ Fireflies (Personal)         Connected ✅      │
│                                                    │
│ Last sync: 2 hours ago  •  156 calls synced        │
│ Auto-assigned: 142 (91%)  •  Unassigned: 3         │
│                                                    │
│                           [Sync Now]  [Disconnect] │
└────────────────────────────────────────────────────┘
```

### Connect Flow

"Connect Fireflies" opens a modal:

```
┌──────────────────────────────────────────────────┐
│ Connect Personal Fireflies Account               │
│                                                  │
│ This syncs YOUR calls and automatically assigns  │
│ them to the correct client workspace using        │
│ participant emails, calendar matching, and        │
│ transcript analysis.                             │
│                                                  │
│ Fireflies API Key                                │
│ ┌──────────────────────────────────────────────┐ │
│ │                                              │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ Find your API key at:                            │
│ app.fireflies.ai → Settings → Integrations      │
│                                                  │
│                     [Cancel]  [Connect & Sync]   │
└──────────────────────────────────────────────────┘
```

"Connect & Sync" calls `POST /api/consultant/connectors` and shows a loading state while the initial sync + distribution runs. After completion, show a summary toast:

```
✅ Connected! 47 calls synced — 42 auto-assigned, 5 need your review
```

### Sync Now

Calls `POST /api/consultant/connectors/:id/sync`. Shows inline spinner on the button. After completion, update the stats.

### Disconnect

Confirmation modal: "Disconnect your personal Fireflies? Previously synced calls will remain in their assigned workspaces."

Calls `DELETE /api/consultant/connectors/:id`.

---

## Task 2: Triage UI on Consultant Dashboard

### Location

On the Consultant Dashboard (Multi-Workspace Command Center), BELOW the workspace cards. Only visible if there are unassigned calls.

### Data Fetching

```typescript
// Fetch unassigned calls
const { data: unassigned } = useQuery(
  '/api/consultant/calls/unassigned',
  { enabled: isConsultant }
);

// Don't render section if no unassigned calls
if (!unassigned?.calls?.length) return null;
```

### UI

```
─────────────────────────────────────────────────────
📞 Unassigned Calls (3)

Calls that couldn't be automatically matched to a workspace.

┌─────────────────────────────────────────────────────┐
│ "Q1 Strategy Discussion"           Feb 14, 2:30 PM  │
│ 45 min  •  No participant emails                     │
│                                                      │
│ "...so the main thing we need to figure out for      │
│ next quarter is whether the current pipeline..."     │
│                                                      │
│ Assign to: [ Select workspace ▾ ]    [Assign] [Skip] │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ "Weekly Planning Call"             Feb 12, 10:00 AM  │
│ 30 min  •  2 participants (no email match)           │
│                                                      │
│ "...let's review the pipeline, I think the Acme      │
│ deal is stalling because..."                         │
│                                                      │
│ 💡 Suggested: GrowthBook (transcript mentions deals) │
│ Assign to: [ GrowthBook    ▾ ]      [Assign] [Skip] │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ "Internal Notes"                   Feb 11, 4:00 PM   │
│ 12 min  •  Solo recording                            │
│                                                      │
│ "...memo to self about the onboarding timeline..."   │
│                                                      │
│ Assign to: [ Select workspace ▾ ]    [Assign] [Skip] │
└─────────────────────────────────────────────────────┘
```

### Card Details

Each triage card shows:

1. **Call title** — from the conversation record
2. **Date and duration**
3. **Why it wasn't matched:**
   - "No participant emails" (silent recording or no email metadata)
   - "N participants (no email match)" (had emails but none matched any CRM)
   - "Matched 2+ workspaces" (ambiguous — Tier 1 or 3 found multiple)
   - "Solo recording" (only one participant — the consultant)
4. **Transcript preview** — first 120 characters of transcript or summary. Truncate with "..."
5. **Suggestion** (if available): If `candidate_workspaces` has entries, show the top candidate with the reason. Pre-select that workspace in the dropdown.
6. **Workspace dropdown** — lists all consultant's workspaces. If a suggestion exists, pre-select it.
7. **Assign button** — calls `POST /api/consultant/calls/:id/assign` with selected workspace_id
8. **Skip button** — opens a small popover with options:
   - "Internal meeting" → calls skip with reason `internal`
   - "Personal / irrelevant" → calls skip with reason `personal`
   
   After skip, card animates out of the list.

### Interactions

- **Assign:** Button shows spinner → call `POST /api/consultant/calls/:conversationId/assign` → card animates out → update unassigned count in section header → show brief toast: "Assigned to GrowthBook"
- **Skip:** Popover → select reason → card animates out → show brief toast: "Skipped"
- **Optimistic update:** Remove card immediately, rollback if API fails
- **Empty state:** When all calls are assigned/skipped, the entire section disappears (or shows "All caught up ✅" briefly, then fades)

---

## Task 3: Distribution Stats (Optional — Build If Time Allows)

On the Consultant Dashboard, add a small stats summary near the connector card or as a tooltip/expandable:

```
📊 Call Distribution
142 auto-assigned (91%)
  • 98 via email match
  • 12 via calendar
  • 32 via transcript scan
11 manually assigned
3 skipped
```

Source: `GET /api/consultant/calls/stats`

This is informational — helps Jeff see how well the auto-matching is working. If Tier 3 transcript scan is catching most silent recordings, he knows the system is working even without emails.

---

## Task 4: Demo Mode Integration

Everything in the triage UI must respect Demo Mode:

```typescript
const { anon, isDemoMode } = useDemoMode();
```

- **Call titles:** Could contain client names. Pass through `anonymizeText()`.
- **Transcript previews:** Pass through `anonymizeText()`.
- **Workspace names in dropdown:** Pass through `anon.workspace()`.
- **Suggestion text:** "Suggested: GrowthBook" → "Suggested: [anonymized name]"
- **Stats:** Numbers stay real. Method names stay real.

---

## Task 5: Visibility Guards

Apply the consultant check everywhere:

```typescript
const isConsultant = workspaces && workspaces.length > 1;
```

Places to guard:
1. **Connectors page** — "Your Accounts" section: `if (!isConsultant) return null`
2. **Consultant Dashboard** — "Unassigned Calls" section: `if (!isConsultant) return null`
3. **Sidebar** — "All Clients" nav item (already guarded from Multi-Workspace Dashboard prompt)

**Single-workspace users should see zero changes to their experience.**

---

## Task 6: Notification Badge

If there are unassigned calls, show a small badge on the "All Clients" sidebar nav item:

```
📊 All Clients  [3]
```

The badge shows the count of unassigned calls. Fetch from the existing unassigned endpoint or a lightweight count endpoint.

When all calls are assigned, the badge disappears.

---

## Verification

1. **Single-workspace user:** No consultant features visible anywhere — Connectors page looks normal, no "All Clients" nav, no triage UI.
2. **Multi-workspace user, no connector:** "Your Accounts" section shows on Connectors page with "Connect Fireflies" button. No triage section on dashboard.
3. **Connect Fireflies:** Modal opens, enter API key, "Connect & Sync" runs, loading state, completion toast with summary.
4. **After sync:** Connector card shows stats (calls synced, auto-assigned, unassigned).
5. **Triage UI:** Unassigned calls appear on Consultant Dashboard below workspace cards.
6. **Suggestion:** Calls with candidate workspaces show "Suggested: [workspace]" with pre-selected dropdown.
7. **Assign:** Select workspace, click Assign → card animates out, toast confirms, workspace call count updates.
8. **Skip:** Click Skip → reason popover → select → card animates out.
9. **All caught up:** Last card assigned → section disappears or shows "All caught up."
10. **Demo Mode on:** All names in triage cards anonymized. Workspace dropdown shows fake names. Transcript preview anonymized.
11. **Badge:** "All Clients" nav shows unassigned count badge. Badge disappears when queue is empty.

---

## What NOT to Build

- Full transcript viewer (click to open in Fireflies for now)
- Bulk assign/skip (one at a time is fine for 3-5 stragglers per week)
- Gong consultant connector setup (Fireflies only)
- Re-assignment from workspace conversation list
- Connector health monitoring for consultant connector (reuse workspace connector health patterns later)
- Calendar connection UI (Tier 2 just works if calendar data exists, no setup needed)
