# Pandora — `openAskPandora` Universal Context Utility — Build Prompt

## Objective

Standardize the pattern introduced in Report Review Mode (T5: right-click → Ask Pandora)
into a single importable utility that any surface in Pandora can call to open the Ask
Pandora chat panel with pre-seeded context. This eliminates per-surface reinvention of the
pre-seed logic and ensures every entry point produces a consistent, evidence-grounded
conversation.

---

## What Exists

- `location.state.openChatWithMessage` router pattern in `App.tsx` — fires a pending
  message into `ChatPanel` on navigation
- `pendingMessage` prop on `ChatPanel` — accepts a string that becomes the opening message
- `ReportContextMenu.tsx` — first consumer of the pattern (report block right-click)
- Ask Pandora pipeline resolver — accepts system context injections
- `skill_runs` table — cached evidence per skill execution, linked to `report_generations`
- Deal dossier endpoint: `GET /api/:workspaceId/deals/:dealId/dossier`
- Account dossier endpoint: `GET /api/:workspaceId/accounts/:accountId/dossier`

---

## What Needs Building

### 1. `PandoraContext` type — canonical shape for all pre-seed contexts
### 2. `openAskPandora(context)` utility — single function any component calls
### 3. System prompt builder — converts `PandoraContext` to a structured system injection
### 4. Six consumer wiring points — surfaces that adopt the utility immediately

---

## Task 1: Define `PandoraContext` Type

Create `client/src/lib/askPandora.ts`.

```typescript
export type PandoraContextSource =
  | 'report_block'        // right-click on a report metric/narrative/action item
  | 'finding_card'        // click on a skill finding in the findings feed
  | 'metric_tile'         // click on a headline metric (pipeline, win rate, coverage)
  | 'deal_finding'        // finding card on the deal detail page
  | 'deal_metric'         // metric tile on the deal detail page (velocity, health, etc.)
  | 'account_health'      // relationship health indicator on account detail
  | 'forecast_line'       // click on a forecast series in the forecast chart
  | 'rep_scorecard_tile'  // metric tile on the rep scorecard
  | 'slack_deeplink';     // Slack alert deeplink carrying ?context= param

export interface PandoraContext {
  // Required
  source: PandoraContextSource;
  label: string;           // Human-readable name of the data point ("Pipeline Coverage")
  value: string;           // The value being questioned ("2.1x")

  // Scope (one or more)
  section?: string;        // Report section title, page name, or skill name
  dealId?: string;         // If scoped to a specific deal
  dealName?: string;
  accountId?: string;      // If scoped to a specific account
  accountName?: string;
  repId?: string;          // If scoped to a specific rep
  repName?: string;
  skillId?: string;        // Originating skill (for evidence lookup)
  skillRunId?: string;     // Specific run (for cached evidence lookup)

  // Evidence (pre-fetched or passed inline)
  evidenceRows?: EvidenceRow[];   // Structured rows from skill_runs
  evidenceSummary?: string;       // Plain-text summary if rows aren't available

  // Optional framing
  anomaly?: string;        // What's notable: "dropped 0.8x in 7 days"
  benchmark?: string;      // What normal looks like: "target is 3.0x"
  priorValue?: string;     // Previous period value for delta context
}

export interface EvidenceRow {
  label: string;
  value: string | number;
  meta?: string;           // e.g. deal name, stage, owner
}
```

---

## Task 2: Build `openAskPandora(context)` Utility

In `client/src/lib/askPandora.ts`, add:

```typescript
import { NavigateFunction } from 'react-router-dom';

export function openAskPandora(
  context: PandoraContext,
  navigate: NavigateFunction,
  targetPath = '/ask'          // defaults to Ask Pandora route; override if needed
): void {
  const message = buildContextMessage(context);

  navigate(targetPath, {
    state: {
      openChatWithMessage: message,
      pandoraContext: context,   // preserved for session metadata / tuning signal
    },
  });
}
```

The utility does three things:
1. Builds the structured system message from the context object
2. Navigates to the Ask Pandora route
3. Passes both the message and the raw context via router state (raw context is stored
   for future `agent_tuning_pairs` signal capture)

---

## Task 3: Build `buildContextMessage(context)` — System Prompt Builder

In the same file:

