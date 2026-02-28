# PANDORA: Conversation Detail Page — Executive-First Refactor

Read REPLIT_CONTEXT.md if you haven't already.

## Context

The Conversation Detail page (`client/src/pages/ConversationDetail.tsx`, ~1,424 lines) currently renders as flat tabs with equal visual weight. A manager reviewing a call they weren't on has to click through tabs to piece together what happened. This refactor restructures the page into the same three-tier pattern used on Deal Detail: executive summary first (call intelligence narrative), supporting insights second (tabbed impact/actions/coaching), drill-down detail third (collapsible accordions).

**Design reference:** A React mockup file `conversation-detail-executive.jsx` is available in the project. Use it as a visual/structural guide only — it has hardcoded data and inline styles. All implementation must wire to existing API endpoints and use the project's `colors`/`fonts` theme from `../styles/theme`.

---

## What Exists Today

### Component Structure
- Single file: `client/src/pages/ConversationDetail.tsx`
- Three inline sub-components at bottom of file: `DealImpactTab`, `ActionTrackerTab`, `CoachingSignalsTab`
- State variables: `dossier`, `loading`, `error`, `activeTab`, `coachingData`, `coachingLoading`
- No external child component files — fully self-contained

### Data Sources (both already wired)
1. **Primary:** `GET /api/workspaces/:id/conversations/:conversationId/dossier`
   - Auto-fetched on mount, has proper `finally` pattern
   - Contains: conversation metadata, deal context, contacts, `resolved_participants` (JSONB), `skill_findings`, `coaching_signals` (from `generateCoachingSignals()` in `server/coaching/coaching-signals.ts`)
2. **Secondary:** `GET /api/workspaces/:id/deals/:dealId/coaching`
   - Fires after dossier loads if deal is linked
   - Contains: Stage Journey data, composite verdict, stage-velocity benchmark comparison
   - Gated by `coaching_mode` field (`active` | `retrospective` | `hidden`)

### Routing
- React Router v6, defined in `App.tsx` line 258
- Route: `/conversations/:conversationId`
- Param: `conversationId` via `useParams()`
- Do NOT change the route path or param name

### Styling
- Inline styles using shared `colors` and `fonts` theme object from `../styles/theme`
- Same pattern as DealDetail and AccountDetail
- Do NOT introduce Tailwind, CSS modules, or styled-components
- Continue using the existing theme import for all color/font values

### Data Model
- `conversations` table has direct `deal_id` and `account_id` foreign keys
- Participants stored as `resolved_participants` JSONB column
- Dossier assembler joins `deal_contacts` → `contacts` to determine expected vs actual participants
- Coaching linked through `deal_id` → coaching endpoint

---

## Three-Tier Layout Specification

### TIER 1: Call Header + AI Narrative (first viewport, no scrolling)

This is what a manager sees in 30 seconds without clicking anything.

**1a. Call Header (compact)**

Restructure the existing header into:
- Call title (h1)
- Metadata row: duration, date, participant avatars (initials in circles, color-coded internal vs external using theme colors), participant count
- Internal participants: use `colors.accent` tones for avatar border/background
- External participants: use `colors.amber` or similar warm tone
- Derive internal/external from `resolved_participants` — internal = matches workspace member emails, external = everyone else

**1b. Deal Context Strip**

Compact single-row card showing the linked deal context:
- Deal name (clickable, links to `/deals/:dealId`), Amount, Stage, Close Date, Contacts on this call
- Health tag pill (Healthy/At Risk/Critical) derived from the dossier's deal health data
- If no deal is linked, show: "No deal linked to this conversation" with muted styling
- This replaces any full-width deal header that exists today — keep it tight

**1c. AI Call Narrative (hero section — auto-generated on load)**

This is the biggest structural change. The current page has no auto-generated narrative.

- Full-width card below the deal context strip
- Label: "✦ Call Intelligence" in uppercase small text
- Content: 3-5 sentence AI-generated summary of the conversation
- Source: Check if the dossier already returns a `summary` or `narrative` field. If it does, render it directly. If not, you need to add narrative synthesis.

**Adding narrative synthesis (if not already in dossier):**

