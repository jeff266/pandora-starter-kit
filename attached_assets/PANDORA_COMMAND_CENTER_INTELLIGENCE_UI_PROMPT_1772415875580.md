# Claude Code Prompt: Unified Command Center — Skills, Tools, Agents & Governance UI

## Context

The Command Center shell exists: sidebar navigation, workspace selector, route scaffolding. The backend APIs for all four sections are built and tested. This prompt builds the four pages under the **Intelligence** sidebar section that currently show "Coming Soon" or are empty:

1. **Skills** — Operational dashboard for 16 skills
2. **Tools** — Registry of 20+ tools that skills consume
3. **Agents** — Active operators + Agent Builder interface
4. **Governance** — Autonomous change review, approval, and rollback

These are a single conceptual unit: tools feed skills, skills compose into agents, agents generate governance proposals. Build them together so navigation between them is seamless.

**Design reference:** The interactive prototype is in the project as `pandora-platform.jsx` (original Command Center mockup with sidebar nav) plus a newer `pandora-command-center.jsx` (the four-tab prototype for these specific pages). Use these for visual direction but wire to real APIs.

---

## Before You Start

**Read these files to understand the existing frontend:**

1. Find the main frontend entry point and routing — where are Command Center pages defined?
2. Find the sidebar navigation component — which items are already wired to routes vs stubbed?
3. Find the existing shared components: cards, badges, tables, status indicators, loading states
4. Find the workspace context provider — how does `workspaceId` flow to child components?
5. Find any existing data-fetching patterns — are there custom hooks, SWR, React Query, or raw fetch calls?

**Read these files to understand the backend APIs you're consuming:**

6. `server/routes/skills.ts` — `GET /skills`, `GET /skills/:id/runs`, `POST /skills/:id/run`
7. `server/routes/agents.ts` — Agent CRUD, `/agents-v2` endpoints, promote, destinations
8. `server/routes/governance.ts` — 8 governance endpoints (list, get, approve, reject, rollback, delete, recompare, history)
9. `server/skills/registry.ts` — How skills are registered (metadata shape)
10. `server/skills/tool-definitions.ts` — 28 tool definitions (for the Tools page data source)
11. `server/governance/db.ts` — Governance record shape
12. `server/agents/seed-agents.ts` — Agent seed data shape (role, goal, execution_mode, skills, etc.)

Match your component interfaces to the actual API response shapes. Do NOT assume they match the prototype data — the prototype used mocked data for layout purposes.

---

## Task 1: Shared Components

Build these reusable components first. They're used across all four pages.

**File:** `client/src/components/intelligence/shared.tsx` (or wherever components live — match existing patterns)

### StatusDot
- Props: `status: 'healthy' | 'warning' | 'stale' | 'active' | 'idle' | 'planned' | 'deployed' | 'pending_approval' | 'rejected' | 'rolled_back' | 'stable' | 'monitoring'`
- 8px colored circle. Green for healthy/active/deployed/stable. Amber for warning/pending_approval. Slate for stale/idle/planned. Red for rejected/rolled_back. Blue for monitoring.

### MetricCard
- Props: `label: string, value: string | number, sub?: string, trend?: 'up' | 'down' | 'flat'`
- Dark card with uppercase label, large monospace value, optional sub-text colored by trend

### Badge
- Props: `children: ReactNode, variant: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted'`
- Small pill with variant-specific background/text colors

### DataTable
- Props: `columns: Column[], rows: any[], onRowClick?: (row) => void, emptyMessage?: string`
- Reusable table with header row, hover states, click handler. Monospace for numeric columns. Columns define `key`, `label`, `width`, `align`, `format` (text, number, duration, tokens, date)

### DetailDrawer
- Props: `open: boolean, onClose: () => void, title: string, children: ReactNode`
- Right-side slide-in panel (480px width) with close button, scrollable content

### FilterBar
- Props: `filters: FilterOption[], activeFilter: string, onChange: (filter) => void`
- Row of toggle buttons for category/status filtering