```typescript
function buildContextMessage(ctx: PandoraContext): string {
  const parts: string[] = [];

  // Scope header
  if (ctx.section) parts.push(`Section: ${ctx.section}`);
  if (ctx.dealName) parts.push(`Deal: ${ctx.dealName}`);
  if (ctx.accountName) parts.push(`Account: ${ctx.accountName}`);
  if (ctx.repName) parts.push(`Rep: ${ctx.repName}`);

  // Core data point
  parts.push(`Data point: ${ctx.label} = ${ctx.value}`);

  // Delta / anomaly context
  if (ctx.priorValue) parts.push(`Prior value: ${ctx.priorValue}`);
  if (ctx.anomaly) parts.push(`Notable: ${ctx.anomaly}`);
  if (ctx.benchmark) parts.push(`Benchmark: ${ctx.benchmark}`);

  // Evidence
  if (ctx.evidenceRows && ctx.evidenceRows.length > 0) {
    const rows = ctx.evidenceRows
      .map(r => `  • ${r.label}: ${r.value}${r.meta ? ` (${r.meta})` : ''}`)
      .join('\n');
    parts.push(`Backing data:\n${rows}`);
  } else if (ctx.evidenceSummary) {
    parts.push(`Context: ${ctx.evidenceSummary}`);
  }

  // Closing prompt
  parts.push(`Help me understand this figure or investigate further.`);

  return parts.join('\n');
}
```

The output is a structured but readable message — not a wall of JSON, not a blank prompt.
It reads like a briefing note, which primes the Ask Pandora resolver to treat it as a
scoped analytical question rather than a general query.

---

## Task 4: Evidence Fetcher Hook

Create `client/src/hooks/useSkillEvidence.ts`:

```typescript
// Fetches evidence rows from skill_runs for a given skillRunId.
// Used by consumer components to pre-fetch before calling openAskPandora,
// so evidence is available inline in the context object.

export function useSkillEvidence(skillRunId?: string): {
  evidenceRows: EvidenceRow[];
  loading: boolean;
} {
  // GET /api/:workspaceId/skill-runs/:skillRunId/evidence
  // Returns: { rows: EvidenceRow[] }
  // Cache aggressively — evidence from a past run never changes
}
```

Add the corresponding endpoint to `server/routes/skills.ts`:

```
GET /api/:workspaceId/skill-runs/:skillRunId/evidence
  Returns: { rows: EvidenceRow[] }
  Source: skill_runs.result_data → extract claims/evidence array
  Cache-Control: immutable (skill run evidence never changes)
```

---

## Task 5: Wire Six Consumer Surfaces

For each surface below, import `openAskPandora` and `PandoraContext`, replace any
existing ad-hoc chat-open logic with the utility call, and pass the appropriate context.

### Surface 1 — Command Center Headline Metrics Row

File: `client/src/pages/CommandCenter.tsx` (or equivalent metrics row component)

Each metric tile (Pipeline Value, Win Rate, Coverage Ratio, Open Findings) gets an
`onClick` handler:

```typescript
onClick={() => openAskPandora({
  source: 'metric_tile',
  label: 'Pipeline Coverage',
  value: '2.1x',
  anomaly: 'Down from 3.0x last week',
  benchmark: 'Target: 3.0x',
  section: 'Command Center',
  skillId: 'pipeline-coverage',
}, navigate)}
```

Cursor on metric tiles should change to `cursor-pointer`. Add a subtle teal info icon
on hover to signal interactivity.

### Surface 2 — Command Center Findings Feed Cards

File: `client/src/components/findings/FindingCard.tsx`

Add "Ask Pandora →" as a tertiary action alongside existing "Assign" / "Snooze" buttons:

```typescript
onAskPandora={() => openAskPandora({
  source: 'finding_card',
  label: finding.skill_name,
  value: finding.message,
  section: finding.category,
  dealId: finding.deal_id,
  dealName: finding.deal_name,
  skillId: finding.skill_id,
  skillRunId: finding.skill_run_id,
  evidenceRows: finding.evidence,   // already present on finding cards
}, navigate)}
```

### Surface 3 — Deal Detail Page Finding Cards

File: `client/src/pages/DealDetail.tsx` (findings panel section)

Same pattern as Surface 2 but scoped to the deal. The "Ask about this deal" input that
currently sits blank should be replaced with pre-seeded entry points per finding, plus
a blank "Ask anything about this deal →" fallback that scopes the conversation to the
deal dossier:

```typescript
// Fallback blank entry — scoped to deal
openAskPandora({
  source: 'deal_finding',
  label: 'Deal',
  value: deal.name,
  dealId: deal.id,
  dealName: deal.name,
  evidenceSummary: `${deal.stage}, ${deal.amount}, ${deal.days_in_stage} days in stage`,
}, navigate)
```

