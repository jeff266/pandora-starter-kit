# Pandora Phase B — Fix Broken Pages + Build Detail Views

## Context

The frontend shell is already built and working: sidebar navigation with live badges, workspace selector, routing for all pages, Command Center home with metric cards, Insights Feed with severity filters, Actions page with finding table, Connectors page with status cards. The design system (dark theme, color palette, component patterns) is established and correct.

This prompt fixes the three broken pages and builds the two highest-value missing pieces: deal/account detail views with dossier data.

**Do NOT rebuild or modify:** sidebar, routing, workspace selector, Command Center home, Insights Feed, Actions, Connectors. These work. Leave them alone.

**API endpoints available** (all require Bearer token auth):
```
GET  /api/workspaces/:id/findings?severity=&skill_id=&owner=&deal_id=&account_id=&resolved=&limit=&offset=
GET  /api/workspaces/:id/findings/summary
GET  /api/workspaces/:id/pipeline/snapshot
PATCH /api/workspaces/:id/findings/:findingId/resolve   body: { resolution_method }
GET  /api/workspaces/:id/deals
GET  /api/workspaces/:id/deals/:dealId
GET  /api/workspaces/:id/deals/:dealId/dossier?narrative=true
GET  /api/workspaces/:id/deals/:dealId/risk-score
GET  /api/workspaces/:id/accounts
GET  /api/workspaces/:id/accounts/:accountId
GET  /api/workspaces/:id/accounts/:accountId/dossier?narrative=true
GET  /api/workspaces/:id/pipeline/risk-summary
GET  /api/workspaces/:id/contacts
GET  /api/workspaces/:id/conversations
GET  /api/workspaces/:id/skills
GET  /api/workspaces/:id/skills/:skillId/runs
POST /api/workspaces/:id/skills/:skillId/run
POST /api/workspaces/:id/analyze   body: { question, scope: { type, entity_id?, date_range?, filters? } }
GET  /api/workspaces/:id/connector-configs
```

**Severity values in the database:** `act`, `watch`, `notable`, `info`. The findings API also accepts `critical` (maps to `act`) and `warning` (maps to `watch`). Use the display-friendly names in the UI: "Critical" for act, "Warning" for watch, "Notable" for notable, "Info" for info.

---

## Task 1: Fix Broken Pages (30 min)

### 1a. Fix /deals — `value.toFixed is not a function`

The deals list page crashes because it calls `.toFixed()` on a null/undefined deal amount. 

**Fix:** Guard every numeric display with a null check. Amounts that are null should display as "—" not crash the page.

```typescript
// Pattern to use everywhere amounts or numbers are displayed:
{deal.amount != null ? `$${Number(deal.amount).toLocaleString()}` : '—'}

// Same for percentages, counts, days:
{value != null ? value.toFixed(1) : '—'}
```

Scan the entire deals page component for any `.toFixed()`, `.toLocaleString()`, or arithmetic on potentially null values. Fix all of them.

### 1b. Fix /skills — `Objects are not valid as React child`

The skills page tries to render a skill's `schedule` or `trigger` object directly as text. Objects can't be React children.

**Fix:** Serialize the schedule/trigger to a human-readable string:

```typescript
// If schedule is an object like { cron: '0 8 * * 1', trigger: 'on_demand' }
function formatSchedule(schedule: any): string {
  if (!schedule) return 'Manual only';
  if (typeof schedule === 'string') return schedule;
  
  const parts: string[] = [];
  if (schedule.cron) parts.push(describeCron(schedule.cron));
  if (schedule.trigger === 'on_demand') parts.push('On demand');
  if (schedule.trigger === 'on_sync') parts.push('After sync');
  
  return parts.join(' · ') || 'Manual only';
}

function describeCron(cron: string): string {
  // Simple human-readable cron descriptions
  if (cron === '0 8 * * 1') return 'Mondays 8 AM';
  if (cron === '0 8 * * *') return 'Daily 8 AM';
  if (cron === '0 7 * * *') return 'Daily 7 AM';
  if (cron === '0 16 * * 5') return 'Fridays 4 PM';
  return cron; // fallback to raw cron if no match
}
```

