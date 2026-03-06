# Claude Code Prompt: Skill Version Control

## Objective

Add version-control to skill schedule configuration. Workspace admins can view a full change history and revert any previous state. Leverages the existing `skill_governance` table and rollback engine — **no new infrastructure needed**.

---

## Pre-Flight: Read Before Writing Any Code

Scan these files before touching anything:

1. `server/routes/skills.ts` — find the PATCH `/:workspaceId/skills/:skillId/schedule` handler and understand the current upsert pattern
2. `server/governance/rollback-engine.ts` — read the full `applyChange()` and `rollbackChange()` switch statements to understand the existing case pattern
3. `server/db/schema.ts` (or migrations) — confirm the `skill_governance` table columns: `id`, `workspace_id`, `source_type`, `change_type`, `change_description`, `change_payload`, `supersedes_snapshot`, `status`, `deployed_at`, `deployed_by`
4. `client/src/pages/SkillsPage.tsx` — find the skill detail drawer component and understand the current tab structure
5. `server/routes/governance.ts` — confirm the `POST /:workspaceId/governance/:id/rollback` endpoint exists and its expected request shape

If any of these files don't exist at the expected paths, scan the codebase to find the actual paths before continuing.

---

## T001: Capture Governance Snapshot on Schedule Change

**File:** `server/routes/skills.ts`

**What to build:**

In the PATCH `/:workspaceId/skills/:skillId/schedule` handler:

1. **Before the upsert**, read the current `skill_schedules` row for this `(workspaceId, skillId)` pair:
   ```typescript
   const existing = await db.query(
     `SELECT cron, enabled FROM skill_schedules 
      WHERE workspace_id = $1 AND skill_id = $2`,
     [workspaceId, skillId]
   );
   const previousSnapshot = existing.rows[0] ?? null;
   // null means this is a net-new schedule (first time being set)
   ```

