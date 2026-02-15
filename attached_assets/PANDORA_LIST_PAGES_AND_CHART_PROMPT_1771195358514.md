# Pandora — List Pages & Command Center Completion

## Context

The drill-down flow is: Command Center → Deals/Accounts list → Deal/Account detail. The detail pages are now polished with dossier data, health scores, resolve buttons, and Ask Pandora. But the list pages in the middle are bare — they render data but lack filters, sorting, health indicators, and proper column layouts. The Command Center home also has an unfinished pipeline chart.

This prompt upgrades the four pages that sit between "landing" and "detail" so the full drill-down path works end to end.

**Do NOT modify:** sidebar, routing, workspace selector, deal detail page, account detail page, Insights Feed, Actions page, Connectors page. These work. Leave them alone.

**Available API endpoints:**
```
GET  /api/workspaces/:id/deals                         — all deals
GET  /api/workspaces/:id/deals/:dealId/risk-score      — single deal health score
GET  /api/workspaces/:id/pipeline/risk-summary         — batch health scores for all open deals
GET  /api/workspaces/:id/pipeline/snapshot              — pipeline by stage with finding annotations
GET  /api/workspaces/:id/accounts                       — all accounts
GET  /api/workspaces/:id/accounts/:accountId/dossier    — account detail with deal_summary
GET  /api/workspaces/:id/findings?deal_id=&account_id=&severity=&owner= — filtered findings
GET  /api/workspaces/:id/findings/summary               — headline counts by severity, skill, owner
GET  /api/workspaces/:id/skills                         — all registered skills
GET  /api/workspaces/:id/skills/:skillId/runs           — run history
POST /api/workspaces/:id/skills/:skillId/run            — trigger a skill run
```

**Severity display:** Database uses `act/watch/notable/info`. Display as: act → "Critical" (red dot ●), watch → "Warning" (orange dot ●), notable → "Notable" (blue dot ●), info → "Info" (gray dot ●).

**Risk score grades:** A (90-100) green, B (75-89) teal/blue, C (50-74) yellow, D (25-49) orange, F (0-24) red.

---

## Task 1: Deals List Page — `/deals` (3-4 hours)

The current page shows deal names and amounts in a basic table. It needs to become the primary working view for reps and managers.

### Data Loading

On page load, make two parallel API calls:
1. `GET /api/workspaces/:id/deals` — full deal list
2. `GET /api/workspaces/:id/pipeline/risk-summary` — batch health scores (returns array of `{ deal_id, score, grade, finding_counts }`)

Merge the risk data into the deals array client-side by matching on deal_id. Deals without a risk score get grade "—".

### Filter Bar

Row of filter controls above the table:

```
[Search deals...    🔍]  [Stage ▾ All]  [Owner ▾ All]  [Health ▾ All]  [Status ▾ Open]
```

- **Search** — text input, filters client-side by deal name (case-insensitive contains match). Debounce 300ms.
- **Stage** — dropdown populated from distinct `deal_stage` or `stage` values in the deals data. Options: "All", then each unique stage name.
- **Owner** — dropdown populated from distinct owner names/emails. Options: "All", then each unique owner.
- **Health** — dropdown: "All", "A", "B", "C", "D", "F". Filters on the grade from risk-summary.
- **Status** — dropdown: "Open" (default), "Won", "Lost", "All". Filter on `is_closed` or `status` field. Default to open deals only.

Filters are combinable — selecting Stage="Evaluation" + Owner="Sara" shows only Sara's deals in Evaluation.

Show a result count: "Showing 23 of 114 deals"

### Table Columns

| Column | Content | Width | Sort | Notes |
|--------|---------|-------|------|-------|
| Deal Name | Deal name as link | 25% | Alpha | Click navigates to `/deals/:dealId` |
| Amount | Currency formatted | 12% | Numeric desc default | Null → "—" |
| Stage | Stage name in text | 13% | Alpha | |
| Owner | Rep name or email | 13% | Alpha | Show first name + last initial if full name available |
| Close Date | Formatted date | 10% | Date | Red text if date is in the past and deal is still open |
| Health | Letter grade badge | 8% | By score | Colored badge: A=green, B=blue, C=yellow, D=orange, F=red, —=gray |
| Days in Stage | Number | 8% | Numeric | Yellow text if >21, red if >45. Show "—" if unavailable |
| Findings | Severity dot counts | 11% | By total count | e.g. "● 2 ● 1" meaning 2 critical + 1 warning. "—" if zero |

