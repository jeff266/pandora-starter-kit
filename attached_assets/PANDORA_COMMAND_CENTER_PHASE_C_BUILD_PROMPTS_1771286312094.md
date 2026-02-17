# Pandora Command Center — Phase C: Polish + Iteration Build Prompts

## Overview

Five prompts that complete the Command Center. Run them in order.
Each prompt is self-contained — paste into Replit as a standalone session.

**Pre-req check:** Before starting, verify the Claude Code branch was cherry-picked:
- CRM writers (hubspot-writer.ts, salesforce-writer.ts) should exist
- Evidence contract standardization (18 skills) should be merged
- crm_write_log migration should be applied
- If these DON'T exist, Prompt C1 will create the CRM writer stubs.

**What's already built (Phase A + B):**
- Findings table with 661+ findings, auto-extraction from skill runs
- Findings API: GET /findings, /findings/summary, /pipeline/snapshot
- Deal + Account dossier assemblers with narrative synthesis
- POST /analyze (scoped analysis, rate limited)
- Full frontend shell with sidebar navigation, dark theme
- Command Center home: metrics row, annotated pipeline chart, findings feed, connector strip
- Deal + Account detail pages with dossiers and "Ask Pandora"
- Skills page with run history and manual trigger
- Connectors page with status and sync-now
- Insights Feed with chronological findings stream

---

# Prompt C1: Actions Engine Backend

## For: Replit
## Effort: 4-6 hours
## Depends on: findings table, skill runtime, CRM connectors

---

## Context

Pandora skills surface findings — "this deal is stale," "this deal is single-threaded." The Actions Engine converts findings into executable operations. This prompt builds the backend: tables, APIs, extraction from skill output, and execution handlers.

**Check first:** Do these already exist?
- `actions` table in the database
- `action_audit_log` table
- `server/actions/extractor.ts` or similar
- CRM writer files (hubspot-writer.ts, salesforce-writer.ts)

If any of these exist from a previous Claude Code branch merge, use them. Don't rebuild what's already there. If they don't exist, build them per this spec.

---

## Task 1: Database Migration

Create the migration file. If the `actions` table already exists, skip this.

```sql
-- Actions table
CREATE TABLE IF NOT EXISTS actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),

  -- Source traceability
  skill_run_id UUID REFERENCES skill_runs(run_id),
  finding_id UUID REFERENCES findings(id),
  source_skill TEXT NOT NULL,

  -- Classification
  action_type TEXT NOT NULL,
  -- Types: 're_engage_deal', 'close_stale_deal', 'update_close_date',
  --        'update_deal_stage', 'add_stakeholder', 'escalate_deal',
  --        'notify_rep', 'notify_manager', 'clean_data', 'update_forecast'
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),

  -- Target entity
  target_entity_type TEXT NOT NULL,      -- 'deal', 'contact', 'account'
  target_entity_id UUID,
  target_external_id TEXT,               -- CRM record ID for write-back
  target_source TEXT,                    -- 'hubspot', 'salesforce'

  -- Display content
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  impact_label TEXT,                     -- "$220K at risk"
  impact_amount NUMERIC,                -- 220000 (for sorting)
  urgency_label TEXT,                    -- "87 days stale"
  urgency_days_stale INTEGER,
  recommended_steps JSONB DEFAULT '[]',
  owner_email TEXT,                      -- deal owner for routing

  -- Execution
  execution_type TEXT NOT NULL DEFAULT 'manual',
  execution_payload JSONB DEFAULT '{}',  -- CRM field updates, Slack content
  execution_status TEXT NOT NULL DEFAULT 'open'
    CHECK (execution_status IN ('open', 'in_progress', 'executed', 'dismissed', 'expired', 'auto_executed', 'superseded')),
  executed_at TIMESTAMPTZ,
  executed_by TEXT,
  execution_result JSONB,

  -- Lifecycle
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '14 days'),
  dismissed_reason TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_actions_workspace_status ON actions(workspace_id, execution_status);
CREATE INDEX idx_actions_workspace_severity ON actions(workspace_id, severity);
CREATE INDEX idx_actions_target ON actions(target_entity_type, target_entity_id);
CREATE INDEX idx_actions_skill_run ON actions(skill_run_id);
CREATE INDEX idx_actions_owner ON actions(workspace_id, owner_email) WHERE execution_status = 'open';
CREATE INDEX idx_actions_expires ON actions(expires_at) WHERE execution_status = 'open';

-- Audit log
CREATE TABLE IF NOT EXISTS action_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  action_id UUID NOT NULL REFERENCES actions(id),

  event_type TEXT NOT NULL,
  actor TEXT,
  from_status TEXT,
  to_status TEXT,
  details JSONB,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_action ON action_audit_log(action_id, created_at);
CREATE INDEX idx_audit_workspace ON action_audit_log(workspace_id, created_at DESC);
```