Also check: if any skill field (like `category`, `outputFormat`, `tools`) is an object or array, serialize it properly before rendering.

### 1c. Fix /members — Missing API route

The members page calls an endpoint that doesn't exist yet. For now, show a simple workspace members view.

**Option A (quick):** Change from "Coming soon" to display the current user (from auth context) as the only member, since RBAC isn't built yet:

```
Members
─────────────────────────
👤 Jeff          Admin        jeff@email.com
─────────────────────────
Single-user workspace. Team management coming soon.
```

**Option B (if the users table exists):** Query it and display all users for the workspace.

Check if there's a users/workspace_members table. If yes, build a simple list. If not, use Option A.

---

## Task 2: Deals List Page (1-2 hours)

The /deals route has the right idea but crashes on null data. After fixing the crash (Task 1a), enhance it into a proper deal table.

### Data source
`GET /api/workspaces/:id/deals` — returns array of deals with name, amount, stage, close_date, owner, etc.

Optionally also call `GET /api/workspaces/:id/pipeline/risk-summary` to get per-deal health scores.

### Layout

**Filter bar at top:**
- Stage dropdown (populated from distinct stages in the data)
- Owner/Rep dropdown (populated from distinct owners)
- Health filter: All | Healthy | At Risk | Critical
- Search input (filters by deal name, client-side)

**Table columns:**
| Deal Name | Amount | Stage | Owner | Close Date | Health | Days in Stage | Findings |
|---|---|---|---|---|---|---|---|

- **Deal Name** — clickable, navigates to `/deals/:dealId`
- **Amount** — formatted currency, "—" if null
- **Stage** — text with subtle stage color coding if available
- **Owner** — rep name or email
- **Close Date** — formatted date, red text if in the past
- **Health** — colored badge: green "A", yellow "B", orange "C", red "D"/"F" (from risk score if available, otherwise "—")
- **Days in Stage** — number, yellow if > 21, red if > 45
- **Findings** — count with severity color dot (e.g., "● 2 ● 1" for 2 act + 1 watch)

**Sorting:** Click column headers to sort. Default: sort by amount descending.

**Pagination:** If > 50 deals, paginate with simple Previous/Next buttons.

**Click row → navigate to `/deals/:dealId`** for the detail view (Task 4).

---

## Task 3: Accounts List Page (1-2 hours)

### Data source
`GET /api/workspaces/:id/accounts` — returns array of accounts.

### Layout

**Filter bar:**
- Industry dropdown (from distinct industries)
- Owner dropdown
- Search input (filters by account name or domain)

**Table columns:**
| Account Name | Domain | Industry | Open Deals | Pipeline Value | Contacts | Last Activity |
|---|---|---|---|---|---|---|

- **Account Name** — clickable, navigates to `/accounts/:accountId`
- **Domain** — as-is
- **Industry** — text
- **Open Deals** — count of associated open deals (if available in the data, otherwise "—")
- **Pipeline Value** — sum of open deal amounts
- **Contacts** — count
- **Last Activity** — relative date ("3 days ago", "2 weeks ago")

**Sorting:** Click column headers. Default: pipeline value descending.

**Click row → navigate to `/accounts/:accountId`** for the detail view (Task 5).

Note: The accounts endpoint may return limited data. If fields like deal counts or pipeline value aren't in the response, either make a secondary query or show "—". Don't crash on missing data.

---

## Task 4: Deal Detail / Dossier Page (3-4 hours)

This is the highest-value new page. It shows everything Pandora knows about a single deal.

### Route: `/deals/:dealId`

### Data sources (load in parallel):
1. `GET /api/workspaces/:id/deals/:dealId/dossier` — full dossier with contacts, conversations, findings, stage history, health signals
2. `GET /api/workspaces/:id/deals/:dealId/risk-score` — composite health score

