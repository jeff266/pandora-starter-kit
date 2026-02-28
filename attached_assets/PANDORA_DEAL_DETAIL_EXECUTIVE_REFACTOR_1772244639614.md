# PANDORA: Deal Detail Page — Executive-First Refactor

Read REPLIT_CONTEXT.md if you haven't already.

## Context

The Deal Detail page currently shows all information at equal visual weight — contacts, deal metadata, stage history, timeline, coverage gaps, and score history are all rendered simultaneously regardless of whether they have data. This creates a busy layout that doesn't serve either executive users (CRO/VP who need a 30-second read) or analyst users (RevOps who need drill-down detail).

This refactor restructures the Deal Detail page into a three-tier information hierarchy: executive summary first, supporting insights second, drill-down detail third.

**Design reference:** A React mockup file `deal-detail-executive.jsx` is available in the project. Use it as a visual/structural guide, NOT as source code — it uses hardcoded data and inline styles. All implementation must wire to existing backend APIs and follow existing component/styling patterns.

---

## Architecture Reference

### Data Source: Deal Dossier

The deal detail page is powered by the `deal_dossier` assembler (from PANDORA_COMMAND_CENTER_SPEC):

```
GET /api/workspaces/:id/deals/:dealId/dossier
Optional header: X-Include-Narrative: true → triggers Claude synthesis
```

Returns:
```typescript
{
  deal: { name, amount, stage, close_date, owner, pipeline,
          days_in_stage, health_score, velocity_score,
          created_date, forecast_category },
  stage_history: [{ from_stage, to_stage, changed_at }],
  contacts: [{ name, title, email, seniority,
               buying_role, role_confidence, last_activity_date }],
  conversations: [{ title, started_at, duration_seconds,
                    participants, summary, link_confidence }],
  skill_findings: [{ skill_id, severity, message, found_at }],
  enrichment: { buying_committee_size, roles_identified,
                account_signals, icp_fit_score } | null,
  coverage_gaps: { unlinked_calls, contacts_never_called,
                   days_since_last_call }
}
```

If the dossier endpoint doesn't exist yet, build it first following the spec in PANDORA_COMMAND_CENTER_SPEC (Phase A3). The page should gracefully degrade if the endpoint returns partial data.

### Existing Components to Reuse

Check what already exists on the current Deal Detail page:
- Deal header component (name, amount, stage, owner, close date)
- B-score display
- Status indicators (Activity, Threading, Health, Data)
- Contacts list component
- Coverage Gaps component
- Stage History component
- "Ask about this deal" chat input
- "Generate Summary" button

We are restructuring layout and hierarchy, not rebuilding from scratch.

---

## Three-Tier Layout Specification

### TIER 1: Executive Summary (must fit in first viewport — no scrolling)

This is what a CRO sees in 30 seconds. Everything above the fold.

**1a. Deal Header (compact)**
- Deal name (h1, truncate with tooltip if long)
- Amount in monospace/display font — this is the anchor number
- Stage badge (colored pill)
- B-score as a circular ring indicator (single number, single color)
  - ≥80: green, 60-79: amber, <60: red
  - Small "B" label above the number inside the ring
- Owner, close date, account name — secondary line, muted text
- Remove the four status dots (Activity, Threading, Health, Data) from the header — these are analyst-level signals that should roll into the B-score or appear as insight cards below

**1b. AI Narrative (hero section — auto-generated, not behind a button)**
- Render immediately below the header
- Full-width card with subtle gradient top border (accent color strip)
- Label: "✦ AI Deal Intelligence" in uppercase small text
- Content: 3-5 sentence narrative synthesizing the dossier data
- On page load: if `X-Include-Narrative: true` is supported, fetch with narrative. If not, call a synthesis endpoint that takes the dossier data and returns a narrative
- **If narrative is loading:** show a skeleton/shimmer state (not a "Generate Summary" button)
- **If narrative fails:** fall back to a structured summary assembled client-side from the dossier fields (e.g., "{amount} {stage} deal. {N} contacts identified, {M} engaged. Last activity: {date or 'None recorded'}.")
- Remove the separate "Generate Summary" button — the narrative IS the page

### TIER 2: Key Insights (the "why should I care" layer)

Directly below the narrative, these are 2-3 cards that back up the AI summary with specific, actionable findings.

**2a. Insight Cards (max 3, dynamically generated)**

These cards are severity-coded and generated from the dossier data. Each card has:
- Severity indicator (colored dot + label): critical (red), warning (amber), info (blue)
- Title in uppercase small text
- 1-3 sentence explanation with bold callouts for key numbers

Card generation logic — show cards that are relevant based on data:

| Condition | Card Title | Severity | Content |
|-----------|-----------|----------|---------|
| contacts with buying_role='Decision Maker' where last_activity_date is null > 0 | Single-Thread Risk | critical | "{N} of {total} decision makers have been engaged. The economic buyer ({name}, {title}) has had zero touchpoints." |
| No conversations AND no activities | Activity Gap | warning | "No activity or conversations recorded in CRM or connected conversation tools. Unable to assess deal momentum." |
| days_in_stage > 14 AND stage is not closed | Stalled Deal | warning | "This deal has been in {stage} for {days} days without stage progression." |
| coverage_gaps.unlinked_calls > 0 | Unlinked Conversations | info | "{N} conversations with matching domain participants are not linked to this deal." |
| skill_findings with severity='critical' | Skill Finding | critical | Render the finding message directly |

