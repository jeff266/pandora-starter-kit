# Pandora Multi-Workspace Command Center — Build Prompt

## For: Replit
## Effort: 4-6 hours
## Depends on: Existing Command Center, workspace switching, Demo Mode (Prompt 1)

---

## Purpose

Jeff is a RevOps consultant managing 4 clients simultaneously through Pandora. Today he switches between workspaces one at a time. He needs a single screen that shows the health of ALL his clients at a glance, prioritized by what needs his attention. This is both his daily driver and (with Demo Mode on) the LinkedIn hero screenshot.

This is NOT a replacement for the per-workspace Command Center. It's a layer ABOVE it — the consultant's "portfolio view." Click any client → drops into their existing workspace Command Center.

---

## Task 1: Backend — Cross-Workspace Summary Endpoint

Create a new endpoint that queries across all workspaces the current user has access to:

```
GET /api/consultant/dashboard
```

This endpoint is scoped to the authenticated user. It queries every workspace they belong to and assembles a summary for each.

### Response Shape

```typescript
{
  workspaces: [
    {
      id: string,
      name: string,
      crm_type: 'hubspot' | 'salesforce' | null,
      conversation_source: 'gong' | 'fireflies' | null,

      // Pipeline summary (from deals table)
      pipeline: {
        total_value: number,        // SUM of open deal amounts
        deal_count: number,         // COUNT of open deals
        weighted_value: number,     // SUM(amount * probability) if available
        avg_age_days: number,       // AVG days since deal created
      },

      // Findings summary (from findings table)
      findings: {
        critical: number,
        warning: number,
        info: number,
        total: number,
      },

      // Actions summary (from actions table)
      actions: {
        open: number,
        critical_open: number,
        resolved_this_week: number,
        pipeline_at_risk: number,   // SUM of impact_amount for open critical actions
      },

      // Health indicators
      connectors: {
        count: number,              // number of connected sources
        any_errors: boolean,        // any connector in error state
        last_sync: string | null,   // most recent sync across all connectors
      },

      // Last skill run info
      last_skill_run: string | null,  // timestamp of most recent skill_run
      skills_active: number,          // count of scheduled skills
    }
  ],

  // Cross-workspace totals
  totals: {
    total_pipeline: number,
    total_deals: number,
    total_critical_findings: number,
    total_open_actions: number,
    total_pipeline_at_risk: number,
    workspaces_with_errors: number,
  }
}
```

### Implementation Notes

- Query the `workspaces` table for all workspaces the user has access to
- For each workspace, run parallel queries against deals, findings, actions, connector_configs, skill_runs
- Use Promise.all to parallelize — don't do sequential per-workspace queries
- Cache this endpoint for 5 minutes (it aggregates a lot of data)
- If a workspace has no data yet (not connected), return zeroed-out values with `crm_type: null`

### Sorting

Return workspaces sorted by urgency:
1. Workspaces with critical findings or actions first
2. Then by total open actions descending
3. Then alphabetically

---

## Task 2: Frontend — Consultant Dashboard Page

Create `client/src/pages/ConsultantDashboard.tsx` (or equivalent path).

This is the new landing page when no specific workspace is selected, OR accessible via a dedicated nav item. Wire it to a route like `/dashboard` or `/consultant`.

### Page Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ Pandora                                          🎭 Demo Mode  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Good morning, Jeff                          Mon, Feb 16 2026   │
│                                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │ $21.8M   │ │ 847      │ │ 6        │ │ 14       │          │
│  │ Pipeline  │ │ Deals    │ │ Critical │ │ Actions  │          │
│  │ 4 clients │ │ total    │ │ findings │ │ open     │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🔴 Imubit (Salesforce)              $14.8M │  87 deals │   │
│  │    3 critical findings  •  5 open actions   •  $2.1M at risk│
│  │    Last sync: 2h ago  •  Last skill run: 6h ago             │
│  │                                     [View Dashboard →]      │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🟡 Frontera Health (HubSpot + Gong)   $2.1M │  85 deals│   │
│  │    1 warning  •  3 open actions  •  $340K at risk           │
│  │    Last sync: 1h ago  •  Last skill run: 6h ago             │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🟢 GrowthBook (HubSpot + Fireflies)  $890K │  42 deals │   │
│  │    No critical findings  •  2 open actions               │   │
│  │    Last sync: 3h ago  •  Last skill run: 6h ago             │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🔴 GrowthX (HubSpot)                 $3.2M │  63 deals │   │
│  │    2 critical findings  •  4 open actions  •  $780K at risk │
│  │    Last sync: 4h ago  •  Last skill run: 6h ago             │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Component Breakdown

**Greeting Header:**
- "Good morning/afternoon/evening, Jeff" based on time of day
- Current date
- Auto-refresh indicator: "Last updated: 2 minutes ago"

**Totals Bar:**
- 4 metric cards showing cross-workspace totals
- Same card style as Command Center headline metrics
- Pipeline total, deal count, critical findings count, open actions count

**Workspace Cards:**

Each workspace gets a card. The card contains:

1. **Status dot** — derived from findings severity:
   - 🔴 Red: any critical findings or critical open actions
   - 🟡 Yellow: warnings but no criticals
   - 🟢 Green: no warnings or criticals
   - ⚪ Gray: no data (workspace not connected yet)

2. **Workspace name** — pass through `anon.workspace()` from Demo Mode context