### SectionHeader
- Props: `title: string, count?: number, action?: ReactNode`
- Section title with optional count badge and right-aligned action button

---

## Task 2: Skills Page

**Route:** Match existing routing pattern — likely `/skills` or `/intelligence/skills` under the workspace context

**Data sources:**
- `GET /api/workspaces/:workspaceId/skills` — List all skills with metadata + lastRunAt
- `GET /api/workspaces/:workspaceId/skills/:skillId/runs` — Run history for detail drawer
- `POST /api/workspaces/:workspaceId/skills/:skillId/run` — Manual trigger
- `GET /api/workspaces/:workspaceId/config/suggestions` — Pending config suggestions per skill (if wired)

### Page Layout

**Metrics row** (top):
- Skills Active: count of skills with a run in the last 30 days
- Runs (30d): total runs across all skills
- Avg Tokens/Run: average token usage
- Findings Generated: total findings from skill runs
- Config Suggestions: pending config suggestions count

Compute these client-side from the skills list + recent runs. If this is too many API calls, aggregate server-side — check if `/skills` already returns summary stats, and if not, add a comment noting a future `/skills/summary` endpoint would help.

**Filter bar**: categories from skill metadata (pipeline, forecast, data, team, conversations, icp, platform, delivery). "All" as default.

**Skills table** using DataTable:
| Column | Source | Format |
|--------|--------|--------|
| Status dot | Derive from lastRunAt: healthy if <7d, warning if 7-14d, stale if >14d or never | StatusDot |
| Name + category | skill.name, skill.category | text |
| Last Run | skill.lastRunAt, relative time | date |
| Next Run | skill.schedule (display human-readable) | text |
| Runs (30d) | Count from runs endpoint OR stored in skill metadata | number |
| Avg Duration | From runs | duration |
| Avg Tokens | From runs | tokens |
| Findings | Count from findings table or skill metadata | number with Badge |
| Suggestions | Config suggestions count for this skill | Badge (info variant) if > 0 |

**Important:** The existing `GET /skills` endpoint returns metadata from the registry + `lastRunAt` from skill_runs. It does NOT return per-skill run counts, token averages, or findings counts. You have two options:

- **Option A (Preferred):** Add a `GET /api/workspaces/:workspaceId/skills/dashboard` endpoint that joins skill registry data with aggregated run stats and findings counts. One API call gives you everything the page needs.
- **Option B:** Fetch `/skills` for the list, then lazy-load run stats per skill when the user clicks. Faster initial render but more requests.

Pick Option A if adding the endpoint is straightforward. Note it in the code so it's clear this is a new endpoint.

**Row click → Detail Drawer**

### Skill Detail Drawer

When a skill row is clicked, open the DetailDrawer with:

1. **Header:** Skill name + StatusDot + category badge
2. **Metrics grid (2x2):** Success Rate, Avg Tokens, Runs (30d), Findings
3. **Action buttons:**
   - "▶ Run Now" — `POST /skills/:skillId/run`, show loading spinner, refresh run history on completion
   - "View Output" — Link to most recent run's full output (open in new panel or modal)
4. **Execution Pattern:** Visual pipeline showing COMPUTE → CLASSIFY → SYNTHESIZE with step count per phase. Source this from the skill definition's steps array.
5. **Run History:** Last 10 runs in a compact table: timestamp, status (success/failed badge), duration, tokens, findings count. Data from `GET /skills/:skillId/runs?limit=10`.
6. **Governance link:** If this skill has pending config suggestions, show a callout box linking to the Governance tab. Text: "N governance proposal(s) from this skill — Review in Governance"

---

## Task 3: Tools Page

**Route:** `/tools` or `/intelligence/tools`

**Data source:** The tool registry is server-side in `server/skills/tool-definitions.ts`. There is likely NO existing API endpoint for listing tools.

**Action required:** Add a new endpoint:

```
GET /api/workspaces/:workspaceId/tools
```

