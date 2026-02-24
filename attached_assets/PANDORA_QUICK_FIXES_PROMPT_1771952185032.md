# Claude Code Prompt: Quick Fixes — 4 Items, Under 1 Hour

## Context

The Verification Report (`VERIFICATION_REPORT.md`) identified 4 issues that are trivially fixable and collectively unblock PPTX downloads, 3 broken skills, missing database tables, and accurate shrink rate calculations. Do all 4 in order.

---

## Fix 1: PPTX Registry Swap (5 minutes)

**Problem:** `server/renderers/pptx-renderer.ts` (19 lines) is a stub that throws `"PPTX rendering is not yet available"`. Meanwhile `server/renderers/pptx-renderer-full.ts` (342 lines) has a complete pptxgenjs implementation. The registry in `server/renderers/index.ts` imports the stub.

**Steps:**

1. Read `server/renderers/index.ts` — find where the PPTX renderer is imported and registered.
2. Read `server/renderers/pptx-renderer.ts` — confirm it's the stub (should be ~19 lines, throws error).
3. Read `server/renderers/pptx-renderer-full.ts` — confirm it's the real implementation (should be ~342 lines, uses pptxgenjs).
4. Change the import in `server/renderers/index.ts` to point to `pptx-renderer-full.ts` instead of `pptx-renderer.ts`.
5. Verify the export name/class matches what the registry expects. If `pptx-renderer-full.ts` exports a different class name than what the registry imports, update accordingly. The registry likely expects a class with a `render()` method — confirm the full renderer has the same interface.
6. If there's a type mismatch (the full renderer's render method has a different signature than what the registry calls), adapt the full renderer to match the expected interface. DO NOT simplify the full renderer — adapt the registry call or add a thin wrapper.

**Verification:** After the change, search the codebase for any code that calls the PPTX renderer through the registry. Trace the call to confirm it would now reach the full implementation instead of throwing.

**Do NOT delete `pptx-renderer.ts`** — just stop importing it. We may want it as a reference.

---

## Fix 2: dependsOn Bugs in 3 Skills (15 minutes)

**Problem:** Three skills reference `outputKey` values in their `dependsOn` arrays instead of step IDs. The skill runtime resolves dependencies by step ID, so these steps can't find their inputs and either fail or get undefined data.

**Steps for each skill:**

### 2a. competitive-intelligence

1. Open the skill file in `server/skills/library/` (likely `competitive-intelligence.ts` or similar).
2. Find step 5 (or whichever step has `dependsOn` containing `competitive_patterns`).
3. Find the step that PRODUCES `competitive_patterns` as its `outputKey`. Note that step's `id`.
4. Replace `competitive_patterns` in the `dependsOn` array with the correct step ID (likely `analyze-competitive-patterns` or similar).
5. Confirm: the `dependsOn` value must match an `id` field of another step, NOT an `outputKey`.

### 2b. stage-velocity-benchmarks

1. Open the skill file.
2. Find the step with `dependsOn` containing `pattern_classifications`.
3. Find the step whose `id` produces that output. Likely `classify-patterns`.
4. Replace `pattern_classifications` with the correct step `id`.

### 2c. forecast-accuracy-tracking

1. Open the skill file.
2. Find the step with `dependsOn` containing `rep_classifications`.
3. Find the step whose `id` produces that output. Likely `classify-volatile-reps`.
4. Replace `rep_classifications` with the correct step `id`.

**Pattern to follow for each fix:**

```
// WRONG — references outputKey
dependsOn: ['some-step', 'competitive_patterns']

// RIGHT — references step id  
dependsOn: ['some-step', 'analyze-competitive-patterns']
```

**Verification:** For each skill, read ALL steps in order and confirm every `dependsOn` entry matches an `id` of a preceding step. List any other skills that have the same pattern (outputKey in dependsOn instead of step id) — there may be more than 3.

---

## Fix 3: Run Missing Migrations (10 minutes)

**Problem:** Several migration files exist in `server/migrations/` (or `server/db/migrations/`) but haven't been applied to the database. Tables like `targets`, `quotas`, `deal_score_snapshots`, and `report_share_links` don't exist yet.

**Steps:**

1. List all migration files in the migrations directory. Sort by number.
2. Check which migrations have been applied. Look for:
   - A `migrations` or `schema_migrations` table in the database
   - Or a migration runner that tracks applied migrations
   - Or check the database directly for which tables exist vs which migrations would create them
3. Read the migration runner code — understand how it applies pending migrations. Find the function/script that runs migrations.
4. Identify ALL unapplied migrations. The verification report mentions:
   - Migration 064 (targets + quotas)
   - Migration 056 (deal_score_snapshots)  
   - Migration 051 (report_share_links)
   - There may be others between the last applied and the latest file.