3. **Data source badges** — small pills showing connected sources:
   ```
   [Salesforce] [Gong]
   ```
   or
   ```
   [HubSpot] [Fireflies]
   ```

4. **Pipeline headline** — total pipeline value + deal count
   - Value through `anon.amount()`
   - Color-code value: green if up from last week, red if down (if you have historical data — otherwise just neutral)

5. **Findings summary line:**
   ```
   3 critical findings  •  5 open actions  •  $2.1M at risk
   ```
   - Critical count in red
   - Actions count in accent
   - At-risk amount through `anon.amount()`

6. **Freshness line:**
   ```
   Last sync: 2h ago  •  Last skill run: 6h ago
   ```
   - Color-code sync time: green <6h, yellow <24h, red >24h
   - Color-code skill run: green <12h, yellow <24h, red >24h

7. **Click anywhere on the card** → navigates to that workspace's Command Center
   - Sets the active workspace in the workspace selector
   - Route: something like `/workspace/:workspaceId/command-center`

8. **"View Dashboard →" link** in bottom right of card (same navigation, more visible)

### Card States

**Connected, has data:** Full card as described above.

**Connected, no skill runs yet:**
```
┌─────────────────────────────────────────────────────────┐
│ ⚪ GrowthBook (HubSpot)                  42 deals synced│
│    Skills haven't run yet — first run scheduled for 6am │
│                                       [View Dashboard →]│
└─────────────────────────────────────────────────────────┘
```

**Not connected:**
```
┌─────────────────────────────────────────────────────────┐
│ ⚪ GrowthX                              Not connected   │
│    Connect a CRM to start monitoring this workspace     │
│                                     [Connect CRM →]     │
└─────────────────────────────────────────────────────────┘
```
"Connect CRM →" links to that workspace's Connectors page.

### Interactions

- Click card → navigate to workspace Command Center
- Auto-refresh every 5 minutes (same pattern as Command Center)
- Cards animate in on load (subtle fade-up, staggered 50ms per card)
- Skeleton loading: show 4 card-shaped skeletons on initial load

---

## Task 3: Navigation / Routing

### Option A: Consultant Dashboard as default landing

When the user logs in and has access to multiple workspaces, land on the Consultant Dashboard instead of a specific workspace's Command Center.

- URL: `/dashboard` or `/`
- Sidebar shows a "Portfolio" or "All Clients" item at the top, above the workspace selector
- Clicking a workspace card or selecting from the sidebar switches to that workspace context

### Option B: Sidebar entry above workspace selector

Add a nav item above the workspace list in the sidebar:

```
┌──────────────────────┐
│  📊 All Clients      │  ← New: navigates to Consultant Dashboard
├──────────────────────┤
│  I  Imubit           │
│  F  Frontera Health  │
│  G  GrowthBook       │
│  G  GrowthX          │
├──────────────────────┤
│  [workspace nav...]  │
└──────────────────────┘
```

**Implement whichever option fits better with the existing routing structure.** The key requirement is: there must be a way to get to this page from any workspace, and it should be the natural starting point.

---

## Task 4: "Needs Attention" Summary (Optional — Build If Time Allows)

Below the totals bar, above the workspace cards, add a compact "Needs Attention" section that surfaces the most urgent items across all workspaces:

```
⚡ Needs Your Attention (5 items)

🔴 Imubit — "Enterprise Expansion" deal stalled 34 days in Negotiation ($220K)
🔴 Imubit — 3 deals missing close dates
🔴 GrowthX — "Retention Review" single-threaded at VP level ($180K)
🔴 GrowthX — Data quality: 12 contacts missing titles
🟡 Frontera — Pipeline coverage below 2.5x for Q1 target
```

This requires an additional endpoint or extending the existing one:

```
GET /api/consultant/attention?limit=10
```

Returns the top N most urgent findings/actions across all workspaces, sorted by severity then impact. Each item includes the workspace name (for display) and workspace ID + entity ID (for navigation).

Each item is clickable → navigates to the relevant deal or finding in the correct workspace.

All entity names go through Demo Mode anonymization.

---

## Task 5: Demo Mode Integration

Every piece of data on this page must respect Demo Mode:

- `anon.workspace(workspace.name)` on all workspace names
- `anon.amount()` on all dollar values (pipeline, at-risk, deal amounts)
- `anon.deal()` on any deal names in the Needs Attention section
- `anon.person()` on any rep names
- `anon.company()` on any account names
- CRM type labels (HubSpot, Salesforce, Gong) stay real — they're product names, not client data
- Metric counts (deal count, finding count) stay real — not identifying

---

## Verification

1. Navigate to All Clients / Portfolio view
2. See all 4 workspaces with correct pipeline summaries
3. Workspaces sorted by urgency (red first)
4. Totals bar shows correct cross-workspace sums
5. Click a workspace card → lands on that workspace's Command Center
6. Active workspace in sidebar updates accordingly
7. Toggle Demo Mode → all workspace names, amounts, entity names anonymized
8. Take a screenshot in Demo Mode — no real client data visible
9. Auto-refresh updates data every 5 minutes
10. Skeleton loading shows on initial page load

---

## What NOT to Build

- Cross-workspace searching (search stays workspace-scoped for now)
- Comparative analytics between workspaces (e.g., "Imubit vs Frontera win rates") — future
- Workspace creation from this page (use existing workspace management)
- Notification aggregation (Slack remains the notification channel)
- Per-workspace mini-charts on the cards (keep it scannable, not dense)
