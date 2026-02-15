# Pandora — Deal & Account Detail Page Polish

## Context

The deal detail and account detail pages already exist and render real dossier data. This prompt fixes 5 specific issues on each page. Do NOT rebuild these pages — only modify the specific sections described below.

**Available API endpoints (all require Bearer token auth):**
```
GET  /api/workspaces/:id/deals/:dealId/dossier
GET  /api/workspaces/:id/deals/:dealId/risk-score
GET  /api/workspaces/:id/accounts/:accountId/dossier
GET  /api/workspaces/:id/pipeline/risk-summary
PATCH /api/workspaces/:id/findings/:findingId/resolve   body: { resolution_method }
POST /api/workspaces/:id/analyze   body: { question, scope: { type, entity_id } }
```

**Severity display mapping:** Database uses `act/watch/notable/info`. Display as: act → "Critical" (red), watch → "Warning" (yellow/orange), notable → "Notable" (blue), info → "Info" (gray).

---

## Fix 1: Stage History Showing Raw IDs Instead of Stage Names

**Problem:** The Stage History timeline on the deal detail page shows raw pipeline_stage_id values like "1169886066" instead of human-readable stage names like "Qualification" or "Negotiation".

**Root cause:** The stage_history entries from the dossier contain a `stage_id` or `pipeline_stage_id` but the component renders that ID directly instead of the stage name.

**Fix approach:**

The dossier response should include stage names in the stage_history array. Check what the dossier actually returns:

```typescript
// If stage_history entries look like:
{ stage_id: "1169886066", entered_at: "2025-09-16", duration_days: 0.02 }

// They need to display the stage NAME, not the ID.
```

**Option A — Backend already includes stage names:** Check if each stage_history entry has a `stage_name` or `stage` field. If yes, render that field instead of the ID.

**Option B — Backend only has IDs:** The dossier response likely includes the deal's pipeline stages somewhere (or the deal object has stage mapping). Cross-reference the stage_id against available stage data. If no stage mapping exists in the dossier response, query the deal's pipeline stages:
- Check if `GET /api/workspaces/:id/deals/:dealId` returns the full deal with stage name
- Or check if the deals table has a `deal_stage` or `stage_name` column

**Option C — Quick fallback:** If no stage name mapping is available, at minimum show the current stage name (from the deal header, which already displays "Negotiation" correctly) for the most recent entry, and show relative labels like "Previous Stage" for older entries. This is better than raw IDs.

**The component should render:**
```
Stage History
─── Qualification (12d) ──→ Proposal (8d) ──→ Negotiation (current)
    Sep 1, 2025              Sep 13, 2025       Sep 21, 2025
```

Not:
```
1169886066
Sep 16, 2025 · 0.02d

1169886068
Sep 16, 2025
```

---

## Fix 2: Health Indicators Showing Dashes

**Problem:** The Activity and Threading health indicators in the deal header show "-" instead of actual values.

**Root cause:** The component is looking for health fields at the wrong path in the dossier response, or the field names don't match what the backend returns.

**Fix approach:**

1. Console.log the full dossier response to see the actual shape of the health/signals data
2. The dossier assembler returns health indicators in a structure like:
```typescript
{
  health: {
    threading_status: "multi" | "single" | "none",
    thread_count: 3,
    activity_recency: "active" | "stale" | "dark",
    days_since_activity: 5,
    stage_velocity: "on_track" | "slow" | "stalled",
    days_in_stage: 14,
    overall: "healthy" | "at-risk" | "critical"
  }
}
```

3. Map the component's field references to match the actual response structure. The fields might be nested under `health`, `health_indicators`, `signals`, or at the top level of the dossier.

**Display format for each indicator:**

| Indicator | Value | Color |
|-----------|-------|-------|
| Threading | "Multi (3)" / "Single" / "None" | green / yellow / red |
| Activity | "Active (5d)" / "Stale (21d)" / "Dark (45d)" | green / yellow / red |
| Stage Velocity | "On Track (14d)" / "Slow (30d)" / "Stalled (60d)" | green / yellow / red |
| Overall | "Healthy" / "At Risk" / "Critical" | green / yellow / red |

If a field is genuinely missing from the dossier (not all deals have conversation data), show "N/A" with a gray dot instead of "-".

---

## Fix 3: Add Risk Score Badge to Deal Header

**Problem:** The deal header shows name, amount, stage, owner, and close date but no health score — even though `/deals/:dealId/risk-score` returns a 0-100 score with letter grade.

**Fix:**

1. On the deal detail page, make an additional API call to `GET /api/workspaces/:id/deals/:dealId/risk-score` in parallel with the dossier call
2. Add the risk score badge to the header area, next to or below the deal name:

```
Aria Behavior Analysis LLC - Fellowship Deal
$84K    [Negotiation]                    Health: [B] 78
Owner: Sara Bollman    Close: Sep 15, 2025
```

**Badge styling:**
- Letter grade in a colored pill/badge
- A (90-100): green background
- B (75-89): blue/teal background  
- C (50-74): yellow background
- D (25-49): orange background
- F (0-24): red background
- Score number next to the letter in smaller text

**If the risk-score endpoint returns an error or no data**, don't show the badge at all — don't show "—" or break the header layout.

---

## Fix 4: Add Resolve/Dismiss Button to Findings

