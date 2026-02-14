# PM Integration Test Plan

## Overview
Test the Data Quality Audit → Monday.com task creation flow end-to-end.

## Prerequisites

### 1. Monday.com Configuration
Check if Frontera workspace has Monday connector configured:

```sql
SELECT
  id,
  name,
  settings->'pmConnector' as pm_config
FROM workspaces
WHERE id = '4160191d-73bc-414b-97dd-5a1853190378';
```

**Expected:** `pm_config` should contain:
```json
{
  "enabled": true,
  "connectorType": "monday",
  "defaultProjectId": "<board_id>",
  "labels": ["pandora", "data-quality"]
}
```

### 2. Monday.com Credentials
Verify credentials exist:

```sql
SELECT connector_name, created_at
FROM connections
WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378'
  AND connector_name LIKE 'pm_%';
```

**Expected:** Row with `connector_name = 'pm_monday'`

---

## Test Steps

### Step 1: Run Data Quality Audit

**Via API:**
```bash
curl -X POST http://localhost:3000/api/webhooks/skills/data-quality-audit/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "4160191d-73bc-414b-97dd-5a1853190378"
  }'
```

**Expected:**
- Skill runs successfully
- Status: `completed`
- `quality_metrics` in stepData contains field-level findings

### Step 2: Verify Hook Triggered

Check webhook.ts line 109-112:
```typescript
if (skill.id === 'data-quality-audit' && result.status === 'completed' && result.stepData) {
  await generatePMTasksForDataQuality(workspaceId, result);
}
```

**Expected:** Hook executes after skill completes

### Step 3: Check PM Task References

Query for created task references:

```sql
SELECT
  source_action_id,
  external_id,
  external_url,
  created_at
FROM pm_task_references
WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378'
  AND source_action_id LIKE 'dq_%'
ORDER BY created_at DESC
LIMIT 10;
```

**Expected:**
- One row per critical/moderate data quality finding
- `source_action_id` format: `dq_<runId>_<fieldName>`
- `external_id` = Monday.com item ID
- `external_url` = Direct link to Monday task

### Step 4: Verify Monday.com Tasks

**In Monday.com UI:**
1. Navigate to configured board/project
2. Look for tasks created by Pandora
3. Verify task properties:
   - **Name:** e.g., "Bulk cleanup close_date field (36 missing)"
   - **Description:** Finding details, impact metric, recommended approach
   - **Priority:** Critical or High
   - **Due Date:** 7 days (critical) or 14 days (moderate)
   - **Labels:** data-quality, pipeline-hygiene, <field_name>
   - **Category/Group:** Based on recommendedFix (e.g., "Data Cleanup", "System Config")

**Expected Task Example:**
```
Name: Bulk cleanup close_date field (36 missing)
Priority: High
Due: 2026-02-20
Labels: data-quality, pipeline-hygiene, close_date
Category: Data Cleanup

Description:
36 deals have past-due close dates that need to be updated.

Impact: 36 records with invalid close_date (82% fill rate)

Recommended Approach:
1. Export deals with missing/invalid close_date
2. Work with deal owners to set realistic close dates
3. Update in bulk via CSV import or API
4. Set validation rule to prevent future past-due dates

Source: data-quality-audit skill run
```

---

## Validation Checklist

- [ ] Monday connector configured in workspace settings
- [ ] Monday credentials stored and valid
- [ ] Data quality audit runs successfully
- [ ] Webhook hook executes (check logs)
- [ ] PM task references created in database
- [ ] Tasks appear in Monday.com board
- [ ] Task properties match finding data
- [ ] Due dates calculated correctly (7d critical, 14d moderate)
- [ ] Links back to Pandora work

---

## Troubleshooting

### No tasks created

**Check 1:** Is PM connector enabled?
```sql
SELECT settings->'pmConnector'->>'enabled' FROM workspaces WHERE id = '<workspace_id>';
```

**Check 2:** Are there critical/moderate findings?
```typescript
// Only critical and moderate findings create tasks
const actionableFindings = findings.filter(f => f.severity === 'critical' || f.severity === 'moderate');
```

**Check 3:** Check skill run logs
```bash
grep "generateDataQualityWorkItems" logs/pandora.log
```

### Tasks created but wrong priority

**Root cause:** Severity mapping in buildDataQualityWorkItem()
```typescript
const priority: OpsPriority = finding.severity === 'critical' ? 'critical' : 'high';
```

### Duplicate tasks

**Check:** sourceActionId should prevent duplicates
```typescript
sourceActionId: `dq_${skillRunId}_${finding.field}`
```

Same finding across multiple runs creates new tasks (by design - tracks changes over time).

---

## Success Criteria

✅ All data quality findings (critical + moderate) create Monday tasks
✅ Tasks contain actionable information for RevOps operator
✅ Priority and due date reflect severity
✅ No duplicate tasks for same run
✅ Task references stored for tracking
✅ End-to-end flow completes in < 5 seconds

---

## Future Enhancements

1. **Task Updates:** When finding improves (e.g., fill rate increases), update or close existing task
2. **Batch Creation:** Create all tasks in one Monday API call (currently one per finding)
3. **Smart Deduplication:** If same field issue persists across runs, update existing task instead of creating new
4. **Progress Tracking:** Sync task status back to Pandora (e.g., mark finding as "in_progress" when Monday task started)
5. **Analytics:** Dashboard showing PM task completion rates, time-to-resolution by category