---

## Task 2: Action Extraction from Skill Output

Create `server/actions/extractor.ts` (or equivalent path matching your project structure).

After a skill's Claude synthesis step completes, parse the output for an `<actions>` block. This hooks into the same post-synthesis flow where findings are already extracted.

```typescript
// Pseudo-structure — adapt to match existing patterns

interface ExtractedAction {
  action_type: string;
  severity: 'critical' | 'warning' | 'info';
  target_deal_name?: string;
  target_deal_id?: string;
  target_account_id?: string;
  target_entity_type: 'deal' | 'contact' | 'account';
  title: string;
  summary: string;
  impact_amount?: number;
  impact_label?: string;
  urgency_label?: string;
  urgency_days_stale?: number;
  owner_email?: string;
  recommended_steps?: string[];
  execution_payload?: {
    crm_updates?: Array<{ field: string; proposed_value: any }>;
    note_text?: string;
  };
}

export function extractActions(skillOutput: string): ExtractedAction[] {
  // 1. Look for <actions>...</actions> block in skill output
  // 2. Parse JSON array inside the block
  // 3. Validate each action has required fields
  // 4. Return validated actions (skip malformed ones, log warnings)

  const match = skillOutput.match(/<actions>([\s\S]*?)<\/actions>/);
  if (!match) return [];

  try {
    const raw = JSON.parse(match[1]);
    if (!Array.isArray(raw)) return [];
    return raw.filter(a => a.action_type && a.title && a.summary && a.severity);
  } catch (err) {
    console.warn('[Action Extractor] Failed to parse actions block:', err);
    return [];
  }
}
```

**Wire into skill runtime:** In the same place where findings are extracted after skill completion, add action extraction:

```typescript
// After findings extraction (which already exists):
const extractedActions = extractActions(synthesisOutput);
if (extractedActions.length > 0) {
  // 1. Resolve previous open actions for same skill + workspace
  //    (same pattern as findings: supersede old, insert new)
  await db.query(`
    UPDATE actions SET execution_status = 'superseded', updated_at = now()
    WHERE workspace_id = $1 AND source_skill = $2 AND execution_status = 'open'
  `, [workspaceId, skillId]);

  // 2. Insert new actions
  for (const action of extractedActions) {
    // Resolve target_entity_id from deal name or external ID
    // (look up in deals/accounts/contacts table)
    const entityId = await resolveEntityId(workspaceId, action);

    await db.query(`
      INSERT INTO actions (workspace_id, skill_run_id, finding_id, source_skill,
        action_type, severity, target_entity_type, target_entity_id,
        target_external_id, target_source, title, summary, impact_label,
        impact_amount, urgency_label, urgency_days_stale, owner_email,
        recommended_steps, execution_payload)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    `, [workspaceId, runId, null, skillId,
        action.action_type, action.severity, action.target_entity_type, entityId,
        action.target_deal_id || action.target_account_id, connectorSource,
        action.title, action.summary, action.impact_label, action.impact_amount,
        action.urgency_label, action.urgency_days_stale, action.owner_email,
        JSON.stringify(action.recommended_steps || []),
        JSON.stringify(action.execution_payload || {})]);

    // 3. Log to audit
    // INSERT INTO action_audit_log (workspace_id, action_id, event_type, actor)
  }
}
```

---

## Task 3: Modify Pipeline Hygiene Skill Synthesis Prompt

Find the Pipeline Hygiene skill's Claude synthesis prompt. Add this instruction at the end of the prompt, AFTER the existing narrative instructions:

