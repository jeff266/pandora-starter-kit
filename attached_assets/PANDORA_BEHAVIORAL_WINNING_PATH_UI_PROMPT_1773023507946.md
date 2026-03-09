# Replit Prompt: Behavioral Winning Path UI

Pull latest from GitHub. Read these files first:

- `client/src/pages/` — find an existing skill page (Stage Velocity or
  Coaching Intelligence) and understand the page structure, how it fetches
  from the API, how it handles loading/error/empty states, and how it uses
  the workspace context
- `client/src/components/` — find the skill run trigger pattern (the "Run Now"
  button used by other skill pages)
- `server/routes/skills.ts` — confirm the two new endpoints exist:
  - `GET /:workspaceId/skills/behavioral-winning-path/latest`
  - `GET /:workspaceId/skills/behavioral-winning-path/tier`
- The sidebar nav — find where skill pages are registered so you can add
  the new page to navigation

You're building the Behavioral Winning Path page. It renders the
`MilestoneMatrix` JSON returned by the API endpoint as a visual, interactive
card grid. A working React prototype of the UI already exists — you are
porting it into the real app and connecting it to live data.

---

## What the API returns

The `GET /:workspaceId/skills/behavioral-winning-path/latest` endpoint
returns a `MilestoneMatrix` object. The shape you need to handle:

```typescript
interface BehavioralMilestone {
  id: string;
  timeWindow: string;         // "Day 0–30"
  windowStart: number;        // days from opp created
  windowEnd: number;
  title: string;
  subtitle: string;
  source: string;             // "CI" | "Email" | "CRM Roles" | "Stage History"
  tier: 1 | 2 | 3 | 4;
  signals: string[];          // underlying signal list (shown in detail panel)
  wonPct: number;             // % of won deals with this signal
  lostPct: number;
  lift: number;               // win rate lift (e.g. 2.4)
  avgDaysToMilestone: number;
  insufficientData?: boolean; // true = fewer than 3 deals in cohort
}

interface MilestoneMatrix {
  tier: 1 | 2 | 3 | 4;
  tierLabel: string;          // "Conversation Intelligence (Gong / Fireflies)"
  confidenceNote: string;     // shown for tiers 2–4
  summary: string;            // Claude's narrative synthesis
  wonMilestones: BehavioralMilestone[];
  lostAbsences: {
    milestoneId: string;
    title: string;
    source: string;
    lostDealPct: number;
    liftIfPresent: number;
  }[];
  meta: {
    totalWonDeals: number;
    totalLostDeals: number;
    avgWonCycleDays: number;
    avgLostCycleDays: number;
    analysisPeriodDays: number;
    generatedAt: string;
  };
}
```

The `/tier` endpoint returns:
```typescript
{
  tier: 1 | 2 | 3 | 4;
  tierLabel: string;
  availability: {
    conversations: { exists: boolean; count: number; withTranscripts: number; linkedToDealsPct: number; };
    emailActivities: { exists: boolean; count: number; distinctDeals: number; };
    contactRoles:   { exists: boolean; dealsWithMultipleContacts: number; dealsWithRoles: number; };
    stageHistory:   { exists: boolean; count: number; distinctDeals: number; };
  };
}
```

---

## Page: BehavioralWinningPathPage

Create `client/src/pages/BehavioralWinningPathPage.tsx`.

Register it in the router and sidebar nav alongside the other skill pages.
Use the same nav label style as existing skill pages: "Winning Path".

### Data fetching

On mount, make two parallel requests:
1. `GET /api/workspaces/{workspaceId}/skills/behavioral-winning-path/tier`
   — use this to immediately render the tier badge and upgrade prompt if
   needed, before the full result loads
2. `GET /api/workspaces/{workspaceId}/skills/behavioral-winning-path/latest`
   — the full MilestoneMatrix

If `/latest` returns 404 (no run yet), show the empty state (see below).

### Loading state

Show a skeleton matching the grid layout: one header row, two content rows
(Won + Lost), four columns. Use the same skeleton pattern as other skill pages.

### Empty state (no run yet)

```
[No analysis yet]
Run Behavioral Winning Path to identify the behavioral sequences that
characterize your won deals.

[Run Now button]
```

### Error state

Use the same error component as other skill pages.

---

## Layout