5. Apply all pending migrations in numerical order.
6. After running, verify: Query the database (or check migration tracking) to confirm the new tables exist.

**IMPORTANT:** Read each migration SQL carefully before applying. Look for:
- DROP TABLE or destructive operations — flag these
- Dependencies on other tables that might not exist
- IF NOT EXISTS guards (safe) vs bare CREATE TABLE (could fail if partially applied before)

If the migration runner doesn't exist or is broken, apply the SQL files manually in order using the database connection.

---

## Fix 4: Create field_change_log Table (30 minutes)

**Problem:** `compute_shrink_rate` in `server/chat/data-tools.ts` queries `field_change_log` but the table doesn't exist, so it always returns a hardcoded 10% fallback. `query_field_history` also references this table.

**Steps:**

1. Search the codebase for all references to `field_change_log`. Note:
   - The expected schema (column names, types) based on how the code queries it
   - Which functions query it and what columns/filters they use
2. Based on those references, create a migration that builds the table. The schema should support at minimum:

```sql
CREATE TABLE IF NOT EXISTS field_change_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  entity_type VARCHAR(50) NOT NULL,        -- 'deal', 'contact', 'account'
  entity_id VARCHAR(255) NOT NULL,         -- CRM record ID
  field_name VARCHAR(255) NOT NULL,        -- 'amount', 'close_date', 'stage', etc.
  old_value TEXT,
  new_value TEXT,
  changed_at TIMESTAMPTZ NOT NULL,
  changed_by VARCHAR(255),                 -- user/actor who made the change
  source VARCHAR(50) DEFAULT 'crm_sync',   -- 'crm_sync', 'manual', 'api'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Indexes for common queries
  CONSTRAINT fk_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE INDEX idx_field_change_log_entity ON field_change_log(workspace_id, entity_type, entity_id);
CREATE INDEX idx_field_change_log_field ON field_change_log(workspace_id, field_name, changed_at);
CREATE INDEX idx_field_change_log_deal_amount ON field_change_log(workspace_id, entity_type, field_name) 
  WHERE entity_type = 'deal' AND field_name IN ('amount', 'close_date', 'stage');
```

3. **IMPORTANT:** Cross-reference with what `compute_shrink_rate` and `query_field_history` actually expect. The column names in the migration MUST match what the code queries. Read both functions carefully and adjust the schema to match their SQL.

4. Apply the migration.

5. **Populate from existing data:** Check if `deal_stage_history` has data that could bootstrap `field_change_log` entries. The verification report shows 4,175 rows in `deal_stage_history`. Write a one-time backfill query:

```sql
-- Backfill stage changes from deal_stage_history into field_change_log
INSERT INTO field_change_log (workspace_id, entity_type, entity_id, field_name, old_value, new_value, changed_at, source)
SELECT 
  workspace_id,
  'deal',
  deal_id,
  'stage',
  previous_stage,    -- adjust column names to match deal_stage_history schema
  new_stage,
  changed_at,
  'crm_sync'
FROM deal_stage_history
WHERE NOT EXISTS (
  SELECT 1 FROM field_change_log 
  WHERE entity_id = deal_stage_history.deal_id 
  AND field_name = 'stage' 
  AND changed_at = deal_stage_history.changed_at
);
```

6. **Also check:** Does the HubSpot sync or Salesforce sync capture field changes during incremental sync? If so, find where deal updates are processed and add logic to INSERT into `field_change_log` when tracked fields change (amount, close_date, stage, forecast_category at minimum). This ensures the table stays populated going forward.

If adding sync-time field tracking is complex, skip it for now — the backfill from deal_stage_history gives us stage changes, and amount/close_date tracking can come in a follow-up.

**Verification:** After creating and populating, test `compute_shrink_rate` — it should now return real calculated values instead of the 10% fallback. Also test `query_field_history` with a known deal ID.

---

## Final Verification Checklist

After all 4 fixes, confirm:

- [ ] PPTX renderer produces a real .pptx file when called through the registry
- [ ] competitive-intelligence skill runs to completion (trigger a manual run if possible)
- [ ] stage-velocity-benchmarks skill runs to completion
- [ ] forecast-accuracy-tracking skill runs to completion
- [ ] New tables exist: targets, quotas, deal_score_snapshots, report_share_links, field_change_log
- [ ] field_change_log has rows (from backfill)
- [ ] compute_shrink_rate returns calculated values, not 10%

Report what you did, what worked, and any issues encountered. If any fix requires decisions (e.g., schema column names don't match), document the decision and why.