```
In addition to your narrative report, output a structured actions block.
For each deal that requires attention, emit an action. Format:

<actions>
[
  {
    "action_type": "re_engage_deal",
    "severity": "critical",
    "target_entity_type": "deal",
    "target_deal_name": "Acme Corp",
    "target_deal_id": "abc123",
    "title": "Re-engage or close — 87 days stale in Decision",
    "summary": "No activity since Nov 17. Champion has not responded to last 2 emails.",
    "impact_amount": 220000,
    "impact_label": "$220K at risk",
    "urgency_label": "87 days stale",
    "urgency_days_stale": 87,
    "owner_email": "mike@company.com",
    "recommended_steps": [
      "Schedule executive-level outreach within 48 hours",
      "If no response by Feb 19, recommend moving to Closed-Lost"
    ],
    "execution_payload": {
      "crm_updates": [{"field": "close_date", "proposed_value": "2026-03-15"}],
      "note_text": "Flagged by Pandora: 87 days stale, recommend re-engagement or close"
    }
  }
]
</actions>

Action types to use:
- "re_engage_deal" — stale deal needs rep attention
- "close_stale_deal" — deal should be moved to Closed-Lost
- "update_close_date" — close date is past due, needs new date
- "notify_rep" — general rep notification
- "clean_data" — missing or invalid CRM fields

Only emit actions for deals that genuinely need attention. Not every finding needs an action — informational findings don't.
```

Do the same for Single-Thread Alert (action_type: "add_stakeholder") and Data Quality Audit (action_type: "clean_data"). Adapt the instructions to match each skill's domain.

---

## Task 4: Actions API

Create routes following existing patterns (likely `server/routes/actions.ts`):

```
GET /api/workspaces/:workspaceId/actions
  Query params: status (default: 'open'), severity, action_type, owner_email,
                target_entity_type, sort_by (default: 'impact_amount DESC'),
                limit (default: 50), offset
  Returns: { actions: [...], total: N, filters_applied: {...} }

GET /api/workspaces/:workspaceId/actions/summary
  Returns: {
    total_open: N,
    by_severity: { critical: N, warning: N, info: N },
    by_type: { re_engage_deal: N, close_stale_deal: N, ... },
    total_impact: 1100000,
    resolved_this_week: N,
    avg_resolution_hours: N
  }

GET /api/workspaces/:workspaceId/actions/:actionId
  Returns: full action with audit log entries

PUT /api/workspaces/:workspaceId/actions/:actionId/status
  Body: { status: 'in_progress' | 'executed' | 'dismissed', reason?: string, actor: string }
  - Validates state transitions (open → in_progress, open → dismissed, in_progress → executed, etc.)
  - Creates audit log entry
  - Updates action row
  Returns: updated action

POST /api/workspaces/:workspaceId/actions/:actionId/execute
  - For Ring 1 native execution (CRM writes, Slack notifications)
  - Reads execution_payload
  - Routes to appropriate handler:
    - notify_rep → Slack DM to owner_email
    - update_close_date → CRM connector updateDeal
    - close_stale_deal → CRM connector updateDeal (stage → Closed-Lost)
    - clean_data → CRM connector updateDeal (specific fields)
  - Requires confirmation: body must include { confirmed: true }
  - Creates audit log entry with execution result
  - If CRM write: also creates a note on the CRM record via connector
  Returns: { success: boolean, execution_result: {...} }
```

**For the execute endpoint — CRM write handler:**

Check if CRM writer files exist (hubspot-writer.ts, salesforce-writer.ts). If they do, import and use them. If not, create minimal stubs:

```typescript
// Pseudo-structure for CRM execution
async function executeAction(action: Action, workspaceId: string): Promise<ExecutionResult> {
  const connector = await getConnectorConfig(workspaceId, action.target_source);
  if (!connector) throw new Error(`No ${action.target_source} connector for workspace`);

  switch (action.action_type) {
    case 'notify_rep':
      return await sendSlackDM(workspaceId, action.owner_email, formatActionCard(action));

    case 'update_close_date':
    case 'close_stale_deal':
    case 'update_deal_stage':
    case 'clean_data':
      // Apply CRM updates from execution_payload
      const updates = action.execution_payload?.crm_updates || [];
      for (const update of updates) {
        if (action.target_source === 'hubspot') {
          await hubspotUpdateDeal(connector, action.target_external_id, { [update.field]: update.proposed_value });
        } else if (action.target_source === 'salesforce') {
          await salesforceUpdateOpportunity(connector, action.target_external_id, { [update.field]: update.proposed_value });
        }
      }
      // Add audit note to CRM
      if (action.execution_payload?.note_text) {
        await addCrmNote(connector, action.target_source, action.target_external_id, action.execution_payload.note_text);
      }
      return { success: true, updates_applied: updates.length };

    default:
      return { success: false, error: `Unsupported action type: ${action.action_type}` };
  }
}
```