Option A (preferred): Add a `narrative` field to the conversation dossier assembler in the backend. At dossier assembly time, pass the conversation summary, deal context, coaching signals, and skill findings to Claude (~1.5K token input) for a 3-5 sentence synthesis. Cache it on the conversation record with a TTL (regenerate if stale or if new skill runs have occurred). This keeps the frontend simple — it just renders `dossier.narrative`.

Option B (fallback): If backend changes are out of scope, build a client-side fallback that assembles a structured summary from dossier fields:
```
"{duration} {source} call on {date}. {participant_count} participants including {external_names}. 
Deal: {deal_name} ({amount}, {stage}). {coaching_signals summary if available}."
```
This is less compelling but ensures the hero section always has content.

- **Loading state:** Show skeleton/shimmer while dossier loads — NOT a blank section or "Generate" button
- **Error state:** Fall back to Option B structured summary

### TIER 2: Tabbed Insights (renamed and restructured)

Keep the three-tab structure but rename and reorder for clarity. The existing sub-components (`DealImpactTab`, `ActionTrackerTab`, `CoachingSignalsTab`) are refactored in place — do not create new component files.

**Tab bar styling:**
- Active tab: `colors.accent` text + bottom border
- Inactive: `colors.textMuted`
- Each tab gets a badge count showing number of items (impact findings, action items, patterns)

**Tab 1: "Deal Impact"** (rename from "Deal Health" if different)

Restructure the existing `DealImpactTab` content into this hierarchy:

*Impact Cards (top, max 3):*
Cards are severity-coded, generated from dossier data. Each has: severity dot, uppercase title, metric (if applicable), 1-3 sentence description.

Generate cards from existing data:
| Source | Card | Severity |
|--------|------|----------|
| Multi-threading change detected (new participants vs previous calls) | "Multi-Threading Improved" or "Single-Threaded" | positive or warning |
| `coaching_signals` with stale stage flag | "Stage May Be Stale" | warning |
| `skill_findings` with severity=critical | Skill finding title | critical |
| No activity in N days before this call | "Engagement Gap" | warning |
| First call with this account/deal | "First Contact" | info |

If no impact signals exist, show a single green "No Issues Detected" card.

*Engagement Snapshot (below cards):*
Three big metric tiles in a horizontal row:
- "Last call before this" → compute from conversation history, show days + warn color if >14 days
- "Unique contacts on calls" → from `resolved_participants`
- "Call to close" or "Days in stage" → from deal context + coaching benchmarks

This replaces the current orphaned "Engagement Signals" bullet points. Use `fonts.mono` for the big numbers.

*The Stage Journey chart, if currently rendered in this tab, moves to Tier 3 as a collapsible accordion.*

**Tab 2: "Action Items"** (rename from "Action Tracker" if different)

Restructure `ActionTrackerTab`:
- Each action item gets: checkbox (interactive), description text, priority badge (P0/P1/P2)
- Priority colors: P0 = `colors.red` tones, P1 = `colors.amber` tones, P2 = `colors.accent` tones
- Checked items get reduced opacity and strikethrough
- If no action items: "No action items extracted from this conversation."
- Footer note: "Action items extracted from conversation transcript via AI analysis" in muted italic

If action items are already extracted and stored in the dossier, render them. If they're not currently extracted, note this as a future enhancement and show the empty state.

**Tab 3: "Coaching Signals"** (keep name)

Restructure `CoachingSignalsTab`:
- Coaching Script CTA at top — keep the "Generate Coaching Script" button but frame it better: title + description + button in a single row card
- Gate visibility by `coaching_mode`: if `hidden`, don't show the tab at all. If `retrospective`, show the blue info banner ("This deal is closed. Signals are for coaching reviews, not current action.")
- Pattern cards: left-accent colored bar, label pill (WIN FACTOR, SIGNAL, RISK FACTOR), title, detail, deal count, pattern strength
- "These benchmarks are from YOUR pipeline data, not industry averages" footer

### TIER 3: Drill-Down Detail (collapsed accordions)

Below the active tab content, render expandable sections. ALL collapsed by default. Only show sections that have data.

**3a. Stage Journey** (badge: stage count)
- Move the existing Stage Journey visualization here from wherever it currently lives
- If `coachingData` has stage journey data, render it
- If no data: "Stage journey requires deal stage history to be available."

**3b. Participants** (badge: count)
- Full participant list from `resolved_participants`
- Each entry: avatar initial (color-coded internal/external), name, role, internal/external badge
- Cross-reference with `deal_contacts` to show who SHOULD have been on the call but wasn't (coverage gap)

