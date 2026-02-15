# Command Center Phase B — Frontend Build Prompts

## Overview

Four prompts that build the Command Center UI. Run them in order.
Each prompt produces a working, visually complete page before moving on.

**Depends on:** Phase A APIs (findings, pipeline/snapshot, dossiers, analyze)  
**Design reference:** `pandora-platform.jsx` in the project root — dark-themed React mockup with the exact color palette, sidebar, and component patterns. READ THIS FILE FIRST.  
**Track:** Replit only (no Claude Code needed)  
**Chart library:** Recharts (already available or install it)

---

## Design System (from pandora-platform.jsx)

Every prompt in this spec uses this design system. Do NOT deviate from it.
These values come directly from the existing mockup in the codebase.

```
COLORS:
  bg: "#06080c"               — page background
  bgSidebar: "#0a0d14"        — sidebar background
  surface: "#0f1219"          — card background
  surfaceRaised: "#141820"    — elevated card
  surfaceHover: "#1a1f2a"     — hover state
  surfaceActive: "#1e2436"    — active/selected state
  border: "#1a1f2b"           — default border
  borderLight: "#242b3a"      — lighter border
  borderFocus: "#3b82f6"      — focus ring
  text: "#e8ecf4"             — primary text
  textSecondary: "#94a3b8"    — secondary text
  textMuted: "#5a6578"        — muted labels
  textDim: "#3a4252"          — dimmest text
  accent: "#3b82f6"           — blue accent (primary action)
  accentSoft: "rgba(59,130,246,0.12)" — accent background
  green: "#22c55e"            — positive/healthy
  greenSoft: "rgba(34,197,94,0.1)"
  yellow: "#eab308"           — warning/watch
  yellowSoft: "rgba(234,179,8,0.1)"
  red: "#ef4444"              — critical/act
  redSoft: "rgba(239,68,68,0.1)"
  purple: "#a78bfa"           — conversations/intelligence
  orange: "#f97316"           — deals/pipeline

TYPOGRAPHY:
  font: "'IBM Plex Sans', -apple-system, sans-serif"
  mono: "'IBM Plex Mono', 'SF Mono', monospace"
  Headings: 17px/700 (page title), 14px/600 (section), 13px/600 (card header)
  Body: 13px/400 (default), 12px/400 (secondary), 11px/400 (caption)
  Numbers: Use mono font for all numeric values

SPACING:
  Page padding: 24px 28px
  Card padding: 16px-20px
  Card gap: 16px
  Section gap: 24px
  Card border-radius: 10px
  Button border-radius: 6px

COMPONENTS (match the mockup exactly):
  Cards: background surface, 1px border, 10px radius, no shadow
  Badges: background accentSoft or severity color, 10px font, 500 weight
  Status dots: 7px circle with matching glow shadow
  Buttons: 12px/600 font, 8px 14px padding, accent bg for primary
  Sidebar items: 13px font, 8px padding, accent left border when active
```

---

## Prompt B1: App Shell + Navigation + Routing