### Surface 4 — Forecast Page — Click a Forecast Line

File: `client/src/pages/Forecast.tsx` (chart click handler)

When a user clicks a data point on any of the five forecast series (CRM, Best Case,
Commit, Conservative, Pandora-Weighted):

```typescript
onChartClick={(series, dataPoint) => openAskPandora({
  source: 'forecast_line',
  label: series.label,              // e.g. "Pandora-Weighted Forecast"
  value: formatCurrency(dataPoint.value),
  section: 'Forecast',
  anomaly: series.delta
    ? `${series.delta > 0 ? '+' : ''}${formatCurrency(series.delta)} vs CRM forecast`
    : undefined,
  skillId: 'forecast-rollup',
  skillRunId: latestForecastRunId,
}, navigate)}
```

### Surface 5 — Rep Scorecard Metric Tiles

File: `client/src/pages/RepScorecard.tsx` (or `RepScorecardTile.tsx`)

Each metric tile (calls per week, stage conversion, deal velocity, attainment) gets
an `onClick`:

```typescript
onClick={() => openAskPandora({
  source: 'rep_scorecard_tile',
  label: tile.label,
  value: tile.value,
  repId: rep.id,
  repName: rep.name,
  benchmark: tile.benchmark,
  anomaly: tile.delta,
  section: 'Rep Scorecard',
  skillId: tile.skillId,
}, navigate)}
```

### Surface 6 — Account Detail Relationship Health Indicator

File: `client/src/pages/AccountDetail.tsx`

The health indicator (engagement trend, coverage gaps) becomes clickable:

```typescript
onClick={() => openAskPandora({
  source: 'account_health',
  label: 'Relationship Health',
  value: account.health_score,
  accountId: account.id,
  accountName: account.name,
  anomaly: account.health_trend,    // e.g. "Declining — no exec contact in 30 days"
  evidenceSummary: account.health_summary,
}, navigate)}
```

---

## Task 6: Slack Deeplink Pattern (future-ready, wire but don't activate)

In `server/routes/slack.ts`, when building Slack alert action buttons, append a
`?pandoraContext=` query param to the "View in Command Center" deeplink:

```typescript
const contextParam = encodeURIComponent(JSON.stringify({
  source: 'slack_deeplink',
  label: alert.metric_label,
  value: alert.metric_value,
  anomaly: alert.description,
  skillId: alert.skill_id,
  skillRunId: alert.skill_run_id,
}));

const deeplink = `${APP_URL}/command-center?pandoraContext=${contextParam}`;
```

In `App.tsx`, on route load, check for `?pandoraContext=` in the query string. If present,
parse it and fire `openAskPandora` after the page mounts. Wire the detection but gate it
behind a `FEATURE_SLACK_DEEPLINK_CONTEXT=true` env flag — don't activate until Slack
alerts are validated end-to-end.

---

## Acceptance Criteria

1. `openAskPandora` is importable from `client/src/lib/askPandora.ts` and works from
   any component that has access to `useNavigate()`
2. All six consumer surfaces open Ask Pandora with a structured, readable pre-seeded
   message on click — not a blank prompt
3. The raw `PandoraContext` object is preserved in router state as `pandoraContext`
   for every open (needed for future tuning signal capture)
4. `useSkillEvidence` hook returns evidence rows for a given `skillRunId` from the new
   endpoint; evidence is passed into the context object where available
5. Metric tiles and finding cards have visible interactive affordance (cursor, hover
   state, teal info icon or "Ask →" label) so discoverability is clear
6. Existing `ReportContextMenu.tsx` is refactored to use `openAskPandora` — no
   duplicate pre-seed logic remains in that file

---

## Design Notes

**Discoverability is the risk.** The utility is only valuable if users know the surfaces
are interactive. Add these affordances consistently:

- Metric tiles: `cursor-pointer`, teal info icon (`ⓘ`) on hover, tooltip "Ask Pandora
  about this →"
- Finding cards: "Ask Pandora →" ghost button as third action, same visual weight as
  "Snooze"
- Report blocks: existing right-click context menu (already built in T5) — no change

**Don't pre-seed blank conversations.** If a surface doesn't have a meaningful `label`,
`value`, or `evidenceSummary` to pass, don't wire it yet. A blank context produces a
worse Ask Pandora experience than no pre-seed at all.

**Context object is a tuning artifact.** Every `pandoraContext` stored in router state
is a future `agent_tuning_pairs` input. When the conversation that follows results in
a thumbs-up or an annotation override, the originating context tells you which surface
and which data point triggered the question. Preserve it.
