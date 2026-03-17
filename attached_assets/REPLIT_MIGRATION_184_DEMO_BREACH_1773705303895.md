# Replit Prompt: Migration 184 + Demo Breach Setup

## Context

The `gtm-health-diagnostic` skill and hypothesis red team feature are blocked
by two problems:

1. Migration 184 has never been applied — `deliberation_runs` is missing
   `hypothesis_id` and `forecast_run_id` columns. Every call to
   `runHypothesisRedTeam()` silently fails with a Postgres 500.

2. No standing hypotheses are currently in breach (all 8 are passing), so
   the "Run Red Team" button will not render on any card. We need at least
   one hypothesis in breach for the demo.

Fix both. This is pre-demo hardening, not new feature work.

---

## Task 1: Apply Migration 184

The migration file already exists at:
`migrations/184_deliberation_hypothesis.sql`

**Step 1 — Verify the file exists and check its DDL:**
```bash
cat migrations/184_deliberation_hypothesis.sql
```
Confirm it contains `ALTER TABLE deliberation_runs ADD COLUMN hypothesis_id`
and `ADD COLUMN forecast_run_id`. Do not modify it.

**Step 2 — Check what migrations have been applied:**
```sql
SELECT name FROM migrations ORDER BY applied_at DESC LIMIT 5;
```
Confirm `182_actions_sprint.sql` is the latest. Migration 183 and 184
have not run.

**Step 3 — Apply migration 184 using the migration runner:**
```bash
npx tsx server/migrate.ts
```
The migration runner reads from the root `/migrations/` directory and
applies any unapplied files in numeric order. This will apply 183 and
184 if both are present, or just 184 if 183 was already applied.

**Step 4 — Verify the columns now exist:**
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'deliberation_runs'
  AND column_name IN ('hypothesis_id', 'forecast_run_id');
```
Expected: 2 rows returned.

**Step 5 — Verify the endpoint no longer 500s:**
Make a test POST to the red team endpoint for any standing hypothesis ID.
The response should return `{ success: true, ... }` or a structured error
— not a 500. If it 500s still, check server logs for the exact Postgres
error message and report it.

---

## Task 2: Force a Demo Breach

Currently `conversion_rate` is at 35.6 with a threshold of 35
(`alert_direction = below`). `isBreached()` evaluates `35.6 < 35 → false`.
No card shows an alert state.

We need one hypothesis in breach so the "Run Red Team" button appears.

**Option A (preferred): Lower the conversion_rate threshold temporarily**

```sql
UPDATE standing_hypotheses
SET alert_threshold = 36
WHERE metric_key = 'conversion_rate'
  AND workspace_id = '4160191d-73bc-414b-97dd-5a1853190378';
```

This makes `isBreached()` evaluate `35.6 < 36 → true`. The card will
show the alert state and the button will render. 

After the demo, restore it:
```sql
UPDATE standing_hypotheses
SET alert_threshold = 35
WHERE metric_key = 'conversion_rate'
  AND workspace_id = '4160191d-73bc-414b-97dd-5a1853190378';
```

**Option B (alternative): Re-run gtm-health-diagnostic with lower params**

If you'd prefer not to touch the threshold, re-run `gtm-health-diagnostic`
against the Frontera workspace with parameters that produce a genuine breach
on a metric that is actually underperforming. Check `large_deal_cohort`:
current is 0.6 vs threshold 236.1 — that IS in breach already if the
direction is `above`. Verify:

```sql
SELECT metric_key, current_value, alert_threshold, alert_direction,
       CASE
         WHEN alert_direction = 'below' THEN (current_value < alert_threshold)
         WHEN alert_direction = 'above' THEN (current_value > alert_threshold)
       END as is_breached
FROM standing_hypotheses
WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378';
```

If `large_deal_cohort` shows `is_breached = true`, the button should
already be rendering for that card — investigate why it isn't. If the
`alert_direction` is wrong, correct it:

```sql
UPDATE standing_hypotheses
SET alert_direction = 'above'
WHERE metric_key = 'large_deal_cohort'
  AND workspace_id = '4160191d-73bc-414b-97dd-5a1853190378';
```

`large_deal_cohort` at 0.6 vs 236.1 is genuinely alarming and a better
demo story than a nudged conversion rate.

---

## Acceptance Criteria

Before closing this task, confirm all of the following:

- [ ] `deliberation_runs` has `hypothesis_id UUID` and `forecast_run_id UUID` columns
- [ ] Migration runner shows 184 in the `migrations` table
- [ ] POST to the red team endpoint returns `{ success: true }` (no 500)
- [ ] At least one standing hypothesis shows `is_breached = true` in the DB query above
- [ ] The "Run Red Team" button renders on the breached hypothesis card in the UI
- [ ] Clicking the button triggers the red team flow without a silent failure
- [ ] Server logs show no `column does not exist` errors during the button click

Report which option you used for the breach (A or B) and paste the
`is_breached` query output so we can confirm the state before the demo.

---

## Do Not Touch

- Do not modify `runHypothesisRedTeam()` logic
- Do not change any other migration files
- Do not alter thresholds for any workspace other than Frontera
  (`4160191d-73bc-414b-97dd-5a1853190378`)
- Do not restart the server mid-migration — apply migration first, then restart once