```
Read pandora-platform.jsx in the project root FIRST. Match its design 
exactly — colors, fonts, spacing, sidebar layout. This is the approved 
design, not a suggestion.

Then read the existing frontend code to understand:
1. How the React app is set up (Create React App? Vite? Next.js?)
2. Where components live
3. How routing works (React Router? file-based?)
4. How API calls are made (fetch? axios? custom client?)
5. Whether there's an existing auth/workspace context

BUILD THE APP SHELL:

This is the permanent layout that wraps every page. Sidebar on the 
left, content area on the right.

1. SIDEBAR COMPONENT

Build exactly from pandora-platform.jsx. The sidebar has:

a) Workspace selector (top) — shows workspace initial + name + chevron
   - For now, hardcode the workspace or read from a config
   - Clicking shows a dropdown of available workspaces (fetch from API)
   - Selected workspace is stored in React context

b) Navigation sections:
   - Command Center (home, no section header)
   - Intelligence: Agents, Agent Builder (indent), Skills (indent, badge), Tools (indent)
   - Operations: Playbooks (badge), Insights Feed, Actions (badge)
   - Data: Connectors (badge), Connector Health, Data Dictionary
   - Workspace: Users & Teams, Marketplace (beta badge), Settings

c) User footer — initials circle + name + role

d) Active state: accent-colored left border + accentSoft background + 
   accent-colored icon

Sidebar width: 220px, fixed position, full height.
Background: bgSidebar (#0a0d14).
Border-right: 1px solid border.

2. TOP BAR

Sticky at top of content area. Contains:
- Page title (dynamic, based on current route)
- Breadcrumb or subtitle text (muted color)
- Right side: time range selector (Today / This Week / This Month),
  last refreshed timestamp, and action buttons (vary by page)

Background: bg with backdrop-filter blur.
Border-bottom: 1px solid border.

3. ROUTING

Set up routes for all pages. Most pages show a "Coming Soon" 
placeholder initially — they'll be built in B2-B4.

Routes:
  /                          → Command Center (B2)
  /insights                  → Insights Feed (B4)
  /actions                   → Actions queue (Phase C)
  /skills                    → Skills list (B4)
  /skills/:skillId/runs      → Skill run history (B4)
  /connectors                → Connectors page (B4)
  /connectors/health         → Connector Health (Phase C)
  /deals/:dealId             → Deal detail (B3)
  /accounts/:accountId       → Account detail (B3)
  /agents                    → Coming Soon
  /agent-builder             → Coming Soon
  /tools                     → Coming Soon
  /playbooks                 → Coming Soon (has mockup in pandora-platform.jsx)
  /settings                  → Coming Soon
  /data-dictionary           → Coming Soon
  /users                     → Coming Soon

4. WORKSPACE CONTEXT

Create a React context that holds:
  - workspaceId: string
  - workspaceName: string
  - apiKey: string (for API auth)

For now, the workspace context can be initialized from:
  a) URL query param (?workspace=xxx&key=xxx) — useful for development
  b) localStorage — persist after first login
  c) A simple login screen that asks for workspace ID and API key

Option (c) is simplest and matches the current auth model. Build a 
minimal login page:
  - Two text inputs: Workspace ID, API Key
  - "Connect" button
  - On submit: call GET /api/workspaces/{id} with Bearer token
  - If 200: store in context + localStorage, navigate to /
  - If 401: show error

5. API CLIENT

Create a shared API client that automatically includes auth:

const api = {
  async get(path: string) {
    const { workspaceId, apiKey } = getWorkspaceContext();
    const res = await fetch(
      `/api/workspaces/${workspaceId}${path}`,
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async post(path: string, body: any) {
    const { workspaceId, apiKey } = getWorkspaceContext();
    const res = await fetch(
      `/api/workspaces/${workspaceId}${path}`,
      { 
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};

6. BADGE COUNTS

The sidebar badges (Skills: 4, Actions: 12, Connectors: 4) should 
be live data fetched on mount:

- Skills badge: count of registered skills (GET /skills, count results)
- Actions badge: count of active 'act' severity findings (GET /findings/summary)
- Connectors badge: count of connected sources (GET /connectors or similar)

Fetch these once on app mount, refresh every 60 seconds.

7. PLACEHOLDER PAGES

For routes not yet built, show a centered placeholder:

<div style={{ 
  display: 'flex', 
  flexDirection: 'column', 
  alignItems: 'center', 
  justifyContent: 'center',
  height: '60vh',
  color: textMuted,
}}>
  <h2 style={{ fontSize: 17, fontWeight: 600, color: textSecondary }}>
    {pageName}
  </h2>
  <p style={{ fontSize: 13, marginTop: 8 }}>
    Coming soon
  </p>
</div>

VERIFY:
- App loads with sidebar visible
- Clicking sidebar items navigates to the correct route
- Active sidebar item shows accent styling
- Top bar shows correct page title for each route
- Workspace context persists across page navigations
- Login screen works (test with a real workspace ID + API key)
- Badge counts load (or show 0 gracefully if APIs aren't populated)
```

---

## Prompt B2: Command Center Home Page