---

## Task 5: Wire Actions Badge to Sidebar

The sidebar already shows badge counts for Skills, Connectors, etc. Add the Actions badge:

Find where sidebar badges are populated. Add a call to `/actions/summary` and display `total_open` as the badge count on the Actions nav item.

---

## Task 6: Expired Actions Cleanup

Add a lightweight check — either in the existing cron scheduler or as a periodic task:

```sql
UPDATE actions
SET execution_status = 'expired',
    dismissed_reason = 'expired',
    updated_at = now()
WHERE execution_status = 'open'
  AND expires_at < now();
```

Run this daily. Log how many actions expired.

---

## Verification

1. Run a skill manually (Pipeline Hygiene) against Imubit or Frontera workspace
2. Check that actions were extracted and inserted into the `actions` table
3. Hit `GET /actions` — should return the new actions
4. Hit `GET /actions/summary` — should show counts
5. Try `PUT /actions/:id/status` with `{ status: 'dismissed', reason: 'test' }`
6. Check `action_audit_log` has the state change logged
7. Sidebar Actions badge should show the count

---

# Prompt C2: Actions Queue Frontend Page

## For: Replit
## Effort: 4-6 hours
## Depends on: C1 (Actions API must be working)

---

## Context

The Actions page is the "what to do" queue. It's where Pandora stops being a dashboard and becomes an operating system. Every card is a specific recommendation from a skill run, with context, impact, and executable next steps.

**Design reference:** The Actions page mockup exists in `pandora-platform.jsx` — use the exact same color palette, typography, component patterns. The mockup shows:
- Summary bar at top (open count, critical count, total $ at risk, resolved this week)
- Group-by toggle: Severity | Owner | Type
- Action cards with severity indicator, deal name, impact, recommended steps
- Card actions: Mark In Progress, Execute, Dismiss (with reason)
- Detail panel that slides out on card click

**APIs available (from C1):**
- `GET /api/workspaces/:id/actions` — filtered, paginated action list
- `GET /api/workspaces/:id/actions/summary` — headline counts
- `PUT /api/workspaces/:id/actions/:id/status` — state transitions
- `POST /api/workspaces/:id/actions/:id/execute` — CRM write execution

---

## Page Structure

### Summary Bar (top of page)

Four metric cards in a row, same style as Command Center headline metrics:

| Metric | Source | Color |
|--------|--------|-------|
| Open Actions | summary.total_open | accent blue |
| Critical | summary.by_severity.critical | red |
| Pipeline at Risk | summary.total_impact (formatted as $X.XM) | yellow |
| Resolved This Week | summary.resolved_this_week | green |

### Filter Bar

Below summary bar:
- **Group by** toggle: Severity (default) | Owner | Type
- **Status filter**: Open (default) | In Progress | All | Dismissed
- **Severity filter**: All | Critical | Warning | Info
- **Owner filter**: dropdown of unique owner_email values from results
- **Search**: text search across title and summary

### Action Cards

Each card shows:

```
┌─────────────────────────────────────────────────────┐
│ 🔴 CRITICAL                              87d stale │
│                                                     │
│ Re-engage or close — 87 days stale in Decision      │
│ Acme Corp · $220K · Mike Chen                       │
│                                                     │
│ No activity since Nov 17. Champion has not           │
│ responded to last 2 emails.                         │
│                                                     │
│ Recommended:                                        │
│ 1. Schedule executive-level outreach within 48hrs   │
│ 2. If no response by Feb 19, move to Closed-Lost    │
│                                                     │
│ [Mark In Progress]  [Execute ▾]  [Dismiss]          │
└─────────────────────────────────────────────────────┘
```