### Page Layout

**Header row:**
```
← Back to Deals

[Deal Name]                                    Health: [A] 92/100
$220,000 · Evaluation · Close: Mar 15, 2025   Owner: Sarah Chen
```

Health badge uses the grade letter with color: A=green, B=yellow, C=orange, D/F=red. Show the numeric score next to it.

**Health signals row** (horizontal cards):
```
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Threading    │ │ Activity     │ │ Stage Vel.   │ │ Findings     │
│ Multi (3)    │ │ Active       │ │ On Track     │ │ 1⚠ 0🔴       │
│ 🟢           │ │ 🟢           │ │ 🟢           │ │ 🟡           │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

Colors: healthy = green, at-risk = yellow, critical = red. Use the `health` object from the dossier response.

**Active Findings panel:**
List of unresolved findings for this deal from `dossier.findings`. Each finding shows:
- Severity dot (red for act, yellow for watch, blue for notable)
- Message text
- Skill that produced it
- "Resolve" button → calls `PATCH /findings/:findingId/resolve` with `resolution_method: 'user_dismissed'`

**Contacts card:**
Table of contacts from `dossier.contacts`:
| Name | Title | Role | Engagement |
|---|---|---|---|
- Engagement shows "Active" (green), "Dark" (red), "Unknown" (gray) based on `engagement_status`

**Coverage Gaps** (from `dossier.coverage_gaps` if available):
Show any gaps like "No executive contacts", "3 of 4 contacts have no recent calls". Display as yellow/red alert banners.

**Conversations timeline:**
Reverse-chronological list from `dossier.conversations`:
```
📞 Feb 10 — Discovery Call (42 min)
   Participants: Sarah Chen, Jane Doe, Bob Smith
   Link method: participant_email [badge]
   
📞 Jan 28 — Follow-up (18 min)
   Participants: Sarah Chen, Jane Doe
   Link method: crm_metadata [badge]
```

Link method badges help users understand conversation attribution confidence: `crm_metadata` = high confidence (green), `participant_email` = medium (yellow), `domain_inferred` = low (orange), `manual` = user-verified (green).

**Stage History timeline** (from `dossier.stage_history`):
```
─── Qualification (12 days) ──→ Evaluation (22 days) ──→ [current]
```

Simple horizontal or vertical timeline showing stage progression with days in each stage.

**Ask Pandora** (bottom of page):
Text input: "Ask about this deal..."
On submit → `POST /analyze` with `{ question, scope: { type: 'deal', entity_id: dealId } }`
Show response in an expandable panel below the input. Show token count and latency in a subtle metadata line.

**Loading state:** Show skeleton cards for each section. Load sections independently — don't block the whole page if conversations are slow to load.

**Error handling:** If dossier returns missing_data (e.g., no conversations linked), show a subtle "No conversations linked to this deal" message in that section, not an error state.

---

## Task 5: Account Detail / Dossier Page (3-4 hours)

### Route: `/accounts/:accountId`

### Data source:
`GET /api/workspaces/:id/accounts/:accountId/dossier` — full account dossier

### Page Layout

**Header:**
```
← Back to Accounts

[Account Name]                          Relationship: Strong 🟢
acme.com · Software · 500 employees     Owner: Mike Chen
```

Relationship health from `dossier.relationship_health.overall`: strong=green, moderate=yellow, weak=red.

**Deal Summary cards** (from `dossier.deal_summary`):
```
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Open Deals   │ │ Open Pipeline│ │ Won Revenue  │ │ Avg Deal Size│
│ 3            │ │ $420K        │ │ $180K        │ │ $95K         │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

**Deals table** (from `dossier.deals`):
| Deal Name | Amount | Stage | Owner | Health | Close Date |
|---|---|---|---|---|---|
Each deal name links to `/deals/:dealId`.