If no conditions are met (rare), show a single green "On Track" info card.

Only show top 2-3 most severe cards. Don't show 5+ cards — that defeats the purpose.

**2b. Stakeholder Coverage Summary**

Replace the full 10-contact list with a visual summary:
- Three ring indicators side by side:
  - Decision Makers: {engaged}/{total} with role-colored ring
  - Economic Buyer: {engaged}/{total}
  - Influencers: {engaged}/{total}
- Each ring shows: small donut progress, count inside, label below
- Red rings when 0 engaged, partial fill when some engaged, full green when fully covered
- This entire section is one compact row — not a card per contact

Compute from dossier `contacts` array grouped by `buying_role`, checking `last_activity_date` for engagement.

**2c. Recommended Next Steps**

AI-generated or rule-based prioritized actions:
- P0/P1/P2 priority labels (color-coded: red/amber/blue)
- Each action is one sentence, specific and actionable
- Max 3 actions

Rule-based generation logic (if AI synthesis not available):
- P0: If economic buyer unengaged → "Multi-thread into {name} ({title}) — schedule introductory meeting"
- P0: If zero activity → "Confirm deal is active with owner ({email}) — zero CRM activity may indicate offline management"
- P1: If stage_history is empty → "Request CRM stage history tracking to be enabled"
- P1: If unlinked calls > 0 → "Review {N} unlinked conversations for potential deal intelligence"
- P2: If contacts with role='Unknown' exist → "Classify {N} contacts with unknown buying roles"

### TIER 3: Drill-Down Detail (expandable, collapsed by default)

Everything the analyst needs, but NOT visible by default.

Section label: "Details" in small uppercase muted text above the expandable sections.

**All sections are collapsible accordions, ALL collapsed on initial load:**

**3a. All Contacts** (badge: count)
- Full contact list with avatar initial, name, title, role badge, engagement dot
- Role badges color-coded: Decision Maker (red), Influencer (blue), Economic Buyer (amber), Unknown (gray)
- Engagement dot: green (has activity), red (no activity)

**3b. Deal Metadata**
- Two-column grid of CRM fields: Source, Pipeline, Probability, Forecast, Close Date, Created Date, Pandora Pipeline, Last Modified
- This is the metadata that was previously prominent — now it's tucked away

**3c. Stage History**
- If data exists: chronological stage transitions with dates
- If empty: "Stage history not available — requires CRM field history tracking to be enabled." (helpful empty state, not just "not available")

**3d. Timeline / Activity**
- If conversations or activities exist: chronological feed
- If empty: "No activity or conversation records found. Connect a conversation intelligence tool for richer deal context."

**3e. Score History**
- If data exists: B-score trend over time (simple line or sparkline)
- If empty: hide entirely (don't even show the section)

**3f. Skill Findings (if any exist)**
- Full list of findings from `skill_findings` in dossier
- Only show this section if there are findings to display

---

## Floating Action

Keep the "Ask about this deal" button as a floating action in the bottom-right corner:
- Pill shape, accent-colored background, with chat icon
- Position: fixed, bottom: 24px, right: 24px
- On hover: subtle scale and shadow increase
- On click: opens the existing scoped chat/analysis input (wired to POST /analyze with deal scope)

---

## Empty State Handling

CRITICAL: Empty states should NEVER be blank panels taking up space.

Rules:
1. If a Tier 3 section has no data, it still appears as a collapsible header but shows a helpful message when expanded explaining WHY it's empty and WHAT the user can do about it
2. If Score History has no data, hide the section entirely
3. If ALL insight cards would be empty (no risk signals at all), show a single green "No Issues Detected" card
4. The AI narrative should always render SOMETHING — even if it's a client-side fallback summary

---

## Implementation Notes

**Do NOT:**
- Create a parallel component file — refactor the existing Deal Detail page/route in place
- Use inline styles — follow existing project CSS patterns (CSS modules, Tailwind, styled-components — whatever the project uses)
- Hardcode deal data — everything comes from the dossier API
- Import the mockup JSX file as a component

**DO:**
- Check what components already exist and reuse/restructure them
- Add loading/skeleton states for the AI narrative
- Make the tier 3 accordion state persistent in URL params or local state (so refresh remembers what was expanded)
- Ensure the page works when dossier returns partial data (e.g., no enrichment, no conversations, no findings)
- Test with real workspace data — try Imubit (Salesforce) and one HubSpot workspace
- Mobile: not required for v1, but don't break responsiveness entirely — single column stack is fine

**Performance:**
- The dossier API call should be the single data fetch on page load
- AI narrative can be a secondary async call (don't block the page on it)
- Tier 3 sections should not make additional API calls — everything comes from the dossier

---

## Validation Checklist

Before considering this done:

- [ ] Tier 1 (header + AI narrative) fits in first viewport on 1080p display without scrolling
- [ ] AI narrative auto-generates on page load (no button required)
- [ ] Insight cards dynamically appear/disappear based on actual deal data
- [ ] Stakeholder coverage rings correctly count engaged vs total by role
- [ ] All Tier 3 sections are collapsed by default
- [ ] Empty sections show helpful messages, not blank panels
- [ ] Score History section is hidden when no data exists
- [ ] "Ask about this deal" floating button works and opens scoped chat
- [ ] Page renders correctly with partial dossier data (missing enrichment, conversations, etc.)
- [ ] Tested against at least one real workspace with production data