```
Read the Phase A API responses first — you need to understand the 
exact data shapes:

1. GET /api/workspaces/:id/pipeline/snapshot — returns by_stage 
   array with deal counts, values, and findings annotations per stage
2. GET /api/workspaces/:id/findings/summary — returns severity 
   counts, skill breakdown, category breakdown, trend
3. GET /api/workspaces/:id/findings?status=active&sort=severity&limit=20 
   — returns paginated active findings
4. GET /api/workspaces/:id/skills — returns registered skills with 
   last run timestamps

Also read pandora-platform.jsx for the design system.

BUILD THE COMMAND CENTER HOME PAGE:

This is the page at route "/". When a user logs in, this is what 
they see. It's NOT a dashboard of charts. It's a command center 
showing what needs attention right now.

LAYOUT (top to bottom):

1. HEADLINE METRICS ROW

A row of 5 metric cards across the top. Each card shows:
  - Label (textMuted, 11px uppercase)
  - Value (text, 24px mono weight 700)
  - Trend indicator (green up arrow, red down arrow, or gray dash)
  - Trend detail (textMuted, 11px, e.g., "↑ 12% vs last week")

Cards:
  a) Total Pipeline — sum from pipeline/snapshot.by_stage
  b) Weighted Pipeline — from pipeline/snapshot (if available, 
     else calculate: sum of amount * probability)
  c) Coverage — from pipeline/snapshot.coverage.ratio, show as "X.Xx"
  d) Active Findings — from findings/summary.total_active, 
     color-code by severity (red if >5 act, yellow if >10 watch)
  e) Win Rate — from pipeline/snapshot.win_rate.trailing_90d, 
     show as percentage

Card styling: surface background, border, 10px radius.
Grid: 5 columns with 16px gap. On narrow screens, wrap to 2 rows.

Format dollar values: $X.XM for millions, $XXXk for thousands.
Use mono font for all numbers.

2. ANNOTATED PIPELINE CHART

This is the differentiator. A horizontal bar chart showing pipeline 
by stage, where each bar is annotated with findings.

Data source: pipeline/snapshot.by_stage array.

Chart implementation (Recharts BarChart):
  - Horizontal bars, one per stage
  - Bar color: accent blue (#3b82f6) for the deal value
  - Bar label: stage name on the left, dollar value on the right
  - Findings badges overlaid on or next to each bar:
    - Red badge with count if stage has 'act' findings
    - Yellow badge with count if stage has 'watch' findings
    - Tooltip on hover showing the top_findings messages

  Example visual:
    Discovery    ████████████████  $1.2M  🔴 3  🟡 5
    Evaluation   ██████████        $890K      🟡 2
    Proposal     ████████████████████  $2.1M  🔴 1  🟡 3
    Negotiation  ██████            $450K  🔴 2

Clicking a findings badge → filters the findings feed below to 
show only findings from that stage.

Clicking a bar → navigates to a filtered deal list (future, for 
now just filter the findings feed below).

Chart container: surface background card with header "Pipeline by Stage"
and a subtitle showing total pipeline value.

If pipeline/snapshot returns no data (no deals), show an empty state:
"No pipeline data. Connect a CRM to get started." with a link to /connectors.

3. FINDINGS FEED

A scrollable list of active findings, sorted by severity then recency.
This is the "what needs attention" feed.

Data source: GET /findings?status=active&sort=severity&limit=20

Each finding card:
  - Severity indicator: red dot (act), yellow dot (watch), 
    blue dot (notable), gray dot (info)
  - Finding message text (13px, text color)
  - Metadata row below (12px, textMuted):
    - Skill name that produced it
    - Deal name (clickable → navigates to /deals/:dealId)
    - Owner name/email
    - Time ago (e.g., "2h ago", "yesterday")
  - On hover: surfaceHover background

Card styling: no individual card borders. Use a simple list with 
dividers (1px border between items). The whole feed sits in a 
surface-background card.

Header: "Active Findings" with count badge and filter controls:
  - Severity filter: buttons for All / Act / Watch / Notable
  - Skill filter: dropdown of skill names
  - Owner filter: dropdown of rep names/emails

Clicking severity filter or stage badge from the chart → updates 
the findings feed filter.

Pagination: "Load more" button at bottom, or infinite scroll.

4. CONNECTOR STATUS STRIP

A compact row at the bottom showing connected data sources.

Data source: Fetch connector status from the API. If there's an 
existing endpoint for connectors, use it. If not, build a simple 
one that reads from connector_configs table.

Each connector card (inline, horizontal):
  - Status dot: green (synced < 24h), yellow (synced < 7d), red (>7d or error)
  - Source name: "HubSpot", "Salesforce", "Gong", "Fireflies"
  - Last sync: "2h ago", "yesterday", etc.
  - Record count: "6,062 records"

Clicking a connector → navigates to /connectors.

Card styling: single row of small cards, surface background, minimal.

5. RIGHT SIDEBAR (optional — build if layout allows)

If the page feels sparse, add a right sidebar panel with:
  - "Quick Actions" section:
    - "Run Pipeline Hygiene" button → POST /skills/pipeline-hygiene/run
    - "Run Forecast Update" button → POST /skills/forecast-rollup/run
    - Show a spinner while running, then "✓ Complete" with link to results
  - "Recent Skill Runs" section:
    - Last 5 skill runs with skill name, time, and status dot
    - Data source: query skill_runs table or GET /skills (if it returns lastRunAt)

If the layout doesn't support a right sidebar elegantly, skip it — 
the headline metrics + chart + findings feed are the core experience.

6. LOADING STATES

While APIs are loading:
  - Headline metrics: show skeleton rectangles (surfaceHover background, 
    same dimensions as final content, subtle pulse animation)
  - Chart: show a card-sized skeleton
  - Findings: show 5 skeleton list items

Never show a full-page spinner. Load each section independently.

7. ERROR STATES

If an API call fails:
  - Show the error in the specific section, not a full-page error
  - "Failed to load pipeline data. Retry" link
  - Other sections continue to work independently

8. AUTO-REFRESH

The Command Center should refresh data every 5 minutes:
  - Refetch pipeline/snapshot, findings/summary, findings
  - Update badge counts in sidebar
  - Show "Last refreshed: X min ago" in the top bar

Don't refresh while the user is interacting (scrolling findings, 
hovering chart). Use a visibility API check — only refresh when 
the tab is active.

VERIFY:
- Page loads with real data from all three API endpoints
- Headline metrics show formatted numbers with trend indicators
- Pipeline chart renders with correct stage data
- Findings badges appear on chart bars that have findings
- Clicking a severity badge filters the findings feed
- Findings feed shows severity dots, messages, deal links
- Deal name in findings is clickable (navigates to /deals/:dealId)
- Connector status strip shows correct sync times
- Loading skeletons appear before data loads
- Auto-refresh updates data after 5 minutes
```