**Contact Map** (from `dossier.contact_map` + `dossier.contacts`):
Show contacts grouped by seniority or role. Highlight engagement status.

Summary at top: "8 contacts: 2 executive, 3 manager, 3 IC — 5 engaged, 3 dark"

Table below:
| Name | Title | Role | Deals | Last Conversation | Status |
|---|---|---|---|---|---|

**Coverage Gaps** (from `dossier.relationship_health.coverage_gaps`):
Alert banners for each gap: "No executive contacts", "4 of 4 contacts have no recent calls"

**Conversations timeline** (from `dossier.conversations`):
Same format as deal dossier but grouped by deal:
```
Acme Enterprise License ($220K):
  📞 Feb 10 — Discovery Call (42 min)
  📞 Jan 28 — Follow-up (18 min)

Acme Expansion ($85K):
  📞 Feb 5 — Technical Review (55 min)
```

**Findings panel** (from `dossier.findings`):
All findings across all deals at this account. Group by deal name.

**Account Signals** (from `dossier.signals` if available):
List of detected signals from enrichment: "Product Launch", "New Partnership", etc. with signal scores.

**Ask Pandora:**
Text input: "Ask about this account..."
Scope: `{ type: 'account', entity_id: accountId }`

---

## Task 6: Skills Page Fix + Enhancement (1-2 hours)

After fixing the React child error (Task 1b), enhance the skills page:

### Data sources:
- `GET /api/workspaces/:id/skills` — list all registered skills
- `GET /api/workspaces/:id/skills/:skillId/runs` — run history for a skill

### Layout

**Skills grid/list:**
Each skill as a card:
```
┌─────────────────────────────────────────────────────┐
│ Pipeline Hygiene                        [Run Now ▶] │
│ Category: pipeline · Schedule: Mondays 8 AM         │
│ Last run: 2 hours ago · Duration: 4.2s              │
│ Findings: 12 act · 18 watch · 30 notable            │
└─────────────────────────────────────────────────────┘
```

**"Run Now" button:**
- POST `/api/workspaces/:id/skills/:skillId/run`
- Show loading spinner on the button during execution
- On completion, refresh the skill's last run info and show a toast notification
- On error, show error message in a toast

**Expandable run history:**
Click a skill card to expand and show the last 10 runs:
| Run ID | Started | Duration | Status | Findings |
|---|---|---|---|---|

---

## Build Order

1. **Task 1** — Fix three broken pages (30 min). Validate they load.
2. **Task 6** — Skills page enhancement (1 hour). Quick win, validates skill API.
3. **Task 2** — Deals list (1-2 hours). Table with filters, click-through ready.
4. **Task 3** — Accounts list (1-2 hours). Same pattern as deals.
5. **Task 4** — Deal dossier detail (3-4 hours). The showcase page.
6. **Task 5** — Account dossier detail (3-4 hours). Reuses patterns from deal detail.

Total: ~10-14 hours.

### After each task, verify:

**Task 1:** All three pages load without errors. No JS console errors.
**Task 2:** Deals table renders with real data. Null amounts show "—". Sorting works. Click navigates to detail.
**Task 3:** Accounts table renders. Search filters work. Click navigates to detail.
**Task 4:** Deal dossier loads all sections. Health signals display correctly. Resolve button works. Ask Pandora returns answers.
**Task 5:** Account dossier loads. Contact map renders. Deals link to deal detail.
**Task 6:** Skills list renders without error. Run Now triggers a skill and shows result.

---

## What NOT to Build

- Don't touch the sidebar, routing, or workspace selector — they work
- Don't rebuild Command Center home, Insights Feed, Actions, or Connectors — they work
- Don't build Agents, Agent Builder, Tools, Playbooks, Connector Health, Data Dictionary, Marketplace, Settings — leave as "Coming soon"
- Don't add WebSocket real-time updates — polling is fine
- Don't add keyboard shortcuts, animations, or dark/light toggle
- Don't make it mobile responsive — desktop-first