2. **After a successful upsert**, INSERT a `skill_governance` record:
   ```typescript
   await db.query(`
     INSERT INTO skill_governance (
       workspace_id,
       source_type,
       change_type,
       change_description,
       change_payload,
       supersedes_snapshot,
       status,
       deployed_at,
       deployed_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
   `, [
     workspaceId,
     'manual',
     'skill_schedule',
     'Schedule updated via UI',
     JSON.stringify({ skill_id: skillId, cron: req.body.cron, enabled: req.body.enabled }),
     previousSnapshot ? JSON.stringify(previousSnapshot) : null,
     'deployed',
     req.user?.id ?? 'admin'
   ]);
   ```

**Acceptance criteria:**
- Make a schedule change via the UI
- `SELECT * FROM skill_governance WHERE change_type = 'skill_schedule'` returns a row
- `change_payload` contains the new `{ skill_id, cron, enabled }`
- `supersedes_snapshot` contains the previous `{ cron, enabled }` (or NULL if first-time)
- `status = 'deployed'`, `deployed_at` is set

---

## T002: Add `skill_schedule` Rollback Handler

**File:** `server/governance/rollback-engine.ts`

**What to build:**

Add `'skill_schedule'` as a case in both `applyChange()` and `rollbackChange()`.

### In `applyChange()`:

```typescript
case 'skill_schedule': {
  const { skill_id, cron, enabled } = record.change_payload;
  await db.query(`
    INSERT INTO skill_schedules (workspace_id, skill_id, cron, enabled, updated_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (workspace_id, skill_id) 
    DO UPDATE SET cron = EXCLUDED.cron, enabled = EXCLUDED.enabled, updated_at = NOW()
  `, [record.workspace_id, skill_id, cron, enabled]);
  break;
}
```

### In `rollbackChange()`:

```typescript
case 'skill_schedule': {
  const { skill_id } = record.change_payload;
  const snapshot = record.supersedes_snapshot;

  if (snapshot === null) {
    // This was a net-new schedule — rollback means delete it
    await db.query(
      `DELETE FROM skill_schedules WHERE workspace_id = $1 AND skill_id = $2`,
      [record.workspace_id, skill_id]
    );
  } else {
    // Restore previous values
    await db.query(`
      INSERT INTO skill_schedules (workspace_id, skill_id, cron, enabled, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (workspace_id, skill_id)
      DO UPDATE SET cron = EXCLUDED.cron, enabled = EXCLUDED.enabled, updated_at = NOW()
    `, [record.workspace_id, skill_id, snapshot.cron, snapshot.enabled]);
  }
  break;
}
```

**Important:** After applying the rollback, the rollback engine should mark the governance record's `status` as `'rolled_back'` (this likely already happens in the outer rollback handler — verify and don't duplicate it).

**Acceptance criteria:**
- Call `POST /:workspaceId/governance/:governanceId/rollback` on a `skill_schedule` record
- The `skill_schedules` row for that skill reflects the `supersedes_snapshot` values
- If `supersedes_snapshot` was null, the row is deleted
- The governance record `status` is updated to `'rolled_back'`

---

## T003: Version History UI in Skill Drawer

### 3a. New API Endpoint

**File:** `server/routes/skills.ts`

Add:

```
GET /:workspaceId/skills/:skillId/history
```

Query:
```sql
SELECT 
  id,
  change_description,
  change_payload,
  supersedes_snapshot,
  deployed_at,
  deployed_by,
  status
FROM skill_governance
WHERE 
  workspace_id = $1
  AND change_type = 'skill_schedule'
  AND change_payload->>'skill_id' = $2
ORDER BY deployed_at DESC
LIMIT 50
```

Response shape:
```typescript
{
  history: Array<{
    id: string;
    change_description: string;
    change_payload: { skill_id: string; cron: string; enabled: boolean };
    supersedes_snapshot: { cron: string; enabled: boolean } | null;
    deployed_at: string;   // ISO timestamp
    deployed_by: string;
    status: 'deployed' | 'rolled_back';
  }>
}
```

### 3b. Frontend: History Tab in Skill Drawer

**File:** `client/src/pages/SkillsPage.tsx`

Add a **"History"** tab to the skill detail drawer alongside the existing tabs (Schedule, etc.).

**Tab content:**

```
[ Timeline list — newest first ]

Each row shows:
  ● Date/time (relative: "2 days ago", tooltip: full ISO)
  ● Human-readable diff:
      - If enabled changed:   "Schedule: disabled → enabled"
      - If cron changed:      "Cadence: weekly → daily"  (map cron to label, see below)
      - If both changed:      show both on separate lines
  ● Changed by: deployed_by value
  ● [ Revert ] button — disabled if status === 'rolled_back'

Empty state (no history rows):
  "No configuration changes recorded yet."
```

**Cron → human label mapping** (add as a local helper):
```typescript
const cronLabel = (cron: string): string => {
  if (!cron) return 'Not set';
  if (cron === '0 8 * * 1') return 'Weekly (Mon 8am)';
  if (cron === '0 8 * * *') return 'Daily (8am)';
  if (cron === '0 8 1 * *') return 'Monthly (1st, 8am)';
  return cron; // fallback: show raw cron
};
```

**Diff helper:**
```typescript
const describeChange = (payload: ChangePayload, previous: ChangePayload | null) => {
  const lines: string[] = [];
  if (!previous) {
    lines.push(`Schedule created: ${cronLabel(payload.cron)}, ${payload.enabled ? 'enabled' : 'disabled'}`);
  } else {
    if (previous.enabled !== payload.enabled) {
      lines.push(`Schedule: ${previous.enabled ? 'enabled' : 'disabled'} → ${payload.enabled ? 'enabled' : 'disabled'}`);
    }
    if (previous.cron !== payload.cron) {
      lines.push(`Cadence: ${cronLabel(previous.cron)} → ${cronLabel(payload.cron)}`);
    }
  }
  return lines;
};
```

**Revert action:**
```typescript
const handleRevert = async (governanceId: string) => {
  await fetch(`/api/workspaces/${workspaceId}/governance/${governanceId}/rollback`, {
    method: 'POST',
  });
  // Refresh both the history list and the schedule tab
  refetchHistory();
  refetchSkillSchedule();
};
```

**Loading state:** Show a subtle spinner while fetching history (the list is usually fast but don't block the drawer open).

---

## Task Order

Build in this sequence — T001 and T002 have no dependencies on each other and can be done in either order. T003 requires both.

```
T001 → T003
T002 → T003
```

---

## What NOT to Build

- Do NOT add governance tracking for skill enable/disable separately — the schedule PATCH handler already controls `enabled`, so T001 captures both in one record
- Do NOT build a global governance history page — this is scoped to the skill drawer only
- Do NOT add pagination to the history endpoint — LIMIT 50 is sufficient; skill schedules don't change frequently
- Do NOT modify the governance record after rollback beyond setting `status = 'rolled_back'` — the rollback engine already handles this

---

## Verification Sequence

After all three tasks are complete, run this end-to-end:

1. Open a skill drawer → go to History tab → should show empty state: "No configuration changes recorded yet."

2. Switch to the Schedule tab → change the cron (e.g., weekly → daily) → save

3. Return to the History tab → should show one row:
   - Diff: "Cadence: Weekly (Mon 8am) → Daily (8am)"
   - Status: `deployed`
   - Revert button: active

4. Click Revert → confirm the Schedule tab reflects the previous cron → History tab now shows the row with Revert button disabled (status: `rolled_back`)

5. Check the database:
   ```sql
   SELECT change_payload, supersedes_snapshot, status 
   FROM skill_governance 
   WHERE change_type = 'skill_schedule'
   ORDER BY deployed_at DESC;
   ```
   Should show one row with `status = 'rolled_back'`

6. Check `skill_schedules`:
   ```sql
   SELECT cron, enabled FROM skill_schedules WHERE skill_id = '<test_skill_id>';
   ```
   Should reflect the original (pre-change) values.