---

## Prompt B3: Deal + Account Detail Pages

```
Read the Phase A dossier API responses:
1. GET /api/workspaces/:id/deals/:dealId/dossier
2. GET /api/workspaces/:id/accounts/:accountId/dossier

Also read the DealDossier and AccountDossier interfaces from 
server/dossiers/ to understand every field available.

BUILD THE DEAL DETAIL PAGE (route: /deals/:dealId):

This is Pandora's unique view — it stitches CRM data, conversation 
intelligence, activity history, and AI findings into a single page 
that neither the CRM nor Clari provides.

LAYOUT:

Top section — Deal header:
  - Deal name (17px, 700 weight)
  - Amount (mono, 24px) + Stage badge (colored pill)
  - Owner name + Close date + Days open
  - Health signals as a row of small indicators:
    - Activity: green/yellow/red dot + "Active"/"Cooling"/"Stale"
    - Threading: icon + "Multi"/"Dual"/"Single"
    - Velocity: icon + "Fast"/"Normal"/"Slow"
    - Data: progress bar showing completeness %

Below the header, a two-column layout:

LEFT COLUMN (wider, ~65%):

a) Active Findings (if any)
   - List of finding cards from dossier.findings
   - Same severity-dot + message format as Command Center feed
   - If no findings: "No active findings for this deal"

b) Stage History timeline
   - Vertical timeline showing stage progression
   - Each node: stage name, date entered, days in stage
   - Current stage highlighted with accent color
   - If stage_history is empty: "Stage history not available"

c) Activity Timeline
   - Chronological list of activities (most recent first)
   - Each item: date, type icon (email/call/meeting/task), subject, owner
   - Max 20 items with "Show more" link
   - If empty: "No activity records"

d) Conversations
   - List of linked conversations
   - Each item: title, date, duration, participant count
   - If conversation has a summary: show first 2 lines, expand on click
   - Link confidence indicator if link_method is available:
     - Solid line for 'crm_metadata' or 'participant_email'
     - Dotted line for 'domain_inferred'
   - If empty: "No linked conversations"

RIGHT COLUMN (~35%):

a) Contacts card
   - List of contacts associated with this deal
   - Each: name, title, role badge, last activity date
   - Primary contact marked with a star or "Primary" badge
   - If empty: "No contacts linked — this deal is single-threaded"

b) Deal Details card
   - All deal fields in a key-value list:
     - Source, Pipeline, Probability, Forecast Category
     - Created date, Close date, Last modified
   - Only show fields that have values

c) Ask Pandora (optional — wire if time allows)
   - A text input at the bottom of the right column
   - Placeholder: "Ask about this deal..."
   - On submit: POST /analyze with scope: { type: 'deal', entity_id: dealId }
   - Show response below the input
   - This is the Layer 3 (scoped analysis) surface in the UI

BUILD THE ACCOUNT DETAIL PAGE (route: /accounts/:accountId):

Similar structure, but account-focused:

Top section — Account header:
  - Account name (17px, 700 weight)
  - Domain, Industry, Employee count, Revenue
  - Relationship summary: total deals, open value, won value

LEFT COLUMN:

a) Deals list
   - All deals for this account (open first, then closed)
   - Each: deal name (clickable → /deals/:id), amount, stage, owner
   - Open deals in surface cards, closed deals in muted style

b) Conversations timeline
   - All conversations linked to this account
   - Show which deal each conversation is linked to (if any)
   - Unlinked conversations shown with dotted border

c) Activity summary
   - Recent activities across all deals for this account

RIGHT COLUMN:

a) Contact Map
   - All contacts at this account
   - Group by: decision maker / champion / influencer / user (from role field)
   - If role is null: show as "Unknown role"

b) Account Details card
   - All account fields in key-value format

c) Findings across all deals
   - Aggregate findings from all deals in this account

NAVIGATION BETWEEN DEAL AND ACCOUNT:

- Deal page shows the account name (clickable → /accounts/:accountId)
- Account page shows deal names (clickable → /deals/:dealId)
- Use the browser back button naturally (React Router handles this)

LOADING + EMPTY STATES:

- Dossier endpoint returns all data in one call. Show skeleton 
  for the full page while loading.
- Sections with no data show a brief empty message, not a big 
  empty state card. Keep it minimal.
- If the dossier API returns 404 (deal not found): show 
  "Deal not found" with a link back to Command Center.

VERIFY:
- Navigate to /deals/:dealId (use a real deal ID from your data)
- All sections render with real data
- Health signals show correct colors based on dossier data
- Stage history timeline renders in order
- Clicking account name navigates to account page
- Clicking a deal on the account page navigates to deal page
- Ask Pandora input sends request and shows response (if wired)
- Empty sections show graceful messages, not errors
```