Returns the tool definitions array from the registry. Each tool definition has: `name`, `description`, `category` (you may need to add this), `parameters` schema, and `usedBySkills` (which skills reference this tool). If usage stats per tool aren't currently tracked, return `null` for `calls30d` and note it as a future enhancement.

Check `server/skills/tool-definitions.ts` — the tool definitions are already structured objects. Map them to a response that includes:
- `id` (tool function name)
- `name` (human-readable, derive from id or add a display name)
- `description` (from tool definition)
- `category`: Categorize as 'data' (queryDeals, queryContacts, etc.), 'config' (getWorkspaceConfig, getQuotas), 'evidence' (queryFindings), 'enrichment' (Apollo, Serper — future), 'action' (pushToPM, writeBackToCRM — future), 'delivery' (sendSlack, generateSpreadsheet)
- `status`: 'active' if the function exists and works, 'planned' if it's defined but not implemented
- `usedBySkills`: Array of skill IDs that reference this tool

### Page Layout

**Metrics row:**
- Tools Built: count active
- Planned: count planned
- Total Calls (30d): sum of usage (or "tracking coming soon" if not yet instrumented)

**Filter bar:** "All", "Active", "Planned"

**Tools table:**
| Column | Format |
|--------|--------|
| Status dot | active/planned |
| Tool ID (monospace) + display name | text |
| Category | Badge |
| Used By | Skill names, truncated with "+N" overflow |
| Calls (30d) | number or "—" |

**Enrichment callout:** At the bottom, if any tools have status='planned', show an info box:

> "🔮 N tools unlock with enrichment pipeline — Apollo + Serper integrations enable ICP Discovery, Lead Scoring, and Account Signals tools. These feed existing skills that are currently running on CRM data only."

This is important context — it shows the admin what's possible, not just what exists.

**No detail drawer for tools.** Clicking a tool row could expand inline to show the tool's parameter schema and which skills use it, but a full drawer is unnecessary. If inline expand is complex to implement, skip it for v1 and just show the table.

---

## Task 4: Agents Page

**Route:** `/agents` or `/intelligence/agents`

**Data sources:**
- `GET /api/workspaces/:workspaceId/agents` — List all agents with metadata
- Agent Builder templates — check if stored in DB or hardcoded. If hardcoded in `seed-agents.ts`, the templates may need a dedicated endpoint or be bundled client-side.
- `GET /api/workspaces/:workspaceId/agents/:agentId/runs` — Run history (if endpoint exists)

### Two-View Toggle

The page has two views, toggled by a button pair at the top:

#### View 1: Active Operators

List of configured agents as cards (not a table — agents have more metadata than fits in columns).

**Agent card contains:**
- Header row: StatusDot + Agent name + Tier badge ("Tier 1 — Inform" / "Tier 2 — Recommend" / "Tier 3 — Act") + Mode badge ("pipeline" / "loop" / "auto")
- Sub-header: Agent role description (from `role` field)
- Right-aligned: Last run time + Schedule
- Bottom: Skill pills — list of skill IDs this agent runs, as small chips/tags

**Card click:** Open DetailDrawer with:
- Full agent metadata (role, goal, execution_mode, autonomy_tier)
- Skills list with links to Skills page
- Loop config (if mode is 'loop' or 'auto'): max_iterations, available_skills, termination condition
- Post-action playbook summary (trigger → actions list)
- Run history (last 10 runs)
- "Run Now" button
- "Promote" button (if tier < 3): shows current tier → next tier with confirmation

#### View 2: Agent Builder

Grid of template cards (2 columns).

**Template card contains:**
- Template name (bold)
- Focus description (what it does)
- Skill count badge + Complexity badge (Low/Medium/High with color)

**Card click:** This is where the full Agent Builder flow would launch. For v1, clicking a template opens a detail view showing:
- Which skills are included
- Default schedule
- Default delivery channels
- Token cost estimate (from the tradeoff engine, if available via API)
- "Create Agent from Template" button — calls `POST /agents` with template defaults