**Severity indicator:** Left border color matches severity (red/yellow/blue). Pill badge top-left.

**Card styling:** Use `C.surface` background, `C.border` border, `C.surfaceHover` on hover. Match existing findings cards in the Insights Feed.

**Impact amount** formatted: `$220K`, `$1.1M`, etc.

**Owner** links to a filter (clicking Mike Chen filters to owner=mike).

**Deal name** is a link to the Deal Detail page (existing route).

**"Execute ▾"** is a dropdown when the action has CRM write capability:
- "Update Close Date" (if execution_payload has close_date update)
- "Move to Closed-Lost" (if action_type is close_stale_deal)
- "Add CRM Note" (if execution_payload has note_text)
- Each option shows a confirmation modal before executing

**"Dismiss"** opens a small modal or inline form:
- Reason dropdown: "Not an issue", "Already handled", "Will address later", "Intentionally paused"
- Optional free-text note
- Submit calls PUT /actions/:id/status with { status: 'dismissed', reason: selected_reason }

### Grouping

When grouped by **Severity**: Section headers for Critical, Warning, Info. Each section shows count.

When grouped by **Owner**: Section headers by owner name/email. Each section shows count and total impact.

When grouped by **Type**: Section headers by action_type (formatted: "Re-engage Deal", "Close Stale Deal", etc.).

### Empty States

- No open actions: "All clear. No actions pending." with a green checkmark icon.
- No actions at all: "Actions appear here when skills identify deals that need attention. Run a skill to get started." with a button linking to Skills page.

### Detail Panel (optional — build if time allows)

Clicking an action card opens a right-side panel (same pattern as deal dossier if that uses a panel) showing:
- Full action details
- Source: which skill, which run, link to the finding
- Deal context: mini dossier snippet (deal stage, last activity, key contacts)
- Audit trail: all status changes from action_audit_log
- Execution history: if executed, show what was written to CRM

---

## State Management

Actions are mutable — status changes need to update the UI immediately:

1. After a successful PUT to change status, update the local state (remove from open list, or move to correct group)
2. Refetch summary counts after any status change
3. Optimistic updates are fine — show the change immediately, revert if API fails
4. After execute, show a success/error toast notification

---

## Verification

1. Navigate to Actions page from sidebar
2. Summary bar shows correct counts from /actions/summary
3. Action cards render with correct severity colors, impact amounts, owner names
4. Clicking "Dismiss" shows reason selector and successfully updates status
5. Clicking "Mark In Progress" transitions the card
6. Group-by toggle reorganizes the list
7. Severity/status filters work
8. Deal name links navigate to Deal Detail page
9. Empty state shows when no actions exist
10. Badge count in sidebar updates after dismissing actions

---

# Prompt C3: Playbooks Frontend Page

## For: Replit
## Effort: 3-4 hours
## Depends on: Existing cron scheduler, skill registry, skill_runs table

---

## Context

Playbooks are named skill sequences that run on a schedule. The backend already exists — cron scheduler runs skills on their defined schedules (Monday 8 AM), skill_runs table logs every execution. This prompt builds the frontend page that makes playbooks visible, configurable, and triggerable.

**Design reference:** The Playbooks page mockup exists in `pandora-platform.jsx` with:
- Playbook list with status cards
- Playbook detail view with skill pipeline visualization
- Run history and findings from each run

**What exists in the backend:**
- Cron scheduler (`server/sync/skill-scheduler.ts` or similar)
- Skill registry with schedule definitions
- `skill_runs` table with trigger_source column
- `POST /api/workspaces/:id/skills/run-all` endpoint
- `POST /api/workspaces/:id/skills/:skillId/run` manual trigger
- `GET /api/workspaces/:id/skills/:skillId/runs` run history

**What may NOT exist yet:**
- A `playbooks` table — check first. If it doesn't exist, we'll derive playbooks from the skill registry's schedule groups.

---

## Task 1: Playbook Data Source

**Check first:** Is there a `playbooks` table? If yes, use it. If no, derive playbooks from skill schedules:

