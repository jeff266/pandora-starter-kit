# Pandora — Deal Action Layer: Wiring Next Steps to the Actions System

## Exact Problem

"Recommended Next Steps" has three separate sources, none connected to the `actions` table:

1. **`deal_dossiers.recommended_actions`** — AI-generated JSON array, persisted to DB, served on load. Up to 3 P1 steps. Source of truth when present.
2. **Client-side fallback steps** — computed fresh on every load from loaded deal data. Never stored. Covers: unengaged EB, zero CRM activity, unlinked conversations, unknown buying roles, missing stage history.
3. **MEDDIC gap steps + coaching step** — fetched live from API each load. MEDDIC from skill run result, coaching from stage benchmark endpoint.

All three are read-only text. A rep reads them and manually goes to HubSpot/Salesforce. No tracking, no assignment, no CRM write path.

**The fix:** Unify all three sources into a single action card list. Each item gets persisted to the `actions` table on first render (if not already there). Each card gets [Create CRM Task], [Log as Note], and [Dismiss] buttons. P1 items get a bulk "Apply All P1s" path.

---

## Architecture Decision: Persist-on-Render Pattern

Because the three sources are computed at different times and places, the cleanest unification is a **persist-on-render** approach:

When the Deal Detail page loads and assembles the final list of recommended steps (from all three sources), call a single endpoint that upserts them into the `actions` table — deduplicating by `deal_id` + `title` hash so re-renders don't create duplicates. This converts the display list into tracked records without requiring a full refactor of how each source generates its steps.

```
Page load → assemble steps from 3 sources (existing logic, unchanged)
          → POST /deals/:id/actions/sync  (new endpoint)
          → upserts each step into actions table with approval_status: 'open'
          → returns action IDs for each step
          → UI renders action cards using IDs for approve/reject calls
```

---

## Backend Changes

### 1. New endpoint: `POST /deals/:id/actions/sync`

```typescript
// Takes the assembled list of next steps from the frontend
// Upserts into actions table, returns IDs

Body: {
  steps: {
    title: string,
    priority: 'P1' | 'P2' | 'P3',
    source: 'dossier' | 'client_rule' | 'meddic' | 'coaching',
    category: string,          // e.g. 'economic_buyer', 'meddic_gap', 'activity'
    suggested_crm_action: 'task_create' | 'note_create' | 'field_write' | null
  }[]
}

Response: {
  actions: { title: string, id: string, approval_status: string }[]
}

// Deduplication key: hash of (deal_id + title)
// If a step with this hash already exists and is NOT rejected: return existing record
// If rejected (dismissed): create a new record (user dismissed a prior version)
// If approved (done): exclude from response — don't resurface completed items
```

### 2. New endpoint: `GET /deals/:id/actions?status=open`

Returns all open/pending actions for a deal, sorted by priority then created_at. Used on page load to check if actions already exist before syncing.

If actions already exist for this deal (from a prior load), skip the sync POST and just fetch existing records. This prevents re-generating on every load.

### 3. Extend `actions` table (if columns missing)

Confirm these columns exist, add if not:
```sql
ALTER TABLE actions ADD COLUMN IF NOT EXISTS source TEXT;         -- 'dossier' | 'client_rule' | 'meddic' | 'coaching'
ALTER TABLE actions ADD COLUMN IF NOT EXISTS category TEXT;       -- 'economic_buyer' | 'meddic_gap' | 'stage' | etc.
ALTER TABLE actions ADD COLUMN IF NOT EXISTS suggested_crm_action TEXT;  -- 'task_create' | 'note_create' | 'field_write'
ALTER TABLE actions ADD COLUMN IF NOT EXISTS dedup_hash TEXT;     -- hash(deal_id + title) for upsert
CREATE UNIQUE INDEX IF NOT EXISTS idx_actions_dedup ON actions(dedup_hash) WHERE approval_status != 'rejected';
```

### 4. Action execution endpoints (confirm or create)

```
POST /actions/:id/approve    — already exists? confirm it handles 'task_create' type
POST /actions/:id/reject     — already exists?
POST /actions/bulk-approve   — already exists in /workflow-rules/pending/bulk-approve?
                               if so, alias or reuse for deal actions
```

For `suggested_crm_action: 'task_create'`: on approve, call the existing CRM task creation logic in `ActionExecutor` (built during Workflow Builder). Pass deal owner as assignee, step title as task title, due date = today + 3 days.

For `suggested_crm_action: 'note_create'`: on approve, call CRM note creation endpoint with step title as body.

---

## Frontend Changes

### 1. `DealDetail.tsx` — Replace static list with action cards

**Step A:** On load, check `GET /deals/:id/actions?status=open`. If actions exist, render from DB records (skip sync). If empty, assemble steps from the three existing sources (existing logic unchanged), then call `POST /deals/:id/actions/sync`, then render from the returned IDs.

**Step B:** Replace the static `<ul>` / text list with `<ActionCard>` components:

```
RECOMMENDED NEXT STEPS                         [Apply All P1s ▶]

┌──────────────────────────────────────────────────────────────┐
│  P1  Economic buyer not confirmed — get them on a call       │
│      before advancing stage                                  │
│      Source: Deal Risk Assessment                    [···]  │
│      [Create CRM Task ▶]   [Log as Note]   [Dismiss]        │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  P1  Reach out directly to VP Chanti Fritzsching             │
│      Key decision maker — 0 calls, unengaged                │
│      Source: Stakeholder Coverage                    [···]  │
│      [Create CRM Task ▶]   [Log as Note]   [Dismiss]        │
└──────────────────────────────────────────────────────────────┘
```