**If the Agent Builder tradeoff engine (migration 045) has API endpoints**, wire them here:
- Show token cost meter when skills are selected
- Show alert fatigue score based on schedule + skill count
- Show framework conflicts if skills have overlapping concerns

**If those endpoints don't exist yet**, show the template info statically and note "Tradeoff analysis coming soon" in the UI.

---

## Task 5: Governance Page

**Route:** `/governance` or `/intelligence/governance`

**Data sources:**
- `GET /api/workspaces/:workspaceId/governance` — List governance records (supports `?status=` filter)
- `GET /api/workspaces/:workspaceId/governance/:id` — Full detail for one record
- `POST /api/workspaces/:workspaceId/governance/:id/approve` — Approve
- `POST /api/workspaces/:workspaceId/governance/:id/reject` — Reject
- `POST /api/workspaces/:workspaceId/governance/:id/rollback` — Rollback
- `DELETE /api/workspaces/:workspaceId/governance/:id` — Delete (only proposed/rejected/rolled_back)
- `POST /api/workspaces/:workspaceId/governance/:id/recompare` — Re-run comparison
- `GET /api/workspaces/:workspaceId/governance/history` — Full audit trail

### Page Layout

**Metrics row:**
- Pending Review: count where status = 'pending_approval'
- Deployed: count where status = 'deployed' (with "Monitoring" sub-text)
- Stable: count where status = 'stable' (with "Proven improvements" sub-text)
- Auto-Rolled Back: count where status = 'rolled_back' (with "System self-corrected" sub-text)

**Filter bar:** All, Pending, Deployed, Stable, Rejected, Rolled Back

**Governance cards** (not a table — too much content per record):

Each governance record renders as a card with:

1. **Header row:**
   - Type icon: 📝 workspace_context, 🔍 named_filter, ⚡ resolver_pattern, 🧩 skill_definition
   - Status badge (variant matches status: warning for pending, info for deployed, success for stable, danger for rejected/rolled_back)
   - Change type label
   - Right-aligned: Review score (colored by value: green >0.7, amber 0.4-0.7, red <0.4) + Comparison badge ("4/5 improved")

2. **Summary text:** `explanation_summary` from the Explainer Agent. This is the human-language description. If the endpoint returns it, use it. If not, fall back to `change_description`.

3. **Status-specific details:**

   **If pending_approval:**
   - Source line: "Source: N repeated questions" or "Source: N thumbs-down"
   - Concerns (if any): amber warning text from `review_concerns`
   - Action buttons: [Approve] (green) [Reject] (default) [View Details] (subtle)
   - Approve calls `POST /governance/:id/approve` with `{ approved_by: 'admin' }` (use current user if auth exists, or 'admin' placeholder)
   - Reject opens a small input for reason, then calls `POST /governance/:id/reject`

   **If deployed:**
   - Deployed ago + Trial days remaining (calculate from `trial_expires_at`)
   - Feedback since deploy: thumbs up count, thumbs down count (from `monitoring_feedback_after` or calculate from agent_feedback)
   - Action buttons: [Rollback] (red) [View History] (subtle)
   - Rollback opens confirmation dialog with reason input, then calls `POST /governance/:id/rollback`

   **If stable:**
   - Deployed ago + Total feedback stats
   - "Proven" badge (green)
   - View History button only

   **If rejected:**
   - Red text: "Rejected: {reason}" from `review_concerns` or status_history
   - Delete button (calls `DELETE /governance/:id`)

   **If rolled_back:**
   - Red text: "Auto-rolled back: {rollback_reason}"
   - Delete button

4. **Detail view (on "View Details" click):**
   Open DetailDrawer with the full governance record:
   - Explanation: summary, detail, impact, rollback_note (all from Explainer Agent)
   - Shape validation: checks performed, errors, warnings
   - Review: dimension scores (specificity, evidence_strength, risk, clarity, reversibility), concerns, strengths
   - Comparison: test cases table showing input, before response, after response, verdict per case
   - Status timeline: status_history array rendered as a vertical timeline with timestamps and actors
   - Change payload: collapsible JSON view of the actual change definition (for technical admins)