```typescript
// Group skills by their cron expression to form logical playbooks
// All skills with "0 8 * * 1" = "Monday Pipeline Review" playbook

interface DerivedPlaybook {
  id: string;                    // hash of cron expression
  name: string;                  // "Monday Pipeline Review"
  description: string;
  schedule: string;              // "Every Monday, 8:00 AM"
  cronExpression: string;        // "0 8 * * 1"
  skills: string[];              // ['pipeline-hygiene', 'single-thread-alert', ...]
  status: 'active' | 'paused';
  lastRun?: { startedAt: string; status: string; duration_ms: number };
  nextRun?: string;              // computed from cron expression
}
```

**API endpoint needed (create if it doesn't exist):**

```
GET /api/workspaces/:workspaceId/playbooks
  Returns: playbook list with last run info

GET /api/workspaces/:workspaceId/playbooks/:playbookId
  Returns: playbook detail with full run history per skill

POST /api/workspaces/:workspaceId/playbooks/:playbookId/run
  Triggers all skills in the playbook immediately (calls run-all with skill filter)
  Returns: { runId, skills: [{ skillId, status }] }
```

If playbooks are derived (no table), the API assembles them on the fly from the skill registry. This is fine for v1.

---

## Task 2: Playbook List Page

### Page Header

```
Playbooks
Automated skill sequences for your revenue cadence

                                    [+ New Playbook] (disabled, tooltip: "Coming soon")
```

### Playbook Cards

Each playbook is a card showing:

```
┌──────────────────────────────────────────────────────────┐
│ Monday Pipeline Review                           ● Active│
│ Automated pipeline health check for weekly standups      │
│                                                          │
│ Skills: Pipeline Hygiene → Single-Thread → Coverage      │
│ Schedule: Every Monday, 6:00 AM PST                      │
│ Destination: #sales-leadership                           │
│                                                          │
│ Last run: Feb 10, 2026 — 6:01 AM  ✅ 38s               │
│ Next run: Feb 17, 2026 — 6:00 AM                        │
│                                                          │
│ 8 runs · 23 findings · 6 actions                        │
│                                                          │
│ [Run Now]  [View Details →]                              │
└──────────────────────────────────────────────────────────┘
```

**Status dot:** Green = active, yellow = paused, red = last run failed.

**Skills display:** Show skill names connected by arrows (→). If more than 3 skills, show first 2 + "+N more".

**Stats row:** Total runs, total findings produced, total actions produced. Query from skill_runs + findings + actions tables filtered by the playbook's skill IDs.

**"Run Now"** button: calls POST /playbooks/:id/run. Shows a loading spinner. After completion, refreshes the card with updated last run info.

### Click → Detail View

Clicking a card or "View Details" navigates to the playbook detail page (or expands inline — match the pandora-platform.jsx pattern which uses an inline expansion with breadcrumb).

---

## Task 3: Playbook Detail View

### Breadcrumb

```
Playbooks > Monday Pipeline Review
```

### Header

Playbook name, description, schedule, destination, status toggle (active/paused), and "Run Now" button.

### Skill Pipeline Visualization

Show each skill as a step in a horizontal pipeline:

```
[Pipeline Hygiene] → [Single-Thread Alert] → [Coverage by Rep]
    COMPUTE              CLASSIFY               SYNTHESIZE
     0 tokens            1,800 tokens           3,200 tokens
     8s                  14s                     22s
     ✅ completed        ✅ completed           ✅ completed
```

Each step is a card showing:
- Skill name
- Phase label (compute / classify / synthesize) with color coding
- Token usage from last run
- Duration from last run
- Status from last run

**Color coding for phases:** Use from the mockup: green for compute, purple for classify, blue/accent for synthesize.

### Recent Findings

Below the pipeline, show the most recent findings produced by this playbook's skills. Reuse the findings card component from the Insights Feed page. Filter findings by the playbook's skill IDs and show the 10 most recent.

### Run History

Table showing last N runs:

| Run | Started | Duration | Status | Findings | Actions | Tokens |
|-----|---------|----------|--------|----------|---------|--------|
| #8  | Feb 10 6:01 AM | 38s | ✅ Success | 5 | 2 | 4,800 |
| #7  | Feb 3 6:00 AM  | 42s | ✅ Success | 3 | 1 | 5,100 |
| ... | | | | | | |

Click a run row → expand to show which skills ran, their individual durations, and any errors.

---

## Verification

1. Navigate to Playbooks from sidebar
2. Playbook cards show with correct skill lists and schedules
3. Last run info is accurate (matches skill_runs table)
4. "Run Now" triggers execution and updates the card
5. Detail view shows skill pipeline with correct token/duration data
6. Recent findings section shows findings from the playbook's skills
7. Run history table is accurate and sortable

---

# Prompt C4: Connector Health Detail Page

## For: Replit
## Effort: 2-3 hours
## Depends on: Existing connector_configs, sync_log tables

---

## Context

The Connectors page exists and shows status cards for each connected source. The Connector Health page (separate nav item) provides deep detail: sync history, field mapping, data freshness per entity, error logs.

**Data already available in the database:**
- `connector_configs` table: type, status, last_synced_at, config JSONB
- `sync_log` table (or similar): sync history with timestamps, record counts, errors
- Entity tables (deals, contacts, accounts, conversations): record counts per workspace

---

## Page Structure

### Top: Health Summary

Four cards:

| Metric | Source |
|--------|--------|
| Connected Sources | count of active connector_configs |
| Last Sync | most recent last_synced_at across all connectors |
| Total Records | sum of deals + contacts + accounts + conversations |
| Sync Errors (24h) | count of error entries in sync_log from last 24 hours |

### Per-Connector Detail Section

For each connected source, show an expandable section:

```
┌──────────────────────────────────────────────────────┐
│ 🟢 HubSpot                    Last sync: 2 hours ago│
│                                                      │
│ Entity Freshness:                                    │
│   Deals:        847 records · synced 2h ago          │
│   Contacts:    2,104 records · synced 2h ago         │
│   Accounts:      312 records · synced 2h ago         │
│   Activities:  5,891 records · synced 2h ago         │
│                                                      │
│ Sync History (last 7 days):                          │
│   ✅ Feb 16 2:00 PM — 47 new/updated records (12s)  │
│   ✅ Feb 16 8:00 AM — 23 new/updated records (8s)   │
│   ✅ Feb 15 2:00 PM — 89 new/updated records (15s)  │
│   ❌ Feb 15 8:00 AM — Error: rate limit (retried ✅)│
│                                                      │
│ [Sync Now]  [View Field Mapping]  [Disconnect]       │
└──────────────────────────────────────────────────────┘
```

**Status dot logic:**
- 🟢 Green: synced within expected interval, no errors
- 🟡 Yellow: synced but with warnings, or overdue by <2x interval
- 🔴 Red: sync failed, or overdue by >2x interval, or disconnected

**Sync History:** Show last 20 sync events from sync_log. Each row: timestamp, records affected, duration, status (success/error), error message if failed.

**"View Field Mapping"** (optional — build if time): Show which CRM fields are synced to which Pandora columns. Read from the connector's field mapping config.

**"Disconnect"** shows a confirmation modal. Doesn't delete data, just marks connector as inactive.

---

## API Endpoint (create if needed)

```
GET /api/workspaces/:workspaceId/connectors/health
  Returns: {
    connectors: [
      {
        id, type, status, last_synced_at,
        entities: [
          { type: 'deals', count: 847, last_synced: '...' },
          { type: 'contacts', count: 2104, last_synced: '...' }
        ],
        sync_history: [
          { timestamp, records_affected, duration_ms, status, error_message }
        ],
        health_status: 'healthy' | 'warning' | 'error'
      }
    ],
    summary: { total_sources, total_records, last_sync, errors_24h }
  }
```

This may assemble data from multiple tables (connector_configs, sync_log, entity counts). Build as a single endpoint that does the aggregation server-side.

---

## Verification

1. Navigate to Connector Health from sidebar
2. Summary cards show correct counts
3. Each connector section shows entity freshness with accurate record counts
4. Sync history matches sync_log table entries
5. Status dots reflect actual health
6. "Sync Now" triggers a sync and updates the display

---

# Prompt C5: Polish — Chart Interactions, Loading States, Error Boundaries

## For: Replit
## Effort: 2-3 hours
## Depends on: All Phase B + C1-C4 pages

---

## Context

This is the final polish pass across all Command Center pages. Three areas: making the pipeline chart interactive, adding loading states everywhere, and wrapping pages in error boundaries.

---

## Task 1: Pipeline Chart Annotation Interactions

On the Command Center home page, the annotated pipeline chart shows finding counts as badges on each stage bar. Make these interactive:

1. **Click a stage bar** → filters the findings feed below to show only findings for deals in that stage
2. **Click a finding badge** (e.g., "3 stalled") → expands an inline panel below the chart showing the specific deals:

```
┌─────────────────────────────────────────────────────┐
│ Negotiation — 3 deals stalled 21+ days ($4.1M)     │
│                                                     │
│ • Acme Corp — $220K — Mike Chen — 87 days           │
│ • TechStart Inc — $180K — Sarah Lee — 34 days       │
│ • GlobalPay — $340K — Jane Smith — 28 days          │
│                                                     │
│ [View All →]                        [Close ✕]       │
└─────────────────────────────────────────────────────┘
```

Each deal name links to the Deal Detail page. "View All" filters the findings feed.

3. **Hover on a stage bar** → tooltip showing: stage name, deal count, total value, weighted value, finding summary

---

## Task 2: Loading States (Skeleton Screens)

Every page section that loads data should show a skeleton placeholder, not a spinner or blank space. Use the same dark theme colors:

- **Metric cards:** Gray rectangle pulses (`C.surfaceRaised` → `C.surfaceHover` animation)
- **Pipeline chart:** Gray bar placeholders at varying heights
- **Findings cards:** 3 placeholder cards with pulsing lines
- **Action cards:** Same as findings
- **Tables:** Gray rows with pulsing cells

Pattern:

```css
@keyframes skeleton-pulse {
  0% { opacity: 0.4; }
  50% { opacity: 0.8; }
  100% { opacity: 0.4; }
}

.skeleton {
  background: var(--surface-raised);
  animation: skeleton-pulse 1.5s ease-in-out infinite;
  border-radius: 4px;
}
```

Apply to: Command Center home, Actions page, Playbooks page, Connector Health, Deal Detail, Account Detail, Insights Feed, Skills page.

If a section fails to load, show an inline error with retry button — NOT a full page error.

---

## Task 3: Error Boundaries

Wrap each major page section in a React error boundary so one broken component doesn't crash the whole page:

```typescript
class SectionErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 24,
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          textAlign: 'center'
        }}>
          <p style={{ color: C.textMuted }}>Something went wrong loading this section.</p>
          <button onClick={() => this.setState({ hasError: false })}>
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

Wrap these sections independently:
- Command Center: metrics row, pipeline chart, findings feed, connector strip (each separate)
- Actions: summary bar, action list
- Playbooks: playbook list, detail view
- Deal/Account detail: each dossier section
- Connector Health: summary, per-connector sections

---

## Task 4: Auto-Refresh

The Command Center home page and Actions page should auto-refresh data. Don't use WebSockets — simple polling:

- Command Center: refetch pipeline/snapshot and findings/summary every 5 minutes
- Actions: refetch actions/summary every 2 minutes (actions change more frequently)
- Show "Last updated: X minutes ago" in the top bar
- Show a subtle refresh indicator when refetching (not a full skeleton — just a small spinner in the header)

---

## Verification

1. Pipeline chart: click a stage bar → findings feed filters. Click a badge → inline expansion with deal links.
2. Every page shows skeleton loading states on initial load (throttle network in dev tools to verify)
3. If an API call fails, the failed section shows an error with retry — other sections still render
4. Command Center data refreshes automatically every 5 minutes
5. "Last updated" timestamp is visible and accurate

---

# Build Order Summary

| Prompt | What | Effort | Prereqs |
|--------|------|--------|---------|
| **C1** | Actions Engine backend (tables, APIs, extraction, execution) | 4-6 hrs | Findings table, skill runtime |
| **C2** | Actions Queue frontend page | 4-6 hrs | C1 |
| **C3** | Playbooks frontend page | 3-4 hrs | Cron scheduler, skill registry |
| **C4** | Connector Health detail page | 2-3 hrs | connector_configs, sync_log |
| **C5** | Polish (chart interactions, skeletons, error boundaries) | 2-3 hrs | All above |
| **Total** | | **~15-22 hrs** | |

C3 and C4 can run in parallel with C1 (they don't depend on the Actions Engine).
C5 should be last — it touches all pages.