### 2. `ActionCard` component (new, shared)

Create `client/src/components/deals/ActionCard.tsx`:

```typescript
interface ActionCardProps {
  id: string;
  title: string;
  priority: 'P1' | 'P2' | 'P3';
  source: string;
  suggestedCrmAction: 'task_create' | 'note_create' | 'field_write' | null;
  onApprove: (id: string, mode: 'task' | 'note') => void;
  onDismiss: (id: string) => void;
}
```

**Button behavior:**
- **[Create CRM Task ▶]** → `POST /actions/:id/approve` with `{ mode: 'task_create' }` → optimistic remove from list → toast: "Task created in [HubSpot/Salesforce]" with undo (5s)
- **[Log as Note]** → `POST /actions/:id/approve` with `{ mode: 'note_create' }` → optimistic remove → toast: "Note logged"
- **[Dismiss]** → `POST /actions/:id/reject` → optimistic remove → toast: "Dismissed" with undo (5s)
- **Undo** → `POST /actions/:id/reopen` (set `approval_status` back to `open`) → re-adds to list

**Loading state:** While an action is in-flight, disable all three buttons on that card and show a spinner on the active button. Prevent double-submit.

**[Apply All P1s ▶]** header button → `POST /actions/bulk-approve` with all P1 action IDs and `{ mode: 'task_create' }` → optimistic remove all P1s → toast: "N tasks created in HubSpot"

### 3. MEDDIC Coverage accordion — Add action buttons

Once MEDDIC skill is registered and running (Fix 1 from previous prompt — add `registerMeddicCoverageSkill()` to `server/index.ts`), the accordion shows field-by-field breakdown. Add action affordances to missing/partial fields:

```
❌  Economic Buyer   Missing                    [Create Task: Confirm EB]
❌  Decision Process  Missing                   [Create Task: Discuss process]
⚠️  Champion          Partial (medium)          [Create Task: Confirm authority]
```

Each "[Create Task: ...]" button calls `POST /actions` to create a new action with `suggested_crm_action: 'task_create'` and a pre-written title, then immediately approves it. These are deal-specific tasks, not pending workflow items — execute immediately without HITL.

Add a **[Create Tasks for All Missing Fields]** bulk button at the bottom of the MEDDIC accordion.

Also add **[Write Confirmed Fields to CRM ▶]** for high-confidence confirmed fields — this triggers the existing writeback candidates from the `actions` table (created by `meddic-coverage/writeback.ts`).

### 4. Stage display fix (same session, low effort)

In the deal detail header, find where `→ Awareness` is rendered (the normalization bucket display):
- Remove it entirely
- Find where `inferred_phase` is stored/returned (check deal API response)
- If `inferred_phase` differs from CRM stage, show: `⚡ Likely: [inferred_phase]` below the stage pill
- If they match or `inferred_phase` is null, show nothing

### 5. Deal list badge fix (same session, low effort)

Find the "Advance Stage →" badge component in the deal list row:
- Replace label with "Score gap ↑" 
- Replace tooltip with: "AI score ([ai_grade]) exceeds CRM health ([crm_grade]) — stage may lag recent activity"
- On click: `POST /actions` to create a stage-review action for the deal, then navigate to deal detail

---

## Files to Create / Modify

| File | Change |
|---|---|
| `server/index.ts` | Add `registerMeddicCoverageSkill()` — do this first |
| `server/routes/deal-actions.ts` | Create — `POST /deals/:id/actions/sync`, `GET /deals/:id/actions` |
| `server/routes/actions.ts` | Add `POST /actions/:id/reopen` for undo; confirm approve/reject/bulk-approve exist |
| `client/src/components/deals/ActionCard.tsx` | Create |
| `client/src/pages/DealDetail.tsx` | Wire sync pattern, replace static list, add MEDDIC buttons, fix stage display |
| Deal list row component | Fix "Advance Stage →" badge |

---

## Entry Criteria — Confirm Before Building

1. Does `synthesizeDealNarrative()` in the dossier generation already return `recommended_actions` as a structured array with `priority` and `title` fields, or is it a flat text list?
2. Does the `actions` table have a `source` column or only the fields from the original Workflow Builder migration?
3. Does `POST /actions/:id/approve` already handle `suggested_crm_action: 'task_create'` or does it only handle workflow rule approvals?
4. What is the exact field name for the inferred/likely stage on the deal record?
5. What is the deal list badge component filename?

---

## Exit Criteria

- MEDDIC accordion populates after "Run Now" on a Frontera deal with conversations
- Recommended Next Steps renders action cards with buttons (not static text)
- [Create CRM Task] on a P1 step creates a task in HubSpot and removes the card
- [Dismiss] removes the card and does not reappear on page reload
- [Apply All P1s ▶] creates all P1 tasks in bulk with a single click
- MEDDIC accordion shows [Create Task] on missing fields
- Deal detail stage display shows ⚡ Likely phase without normalization bucket
- Deal list badge shows "Score gap ↑" instead of "Advance Stage →"
- Dismissed actions excluded from `GET /deals/:id/actions?status=open` response
- Re-loading the deal detail page does not re-create already-persisted action records