---

## Task 6: Navigation Wiring

### Tab Navigation

Add a tab bar inside the Intelligence section of the Command Center. Four tabs: Skills, Tools, Agents, Governance. Each tab shows a count:
- Skills: total registered skills count
- Tools: "active/total" format (e.g., "20/31")
- Agents: total agent count
- Governance: pending_approval count (with amber highlight if > 0)

The tab bar should be at the top of the content area, below the sidebar. Clicking a tab changes the visible page without a full navigation — these are sub-pages within the Intelligence section.

### Global Notification

In the main Command Center header (top bar), add a persistent notification when governance items are pending:

- Amber pill with pulsing dot: "N pending approval(s)"
- Clicking navigates to the Governance tab
- Only visible when `pending_approval` count > 0
- Fetch this count on page load and after any governance action (approve/reject)

### Cross-Links

- Skills page "governance proposals" callout → clicking navigates to Governance tab with filter set to that skill's proposals
- Agents page skill chips → clicking navigates to Skills tab and opens that skill's detail drawer
- Governance "View Details" on a resolver_pattern or named_filter → if it references a skill, show a link back to that skill

---

## Task 7: Data Fetching Strategy

### If the codebase uses React Query or SWR:
- Create query hooks: `useSkills()`, `useSkillRuns(skillId)`, `useTools()`, `useAgents()`, `useGovernance(status?)`, `useGovernanceRecord(id)`
- Set appropriate stale times: skills/tools (5 min), agents (5 min), governance (30 sec — admin may be reviewing)
- Invalidate governance queries after approve/reject/rollback mutations

### If the codebase uses raw fetch:
- Create fetch functions in a `client/src/api/intelligence.ts` file
- Use `useEffect` + `useState` pattern matching existing pages
- Add loading states and error handling consistent with the rest of the app

### Either way:
- Show skeleton loaders while data is loading (match existing patterns)
- Show error states with retry button if API calls fail
- Show empty states: "No skills registered" / "No governance proposals" / etc.

---

## Task 8: New API Endpoints (if needed)

Check if these exist. If not, add them:

### 1. Skills Dashboard Aggregate
```
GET /api/workspaces/:workspaceId/skills/dashboard
```
Returns:
```json
{
  "skills": [
    {
      "id": "pipeline-hygiene",
      "name": "Pipeline Hygiene",
      "category": "pipeline",
      "description": "...",
      "schedule": { "cron": "0 8 * * 1", "human": "Mon 8:00 AM" },
      "lastRunAt": "2026-03-01T08:00:00Z",
      "stats": {
        "runs30d": 12,
        "avgDurationMs": 4200,
        "avgTokens": 8400,
        "successRate": 100,
        "findingsCount": 23,
        "suggestionsCount": 1
      }
    }
  ],
  "summary": {
    "totalSkills": 16,
    "activeSkills": 13,
    "staleSkills": 3,
    "totalRuns30d": 121,
    "totalFindings": 182,
    "pendingSuggestions": 7
  }
}
```

Implementation: Join `skillRegistry.list()` with aggregates from `skill_runs` and `findings` tables, plus `config_suggestions` count. Single SQL query with CTEs for efficiency.

### 2. Tools Registry
```
GET /api/workspaces/:workspaceId/tools
```
Returns tool definitions from the tool registry with categorization and skill dependency mapping. Check if this already exists — if `tool-definitions.ts` exports a list, wrap it in an endpoint.

### 3. Governance Summary
```
GET /api/workspaces/:workspaceId/governance/summary
```
Returns:
```json
{
  "pending_approval": 2,
  "deployed": 1,
  "stable": 1,
  "rejected": 1,
  "rolled_back": 1,
  "total": 6
}
```

This powers the header notification badge without loading all records.

---

## Task 9: Styling

Match the existing Command Center design system. Examine the current:
- Color palette (likely dark theme based on existing mockups — `#030712` background, `#0f172a` cards, `#1e293b` borders)
- Font stack (check if JetBrains Mono is used for monospace, Inter for body)
- Component styles (card border radius, padding, shadow patterns)
- Loading states and transitions