**Problem:** Active Findings are displayed but there's no way to dismiss/resolve them from the UI. The `PATCH /api/workspaces/:id/findings/:findingId/resolve` endpoint is ready.

**Fix:**

Add a dismiss/resolve button to each finding in the Active Findings section:

```
● Aria Behavior Analysis LLC - Fellowship Deal ($84K)     [Dismiss ✕]
  has only 1 contact — rep_not_prospecting
  single-thread-alert · yesterday
```

**Button behavior:**
1. Click "Dismiss" → call `PATCH /api/workspaces/:id/findings/:findingId/resolve` with body `{ "resolution_method": "user_dismissed" }`
2. While the request is in flight, show a spinner on the button
3. On success: animate the finding out of the list (fade out or slide up). Decrement the findings count.
4. On 409 (already resolved): remove the finding from the list silently
5. On error: show a brief toast/notification "Failed to resolve finding" and keep the finding visible

**Optional enhancement:** Add a small dropdown on the dismiss button with three options:
- "Dismiss" → `user_dismissed`
- "Action Taken" → `action_taken`  
- "Not Relevant" → `user_dismissed`

But a simple single "Dismiss" button that sends `user_dismissed` is the minimum viable version. Ship that first.

---

## Fix 5: Add "Ask Pandora" Input

**Problem:** The scoped analysis endpoint (`POST /analyze`) is ready but there's no UI to use it on the deal or account detail pages.

**Fix:**

Add an "Ask Pandora" section at the bottom of both the deal detail and account detail pages:

```
┌─────────────────────────────────────────────────────────┐
│  🔮 Ask Pandora about this deal                         │
│  ┌───────────────────────────────────────────┐ [Ask]   │
│  │ e.g. "What are the biggest risks?"        │         │
│  └───────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────┘
```

**Behavior:**

1. Text input with placeholder text:
   - Deal page: "Ask about this deal... e.g. 'What are the biggest risks?'"
   - Account page: "Ask about this account... e.g. 'How healthy is this relationship?'"

2. Submit on Enter key or click "Ask" button

3. On submit → `POST /api/workspaces/:id/analyze` with body:
   ```json
   {
     "question": "<user's question>",
     "scope": {
       "type": "deal",        // or "account" for account detail
       "entity_id": "<dealId or accountId>"
     }
   }
   ```

4. While waiting: show a subtle loading state (pulsing dots or skeleton text). Disable the input.

5. On response: display the answer in an expandable panel below the input:
   ```
   ┌─────────────────────────────────────────────────────┐
   │  Pandora's analysis:                                │
   │                                                     │
   │  This deal has two primary risks: single-threaded   │
   │  contact (only 1 stakeholder engaged) and stale     │
   │  activity (no touchpoints in 14 days). The close    │
   │  date of Sep 15 is approaching with no recent       │
   │  negotiation activity...                            │
   │                                                     │
   │  ───────────────────────────────────────────────    │
   │  📊 Data consulted: 1 deal, 4 contacts, 1 finding  │
   │  ⚡ 847 tokens · 1.2s                               │
   └─────────────────────────────────────────────────────┘
   ```

6. Show metadata line at the bottom with tokens used and latency from the response's `tokens_used` and `latency_ms` fields. Also show `data_consulted` if present.

7. Allow asking follow-up questions — each new answer replaces the previous one (don't accumulate a chat history, this isn't a chatbot).

8. **Rate limit handling:** The endpoint has a 10 requests/hour limit per workspace. If the API returns 429, show: "Analysis limit reached. Try again in a few minutes."

---

## Fix 6: Account Detail Page — Same Treatment

Apply the same fixes to the account detail page (`/accounts/:accountId`):

1. **Relationship health indicators** — the agent already fixed data alignment for `overall health status, engagement trend, and coverage gap warnings`. Verify these actually render with colored indicators, not raw text or dashes.

2. **Risk score** — if the account dossier includes a health rating, show it as a badge in the header. If not, skip (account risk scoring may not have a dedicated endpoint like deals do).

3. **Resolve button on findings** — same dismiss button pattern as deal findings.

4. **Ask Pandora** — same input pattern, but with `scope.type: "account"` and `scope.entity_id: accountId`.

5. **Deal links** — verify that deals listed in the account dossier are clickable and navigate to `/deals/:dealId`. If they're plain text, wrap them in links.

---

## Build Order

1. Fix 1 (stage names) — diagnose the actual data shape first, then fix
2. Fix 2 (health indicators) — same diagnostic approach
3. Fix 3 (risk score badge) — add API call + badge component
4. Fix 4 (resolve button) — add button + API call + animation
5. Fix 5 (Ask Pandora) — add input + API call + response display
6. Fix 6 (account parity) — apply fixes 1-5 to account detail

## Verification

After all fixes, the deal detail page for any deal with findings should show:
- ✅ Stage names (not IDs) in the Stage History timeline
- ✅ Health indicator dots with values (not dashes)
- ✅ Risk score letter grade badge in the header
- ✅ "Dismiss" button on each active finding that works when clicked
- ✅ "Ask Pandora" input at the bottom that returns an AI analysis
- ✅ No JS console errors

## What NOT to Do

- Don't rebuild the page layout — it's correct
- Don't change the header design, Coverage Gaps section, Contacts section, or Conversations section — they work
- Don't add navigation, routing, or sidebar changes
- Don't add WebSocket real-time updates
- Don't modify any other pages