### Sorting

- Click any column header to sort. Click again to reverse.
- Show a sort indicator arrow (▲/▼) on the active column.
- Default sort: Amount descending.
- Secondary sort: deal name alpha when primary values are equal.

### Row Interaction

- Entire row is clickable → navigates to `/deals/:dealId`
- Subtle hover state (slightly lighter background)
- No checkboxes or multi-select needed

### Pagination

- If > 50 deals visible after filtering, paginate
- Simple "Showing 1-50 of 114" with Previous / Next buttons
- Or use infinite scroll if the existing pattern supports it

### Empty States

- No deals at all: "No deals found. Connect your CRM from the Connectors page."
- Filters return zero results: "No deals match your filters." with a "Clear filters" link.

### Loading State

- Show skeleton rows (8-10 rows of gray placeholder bars) while data loads
- Don't show the filter bar until data has loaded (so dropdowns can be populated)

---

## Task 2: Accounts List Page — `/accounts` (2-3 hours)

The current page shows 200 accounts with name and domain columns only. It needs the same treatment as deals.

### Data Loading

`GET /api/workspaces/:id/accounts` — full account list.

The accounts endpoint may not return deal counts or pipeline values directly. Check the actual response shape:
- If it includes `open_deal_count`, `total_pipeline`, or similar → use them
- If not → show "—" for those columns. Do NOT make 200 individual API calls to get per-account data.

### Filter Bar

```
[Search accounts...  🔍]  [Industry ▾ All]  [Owner ▾ All]
```

- **Search** — filters by account name OR domain (case-insensitive contains)
- **Industry** — dropdown from distinct industry values. Only show if the accounts data includes an industry field. If no industry data exists, omit this filter.
- **Owner** — dropdown from distinct owner values

Show result count: "Showing 48 of 200 accounts"

### Table Columns

| Column | Content | Width | Sort | Notes |
|--------|---------|-------|------|-------|
| Account Name | Name as link | 25% | Alpha default | Click navigates to `/accounts/:accountId` |
| Domain | Website domain | 15% | Alpha | Show as-is |
| Industry | Industry text | 15% | Alpha | "—" if not available |
| Open Deals | Count | 10% | Numeric | "—" if not in response |
| Pipeline Value | Currency | 12% | Numeric | Sum of open deal amounts. "—" if not available |
| Contacts | Count | 8% | Numeric | "—" if not in response |
| Last Activity | Relative date | 15% | Date | "3 days ago", "2 weeks ago", etc. "—" if unknown |

### Sorting, Row Interaction, Pagination, Empty States, Loading

Same patterns as the Deals list (Task 1). Default sort: Account Name alphabetical.

### Key Principle

If a column's data isn't available from the accounts endpoint, show "—" for every row in that column rather than omitting the column entirely. The column headers set user expectations for what Pandora tracks, even if data isn't populated yet. But if a column is ALL dashes (like if no account has industry data), then hide that column — a fully empty column is worse than no column.

---

## Task 3: Command Center Home — Pipeline Chart (2-3 hours)

The Command Center home page currently shows five metric cards (Total Pipeline, Weighted Pipeline, Coverage Ratio, Win Rate, Open Findings) and the beginning of a "Pipeline by..." section that's cut off. Complete the pipeline chart.

### Data Source

`GET /api/workspaces/:id/pipeline/snapshot` returns pipeline data by stage with finding annotations:
```typescript
{
  stages: [
    {
      stage_name: "Qualification",
      deal_count: 12,
      total_amount: 850000,
      weighted_amount: 170000,
      finding_counts: { act: 3, watch: 5, notable: 2, info: 1 },
      avg_days_in_stage: 14
    },
    // ... more stages
  ],
  totals: { ... },
  coverage_ratio: 3.2,
  win_rate_90d: 0.163
}
```

If the snapshot endpoint isn't returning this exact shape, check what it actually returns and adapt.

### Pipeline by Stage Chart

Horizontal bar chart showing deal value by stage:

```
Qualification   ████████████████████████  $850K (12 deals)  ● 3 ● 5
Evaluation      ██████████████████        $620K (8 deals)   ● 1 ● 2
Proposal        ████████████              $440K (5 deals)   ● 0 ● 1
Negotiation     ██████                    $220K (3 deals)   ● 2 ● 0
Closed Won      ████████████████          $580K (7 deals)
```

**Chart requirements:**
- Horizontal bars, one per stage
- Bar length proportional to total_amount for that stage
- Bar color: use a gradient or the existing theme blue. Don't use different colors per stage unless they're already established.
- Right side of each bar: amount + deal count label
- Finding annotations: small severity dots after the deal count. Only show act + watch counts (skip notable/info to avoid clutter). Omit dots entirely for stages with zero act + watch findings.
- Stages ordered by pipeline progression (qualification → closed), not by amount

**Implementation options (in priority order):**
1. Use Recharts BarChart if already imported in the project
2. Use a simple CSS bar chart (div with percentage widths) — this is often more reliable than adding a charting library
3. Use any charting library already in package.json

### Finding Annotations on Metric Cards

The Open Findings card currently shows "● 28 ● 32 ● 5 ● 0". Verify these dots have the correct severity colors (red, orange, blue, gray) and are pulling from the findings/summary endpoint.

### Findings by Rep Summary

Below the pipeline chart, add a compact "Findings by Owner" section if the findings/summary endpoint returns owner-level data:

```
Findings by Rep
Sara Bollman     ● 8  ● 12    20 total
Nate Phillips    ● 5  ● 7     12 total  
Mike Chen        ● 2  ● 3      5 total
```

This shows which reps have the most action items. Only show act + watch counts. Sort by total descending.

If the findings/summary endpoint doesn't break down by owner, skip this section.

### Click-Through from Chart

When a user clicks a pipeline stage bar → navigate to `/deals` with that stage pre-filtered. This means the deals list page needs to accept a `?stage=Qualification` query parameter and apply it as the initial filter.

Similarly, clicking a rep name in "Findings by Rep" → navigate to `/deals?owner=Sara+Bollman`.

Wire these as simple link navigations. On the deals list page, read query params on mount and set the corresponding filter dropdown values.

---

## Task 4: Skills Page Verification & Enhancement — `/skills` (1-2 hours)

The agent fixed the React child error and added expandable run history + Run Now button. Verify these work and enhance if needed.

### Verify First

Load the /skills page and confirm:
- [ ] Page loads without errors
- [ ] All 18 skills render as cards/list items
- [ ] Each skill shows: name, category, schedule (human-readable, not an object)
- [ ] Clicking a skill expands to show run history
- [ ] "Run Now" button is visible on each skill

If any of these fail, fix them before enhancing.

### Enhancement: Skill Card Layout

Each skill should display as a card with this information:

```
┌─────────────────────────────────────────────────────────────┐
│ ⚙ Pipeline Hygiene                              [Run Now ▶]│
│                                                             │
│ Category: pipeline    Schedule: Mondays 8 AM                │
│ Last run: 2 hours ago · Duration: 4.2s · Status: ✅ success │
│ Findings produced: ● 12  ● 18  ● 30                        │
│                                                             │
│ ▸ Run History (click to expand)                             │
└─────────────────────────────────────────────────────────────┘
```

**Fields to show:**
- **Name** — skill name, bold
- **Category** — from skill metadata (e.g., "pipeline", "data-quality", "coverage")
- **Schedule** — human-readable. If it's an object with `cron`, convert: `0 8 * * 1` → "Mondays 8 AM", `0 8 * * *` → "Daily 8 AM", `0 16 * * 5` → "Fridays 4 PM". If `trigger: 'on_demand'` → "On demand only". If `trigger: 'on_sync'` → "After each sync".
- **Last run** — relative time ("2 hours ago"), duration in seconds, status (✅ success / ❌ failed / ⏳ running)
- **Findings produced** — severity dot counts from the last run's results. If not available, show "—"

### Run Now Button

When clicked:
1. Button text changes to "Running..." with a spinner
2. `POST /api/workspaces/:id/skills/:skillId/run`
3. On success: refresh the skill's last run info. Show a brief toast: "Pipeline Hygiene completed in 4.2s"
4. On error: show error toast: "Pipeline Hygiene failed: [error message]"
5. Re-enable the button