If the existing app has a different design system than the prototype, match the existing system — consistency matters more than matching the prototype exactly.

Key design principles:
- Monospace font for all numeric data (token counts, durations, counts)
- Status communicated through color dots, not text alone
- Cards for complex items (agents, governance), tables for scannable lists (skills, tools)
- Amber visual urgency for anything pending admin action
- Dark theme throughout — no white backgrounds

---

## Task 10: Verify

After building all four pages:

1. **Skills page loads** — shows all registered skills with correct metadata from API
2. **Skill click opens drawer** — run history loads, "Run Now" triggers execution and updates
3. **Tools page loads** — shows active and planned tools with correct categorization
4. **Agents page loads** — shows all 6 system agents with correct metadata
5. **Agent Builder tab** — shows templates, clicking one shows skill details
6. **Governance page loads** — shows all governance records with correct status
7. **Approve flow works** — click Approve on pending item → status changes to deployed → card updates
8. **Reject flow works** — click Reject → enters reason → status changes to rejected
9. **Rollback flow works** — click Rollback on deployed item → confirmation → status changes to rolled_back
10. **Cross-navigation works** — Skills suggestion badge → Governance tab, Governance skill link → Skills detail
11. **Header notification** — shows pending count when governance items exist, links to Governance tab
12. **Filter bars work** — each page filters correctly by category/status
13. **Empty states display** — if no runs, no tools, no agents, or no governance records
14. **Loading states display** — skeleton loaders while API calls are in flight

Take screenshots of:
- Skills page with table populated
- Skill detail drawer open
- Tools page showing active and planned sections
- Agents page with operator cards
- Agent Builder template grid
- Governance page with at least one pending, one deployed, and one rejected record
- Header notification badge

---

## What This Does NOT Change

- The Command Center home page (pipeline chart, findings feed)
- The sidebar navigation structure (just wiring existing items to real pages)
- Any backend logic — skills, tools, agents, governance all function exactly as they do
- The chat interface
- Connector pages
- Data pages

---

## What This Does NOT Build Yet

- Agent Builder full configuration flow (select skills, adjust schedule, see live tradeoffs, save) — v1 shows templates and creates with defaults
- Governance detail comparison side-by-side UI — v1 shows data in the drawer, not a dedicated comparison view
- Tool usage analytics — v1 shows the registry, not per-tool call graphs
- Skill output viewer — v1 links to run data, not a rendered output preview
- Real-time updates — polling or manual refresh is fine for v1

---

## Summary of Files

| File | Purpose |
|---|---|
| `client/src/components/intelligence/shared.tsx` | Shared components (StatusDot, MetricCard, Badge, DataTable, DetailDrawer, FilterBar) |
| `client/src/pages/skills.tsx` (or matching pattern) | Skills page with table + detail drawer |
| `client/src/pages/tools.tsx` | Tools page with registry table |
| `client/src/pages/agents.tsx` | Agents page with operators + builder views |
| `client/src/pages/governance.tsx` | Governance page with cards + approval flow |
| `client/src/api/intelligence.ts` | API fetch functions / query hooks for all four sections |
| `server/routes/skills.ts` | Add `/skills/dashboard` aggregate endpoint (if it doesn't exist) |
| `server/routes/tools.ts` | Add `/tools` registry endpoint (if it doesn't exist) |
| `server/routes/governance.ts` | Add `/governance/summary` count endpoint (if it doesn't exist) |

---

## Priority Order

If time-constrained, build in this order:

1. **Shared components** — everything depends on these
2. **Governance page** — highest value (unblocks the self-improvement loop built today)
3. **Skills page** — most useful for daily operations
4. **Agents page** — needed but less urgent (agents run on schedule regardless of UI)
5. **Tools page** — informational, lowest urgency

The Governance page is #2 because until it ships, the entire feedback → self-heal → governance pipeline built in T005–T007 and the governance layer has no way for an admin to interact with it.