**3c. Skill Findings** (badge: count) — NEW, currently not rendered
- The dossier assembles `skill_findings` but they're never displayed on this page
- Render them: each finding shows skill name, severity badge, message, timestamp
- If no findings: hide the section entirely

**3d. Full Transcript**
- If conversation source is Gong/Fireflies/Fathom, show a link to open in the source tool
- If transcript text is available in the dossier, show it in a scrollable container
- If not available: "Full transcript available in {source}. Open in {source} ↗"

---

## Implementation Approach

**Refactor in place.** Edit `ConversationDetail.tsx` directly. Do not create new files or split into separate component files — maintain the current single-file pattern.

**Refactoring order:**
1. Restructure the main component render — move the AI narrative and deal context strip above the tabs
2. Refactor `DealImpactTab` — add impact cards, engagement snapshot, move stage journey to tier 3
3. Refactor `ActionTrackerTab` — add priority badges, checkboxes, better empty states
4. Refactor `CoachingSignalsTab` — restructure pattern cards, respect `coaching_mode` gating
5. Add Tier 3 expandable sections below the tab content area
6. Wire up the narrative (either from dossier field or client-side fallback)
7. Add `skill_findings` rendering (new — data exists in dossier but is never shown)

**State changes:**
- Keep existing state variables: `dossier`, `loading`, `error`, `activeTab`, `coachingData`, `coachingLoading`
- Add: `expandedSections: Record<string, boolean>` for tier 3 accordion state (default all false)
- The `activeTab` default should remain `"health"` or whatever it is today

**Styling:**
- Use `colors` and `fonts` from `../styles/theme` for ALL color and font values
- Match the visual language of the mockup (severity-coded cards, engagement metric tiles, collapsible sections) but implement with theme tokens, not hardcoded hex values
- Use `fonts.mono` for big numbers and metrics
- Accent colors for internal participants, warm/amber for external participants

---

## Edge Cases

**No linked deal:**
- Deal context strip shows "No deal linked" in muted text
- Deal Impact tab still shows engagement signals from the conversation itself
- Coaching tab may be empty — show "Coaching signals require a linked deal"
- Stage Journey section hidden entirely

**`coaching_mode === 'hidden'`:**
- Hide the Coaching Signals tab entirely
- This is already gated — preserve the existing logic

**`coaching_mode === 'retrospective'`:**
- Show the blue info banner at top of Coaching Signals tab
- Pattern cards still render but framed as review material

**Dossier loading:**
- Tier 1 (header + narrative): show skeleton shimmer
- Tier 2 (tabs): show skeleton shimmer for active tab content
- Tier 3: don't render until dossier loaded

**No `resolved_participants`:**
- Participant avatars in header: show "Participants unavailable"
- Participants accordion: hide section

**No coaching data (secondary fetch fails or no deal linked):**
- Stage Journey: hide section
- Coaching tab: show explanatory empty state
- Engagement Snapshot: show what's available from conversation data alone

---

## Validation Checklist

- [ ] Tier 1 (header + deal strip + narrative) fits in first viewport on 1080p without scrolling
- [ ] AI narrative renders on load (no manual trigger button) — either from dossier field or client-side fallback
- [ ] Deal context strip links to deal detail page when deal name is clicked
- [ ] Tab badges show correct counts for impact findings, action items, and coaching patterns
- [ ] Impact cards dynamically appear based on actual dossier/coaching data
- [ ] Engagement Snapshot shows 3 metric tiles with theme-appropriate colors
- [ ] Stage Journey is now in Tier 3 collapsible section, not inline in the tab
- [ ] `skill_findings` from dossier are rendered (new section — previously never shown)
- [ ] All Tier 3 sections collapsed by default
- [ ] `coaching_mode` gating preserved (`hidden` = no tab, `retrospective` = info banner)
- [ ] Participants color-coded internal vs external
- [ ] All colors use theme tokens from `../styles/theme`, no hardcoded hex
- [ ] Route unchanged: `/conversations/:conversationId`
- [ ] No new component files created — refactored in place
- [ ] Page degrades gracefully when deal is not linked
- [ ] Tested with Frontera workspace (HubSpot + Gong) against real conversation data