Don't allow clicking Run Now while a skill is already running (disable the button).

### Expandable Run History

Clicking "Run History" expands to show the last 10 runs:

```
│ ▾ Run History                                               │
│                                                             │
│ Run #47  Today 8:00 AM     4.2s   ✅ success   12/18/30    │
│ Run #46  Yesterday 8:00 AM 3.8s   ✅ success   11/17/28    │
│ Run #45  Feb 10, 8:00 AM   5.1s   ❌ failed    —           │
│ Run #44  Feb 3, 8:00 AM    4.0s   ✅ success   10/15/25    │
│ ...                                                         │
```

Data source: `GET /api/workspaces/:id/skills/:skillId/runs`

If the runs endpoint returns finding counts per run, show them. If not, show "—" for findings columns.

### Skills Grid Layout

Display skills in a 2-column grid on desktop, single column on mobile. Group by category if there are multiple categories, with category headers:

```
PIPELINE
[Pipeline Hygiene]  [Pipeline Coverage by Rep]

DATA QUALITY  
[Data Quality Audit]

COVERAGE
[Single-Thread Alert]
```

If grouping adds too much complexity, a flat list sorted alphabetically is fine.

---

## Task 5: Cross-Page Navigation Wiring (30 min)

These small navigation connections make the whole app feel integrated:

### Command Center → Deals List
- Pipeline chart stage bars link to `/deals?stage=StageName`
- Findings by Rep names link to `/deals?owner=OwnerName`
- Open Findings card links to `/insights` (Insights Feed)

### Deals List Query Param Support
- On mount, read `?stage=`, `?owner=`, `?health=` from URL query params
- Set the corresponding filter dropdowns to match
- This enables deep linking from anywhere

### Deals List → Deal Detail
- Click a row → navigate to `/deals/:dealId` (verify this works)

### Accounts List → Account Detail  
- Click a row → navigate to `/accounts/:accountId` (verify this works)

### Deal Detail → Account
- If the deal dossier shows an account name, it should link to `/accounts/:accountId`

### Account Detail → Deals
- Deals listed in the account dossier should link to `/deals/:dealId`

### Breadcrumb / Back Navigation
- Deal detail: show "← Back to Deals" at the top that navigates to `/deals`
- Account detail: show "← Back to Accounts" at the top that navigates to `/accounts`
- These may already exist — verify and add if missing

---

## Build Order

1. **Task 1** — Deals list (highest value, most complex)
2. **Task 3** — Command Center chart (connects to deals list via click-through)  
3. **Task 5** — Cross-page navigation (wires 1 and 3 together)
4. **Task 2** — Accounts list (same pattern as deals, faster to build second)
5. **Task 4** — Skills page (verify + enhance)

## Verification Checklist

After all tasks, this flow should work end to end:

1. ✅ Land on Command Center → see pipeline chart with stage bars and finding annotations
2. ✅ Click a stage bar → navigate to Deals list pre-filtered to that stage
3. ✅ See deals with amounts, health badges, finding counts, all columns populated
4. ✅ Use filters to narrow by owner, health grade, status
5. ✅ Click a deal row → see full dossier with health score, findings, contacts, Ask Pandora
6. ✅ Click "Back to Deals" → return to the filtered deals list
7. ✅ Navigate to Accounts → see account table with names, domains, pipeline values
8. ✅ Click an account → see account dossier with deal summary, contact map, relationship health
9. ✅ Navigate to Skills → see 18 skills as cards with run status and "Run Now" buttons
10. ✅ Click "Run Now" → skill executes and result refreshes

## What NOT to Do

- Don't rebuild the sidebar, routing, or workspace selector
- Don't modify deal detail, account detail, Insights Feed, Actions, or Connectors pages
- Don't add real-time WebSocket updates — polling/refresh on navigation is fine
- Don't build Agents, Agent Builder, Tools, Playbooks, Connector Health, Data Dictionary, Marketplace, or Settings
- Don't add dark/light theme toggle or mobile responsive design
- Don't add a charting library unless one is already in package.json — CSS bars are fine