---

## Prompt B4: Supporting Pages

```
Build three supporting pages that complete the core navigation. 
These are simpler than the Command Center and dossier pages.

1. SKILLS PAGE (route: /skills)

Data source: GET /api/workspaces/:id/skills (list of registered skills)
Also query: Each skill's last run from GET /api/workspaces/:id/skills/:id/runs?limit=1

Layout: A list/table of all skills.

Each skill row:
  - Skill name (13px, 600 weight)
  - Description (12px, textMuted)
  - Category badge (e.g., "pipeline", "coverage", "data-quality")
  - Schedule (e.g., "Monday 8 AM", "Post-sync", "Manual")
  - Last run: time ago + status dot (green=completed, red=failed)
  - "Run Now" button (accent, small) → POST /skills/:id/run
    - Show spinner while running
    - On complete: update last run time, show success toast
    - On error: show error toast

Clicking a skill row → navigates to /skills/:skillId/runs

SKILL RUN HISTORY PAGE (route: /skills/:skillId/runs)

Data source: GET /api/workspaces/:id/skills/:skillId/runs

Layout: Back link to /skills, skill name as header, then a 
table/list of runs.

Each run row:
  - Run ID (mono, truncated)
  - Started at (formatted date + time)
  - Duration (e.g., "12.3s")
  - Status: completed/failed/running badge
  - Token usage (if available)
  - Trigger: manual/scheduled/webhook badge

Clicking a run → expands to show the full output:
  - The narrative text from the skill output
  - If output has evidence/claims: show them
  - Format nicely — render markdown if the output is markdown

2. CONNECTORS PAGE (route: /connectors)

Data source: Fetch from connector_configs table. Find the existing 
endpoint or build a simple one:
  GET /api/workspaces/:id/connectors
  Returns: [{ source_type, status, last_sync, record_counts, created_at }]

Layout: Grid of connector cards (2-3 per row).

Each connector card:
  - Source icon/logo (use a colored circle with first letter if no icon)
  - Source name: "HubSpot", "Salesforce", "Gong", "Fireflies", "File Import"
  - Status: large status dot + text ("Connected", "Syncing", "Error")
  - Last sync: formatted time
  - Record counts: "6,062 deals · 1,247 contacts · 892 accounts"
  - "Sync Now" button → trigger a sync (if endpoint exists)
  - "Disconnect" link (textMuted, shows confirmation dialog)

For unconnected sources, show a muted card with "Connect" button.
The connect flow is complex (OAuth redirect for HubSpot/Salesforce, 
API key input for Gong/Fireflies). For now, the "Connect" button 
shows instructions text explaining how to connect via the API, with 
a link to docs. Don't try to build the full OAuth UI yet.

Empty state (no connectors): 
  "Connect your first data source to get started."
  Show cards for HubSpot, Salesforce, Gong, Fireflies, and 
  File Import with "Set Up" buttons.

3. INSIGHTS FEED PAGE (route: /insights)

Data source: GET /api/workspaces/:id/findings?status=all&sort=recency&limit=50

This is a chronological stream of ALL findings (active + resolved), 
most recent first. Think of it as the activity log of Pandora's 
analysis.

Layout: Single column, full width, infinite scroll.

Each finding item:
  - Time: formatted date + time on the left (or "today", "yesterday")
  - Severity dot
  - Finding message
  - Metadata: skill name, deal name (clickable), owner
  - If resolved: show with muted styling and "Resolved" label + 
    resolved timestamp

Group by date: "Today", "Yesterday", "This Week", "Older"

Filter bar at top:
  - Severity: All / Act / Watch / Notable
  - Skill: dropdown
  - Status: Active / Resolved / All (default: All)
  - Date range: This Week / This Month / All Time

Load more: button at bottom or infinite scroll (fetch next page 
using offset from pagination).

SHARED PATTERNS FOR ALL THREE PAGES:

- Loading: skeleton placeholders matching the final layout
- Empty: centered message with helpful guidance
- Error: inline error with retry link
- Consistent use of the design system colors, fonts, spacing
- Table/list rows have surfaceHover on hover
- Badge styling matches Command Center findings

VERIFY:
- /skills shows all registered skills with last run times
- "Run Now" button triggers a skill and updates status
- /skills/:id/runs shows run history with expandable output
- /connectors shows all connected sources with status
- /insights shows chronological findings with working filters
- Navigation between all pages works via sidebar
- All pages use consistent design system styling
```

---

## Build Order

```
B1 (Shell + Navigation)     → framework, everything else builds inside it
  ↓
B2 (Command Center Home)    → the landing page, highest visibility
  ↓
B3 (Deal + Account Detail)  → the drill-through experience
  ↓
B4 (Supporting Pages)       → completes the core navigation
```

B1 and B2 should be done in one session (~8-10 hours).
B3 and B4 can be done in a second session (~8-10 hours).

After Phase B: Pandora has a working frontend that looks and 
feels like a product. Every API from Phase A has a UI surface. 
The "digital operating system" positioning becomes tangible.

---

## What NOT to Build in Phase B

- Agent Builder UI (Phase C — needs more skill diversity)
- Playbook editor (Phase C — schedule config exists via API)
- Data Dictionary page (Phase C — low priority)
- Settings page with full config editing (Phase C — API-only for now)
- Users & Teams management (Phase C — single admin for now)
- Marketplace (future)
- Mobile responsive layout (desktop-first)
- Dark/light theme toggle (dark only)
- Real-time websocket updates (polling every 5 min is fine)
- Keyboard shortcuts (nice to have, not now)
- Animations or transitions beyond hover states
- Custom chart interactions beyond click-to-filter