The page is a full-width grid. Follow the dark theme used throughout Pandora
(background #05080f, surface #0f1520, border #1e2a3d, text #dde4f0).

### Header row

Left side:
- Page title: "Winning Path"
- Subtitle: "Behavioral milestones that characterize won deals — sourced from
  {tierLabel}"
- Tier badge (see Source badges below)
- Meta: "{totalWonDeals} won · {totalLostDeals} lost · {analysisPeriodDays}-day window"
- Last run timestamp

Right side:
- Source legend badges (CI, Email, CRM Roles, Stage History — show only the
  ones relevant to the current tier)
- "Lost patterns" toggle button (toggles the lost row visibility)
- "Run Now" button (POST to trigger endpoint, same pattern as other skill pages)

### Confidence note banner

If tier is 2, 3, or 4, show a yellow/amber banner directly below the header:
```
⚠ {confidenceNote}
```
Do not show this for Tier 1.

### Column grid

Five columns total:
- Col 0 (narrow, ~110px): Row labels ("Won n=X", "Lost n=X")
- Col 1–4: Time windows

**Column headers** (sticky on scroll):
| Day 0–30 | Day 31–60 | Day 61–90 | Day 91–120+ |
| Opening motion | Champion & use case | Technical validation | Executive & close |

**Won row** (green left label):
Each milestone card is positioned in the column matching its `windowStart`:
- windowStart < 31 → col 1
- windowStart 15–60 → col 2
- windowStart 45–90 → col 3
- windowStart 75+ → col 4

Multiple milestones in the same column stack vertically with 8px gap.

**Lost row** (red left label, toggleable):
Same column layout. Uses `lostAbsences` array.

### Milestone cards — Won (green)

Each card:
```
[source badge]         [timeWindow]
Title (13px, semibold)
Subtitle (11px, secondary color)
[wonPct% of won deals] [lift× win rate lift]
```

Source badge colors:
- CI → teal (#22d3ee) background teal/10, border teal/22
- Email → purple (#a78bfa) background purple/10, border purple/22
- CRM Roles → purple (same as Email)
- Stage History → amber (#fbbf24) background amber/10, border amber/22
- CI + CRM → amber

If `insufficientData: true`: render the card greyed out with a
"Insufficient data" label instead of the stats row. Border stays but
opacity drops to 60%.

On click: select this milestone and open the detail panel below the grid.
Active card gets a green border (#0fd9a2) and subtle green background tint.

### Milestone cards — Lost (red)

Each card:
```
[source badge]         [↓ absent]
Title (12px, semibold, pinkish text #e8a0a7)
[liftIfPresent× more likely to lose]
```

Cards are not clickable. Always shown with red border/background tint.

### Detail panel

When a won milestone card is selected, a panel appears below the grid
with a green border/glow:

```
Signal breakdown · {timeWindow}
{title}
{subtitle}

Underlying signals:        [% of won deals] [win rate lift] [Source]
→ signal 1                 87%              2.4×            CI
→ signal 2                 {wonPct}         {lift}          {source}
→ signal 3                 "of won deals"   "lift vs absent"
```

Stats cards:
- % of won deals: green (#0fd9a2)
- Win rate lift: amber (#fbbf24)
- Source: source badge color

X button closes the panel (deselects the card).

---

## Synthesis panel

Below the milestone grid, render the Claude synthesis text as a card:

```
┌─────────────────────────────────────────┐
│ AI Analysis                             │
│ {summary text from MilestoneMatrix}     │
│                                         │
│ {meta: last run, analysisPeriodDays}    │
└─────────────────────────────────────────┘
```

The summary is pre-structured text with sections (HEADLINE, TOP 3, etc.)
— render it as formatted text (parse line breaks, bold the section labels).

---

## Upgrade prompt (Tier 2, 3, 4 only)

At the bottom of the page, show a card:

**Tier 2 (Email only):**
```
Connect conversation intelligence to unlock full behavioral analysis
Gong or Fireflies would replace email engagement proxies with transcript-
based signals: champion multi-threading, use case articulation, technical
win language, and executive activation.
[Connect Gong]  [Connect Fireflies]
```

**Tier 3 (Contact roles only):**
```
Connect email or conversation intelligence for behavioral signal analysis
Current analysis uses CRM contact associations as proxies. Email or call
data would confirm whether those contacts were actually engaged.
[Connect Email]  [Connect Gong]
```

**Tier 4 (Stage history only):**
```
Connect conversation intelligence, email, or enrich contact roles
Stage-based milestones reflect CRM record movement, not buyer behavior.
Any engagement data layer would significantly improve signal quality.
[Go to Connectors]
```

Link the connector buttons to the existing Connectors page.

---

## Run Now behavior

Use the same pattern as other skill pages:
1. POST to `/api/workspaces/{workspaceId}/skills/behavioral-winning-path/run`
2. Show a "Running…" spinner on the button
3. Poll `/latest` every 5 seconds
4. When a new `generatedAt` timestamp appears, refresh the page data
5. Show a success toast: "Winning Path updated"

---

## Acceptance criteria

- [ ] Page renders with seed/empty state when no run exists
- [ ] Loading skeleton matches grid shape (header + 2 rows + 4 columns)
- [ ] Tier badge appears in header before full data loads (from /tier endpoint)
- [ ] Confidence note banner visible for Tiers 2, 3, 4; hidden for Tier 1
- [ ] All won milestone cards render with correct source badge color
- [ ] Cards with `insufficientData: true` render greyed-out with label
- [ ] Lost row toggles correctly; state persists across runs within session
- [ ] Clicking a won milestone opens detail panel; clicking again or X closes it
- [ ] Only one detail panel open at a time
- [ ] Synthesis card renders below grid with summary text
- [ ] Upgrade prompt shows correct copy for current tier
- [ ] Run Now triggers skill, polls for completion, refreshes data
- [ ] Page added to sidebar nav and router without breaking existing pages
- [ ] No TypeScript errors
