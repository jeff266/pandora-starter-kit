# Claude Code Prompt: Skill Version Control

## Objective

Version-control skill schedule configuration. Workspace admins can view a full change history and revert any previous state. Leverages the existing `skill_governance` table and rollback engine — **no new infrastructure needed**.

---

## Pre-Flight: Read Before Writing Any Code

1. `server/routes/skills.ts` — find the PATCH `/:workspaceId/skills/:skillId/schedule` handler; understand the upsert shape and how `req.user` is attached
2. `server/governance/rollback-engine.ts` — read the full `applyChange()` and `rollbackChange()` (or equivalent revert function) switch statements; note the DB client pattern used in existing cases (transaction wrapper vs raw query)
3. Schema/migrations — confirm `skill_governance` columns: `id`, `workspace_id`, `source_type`, `change_type`, `change_description`, `change_payload` (JSONB), `supersedes_snapshot` (JSONB), `status`, `deployed_at`, `deployed_by`
4. `client/src/pages/SkillsPage.tsx` — find the skill detail drawer and its current tab structure
5. `server/routes/governance.ts` — confirm `POST /:workspaceId/governance/:id/rollback` exists and whether it already sets `status = 'rolled_back'` in the outer handler (do NOT duplicate this in T002)

---

## T001: Capture Governance Snapshot on Schedule Change

**File:** `server/routes/skills.ts`

In the PATCH `/:workspaceId/skills/:skillId/schedule` handler:

**Step 1 — read previous state before the upsert:**
```typescript
const existing = await db.query(
  `SELECT cron, enabled FROM skill_schedules
   WHERE workspace_id = $1 AND skill_id = $2`,
  [workspaceId, skillId]
);
const previousSnapshot = existing.rows[0] ?? null;
// null = net-new schedule, no prior state
```

**Step 2 — after successful upsert, insert governance record:**
```typescript
await db.query(`
  INSERT INTO skill_governance (
    workspace_id, source_type, change_type, change_description,
    change_payload, supersedes_snapshot, status, deployed_at, deployed_by
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

**Acceptance:**
- After a schedule change, `SELECT * FROM skill_governance WHERE change_type = 'skill_schedule'` returns a row
- `change_payload` = new `{ skill_id, cron, enabled }`
- `supersedes_snapshot` = previous `{ cron, enabled }` or NULL if first-time
- `status = 'deployed'`, `deployed_at` is set

---

## T002: Add `skill_schedule` Rollback Handler

**File:** `server/governance/rollback-engine.ts`

Match the DB client pattern used by existing cases in this file exactly.

### Add to `applyChange()`:

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

### Add to `rollbackChange()` (or equivalent revert function):

```typescript
case 'skill_schedule': {
  const { skill_id } = record.change_payload;
  const snapshot = record.supersedes_snapshot;

  if (snapshot === null) {
    // Net-new schedule — rollback = delete (no prior state to restore)
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

**⚠️ Do NOT set `status = 'rolled_back'` here** — verify the outer rollback handler already does this. Adding it again causes a double-update.

**Acceptance:**
- `POST /:workspaceId/governance/:id/rollback` on a `skill_schedule` record restores prior `skill_schedules` values
- If `supersedes_snapshot` was null, the `skill_schedules` row is deleted
- Governance record `status` becomes `'rolled_back'`

---

## T003: Version History UI in Skill Drawer

**Blocked by T001, T002.**

### 3a. New API endpoint

**File:** `server/routes/skills.ts`

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

Response:
```typescript
{
  history: Array<{
    id: string;
    change_description: string;
    change_payload: { skill_id: string; cron: string; enabled: boolean };
    supersedes_snapshot: { cron: string; enabled: boolean } | null;
    deployed_at: string;  // ISO timestamp
    deployed_by: string;
    status: 'deployed' | 'rolled_back';
  }>
}
```

### 3b. Frontend — "History" tab in skill detail drawer

**File:** `client/src/pages/SkillsPage.tsx`

Add a **History** tab to the skill detail drawer alongside the existing tabs.

**Helpers (add locally in the component file):**

```typescript
const cronLabel = (cron: string): string => {
  if (!cron) return 'Not set';
  if (cron === '0 8 * * 1') return 'Weekly (Mon 8am)';
  if (cron === '0 8 * * *') return 'Daily (8am)';
  if (cron === '0 8 1 * *') return 'Monthly (1st, 8am)';
  return cron; // fallback to raw expression
};

const describeChange = (
  payload: { cron: string; enabled: boolean },
  previous: { cron: string; enabled: boolean } | null
): string[] => {
  if (!previous) {
    return [`Schedule created: ${cronLabel(payload.cron)}, ${payload.enabled ? 'enabled' : 'disabled'}`];
  }
  const lines: string[] = [];
  if (previous.enabled !== payload.enabled) {
    lines.push(`Schedule: ${previous.enabled ? 'enabled' : 'disabled'} → ${payload.enabled ? 'enabled' : 'disabled'}`);
  }
  if (previous.cron !== payload.cron) {
    lines.push(`Cadence: ${cronLabel(previous.cron)} → ${cronLabel(payload.cron)}`);
  }
  return lines;
};
```

**Revert handler:**
```typescript
const handleRevert = async (governanceId: string) => {
  await fetch(`/api/workspaces/${workspaceId}/governance/${governanceId}/rollback`, {
    method: 'POST',
  });
  refetchHistory();       // refresh history list
  refetchSkillSchedule(); // refresh schedule tab to show restored values
};
```

**Tab content — timeline list (newest first):**

Each row:
- Relative timestamp (`"2 hours ago"`) with full ISO on hover/tooltip
- Human-readable diff lines from `describeChange()`
- `Changed by: {deployed_by}`
- **Revert** button — disabled if `status === 'rolled_back'`

States:
- **Loading:** spinner while `GET .../history` is in flight
- **Empty:** `"No configuration changes recorded yet."`

---

## What NOT to Build

- No separate governance tracking for enable/disable — the schedule PATCH controls `enabled`, T001 captures both in one record
- No global governance history page — scoped to skill drawer only
- No pagination — LIMIT 50 is sufficient
- No `status = 'rolled_back'` write in T002 — the outer rollback handler already owns this

---

## Verification Sequence

Run this end-to-end after all three tasks are complete:

**1. Open skill drawer → History tab**
→ Should show empty state: *"No configuration changes recorded yet."*

**2. Switch to Schedule tab → change cron (e.g., weekly → daily) → save**

**3. Return to History tab**
→ One row: diff shows `"Cadence: Weekly (Mon 8am) → Daily (8am)"`, Revert button active

**4. Click Revert**
→ Schedule tab reflects the previous cron
→ History row: Revert button disabled

**5. Database spot-checks:**

```sql
-- Governance record
SELECT change_payload, supersedes_snapshot, status
FROM skill_governance
WHERE change_type = 'skill_schedule'
ORDER BY deployed_at DESC;
-- Expect: one row, status = 'rolled_back'

-- Schedule row
SELECT cron, enabled
FROM skill_schedules
WHERE skill_id = '<test_skill_id>';
-- Expect: original (pre-change) values
```
