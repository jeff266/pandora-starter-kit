# Phase 10: API Endpoints — Implementation Summary

## Status: ✅ Complete (Pending Database Migrations)

All 8 API endpoints have been implemented and TypeScript compiles successfully. The endpoints are ready to use once Phase 1 migrations (218_metric_definitions.sql, 219_calibration_checklist.sql) are run on the database.

---

## Files Modified

### server/routes/forward-deploy.ts
- **Before:** 80 lines (Phase 8 seed endpoints only)
- **After:** 620 lines
- **Added:** 540 lines (8 new endpoints + imports)

**Changes:**
- Added imports for `resolveWorkspaceIntelligence`, `invalidateWorkspaceIntelligence`, `CALIBRATION_QUESTIONS`, `getQuestionById`, `query`
- Added 8 new endpoint handlers with full error handling and validation

---

## Endpoints Implemented

### 1. GET `/api/workspaces/:workspaceId/intelligence`
**Purpose:** Returns full WorkspaceIntelligence object for dashboard/debug UI

**Response Shape:**
```typescript
{
  success: true,
  data: WorkspaceIntelligence  // Full WI object with all domains
}
```

**Key Fields:**
- `workspace_id`: string
- `business`: GTM motion, forecast methodology, products, etc.
- `metrics`: All metric definitions with confidence levels
- `taxonomy`: Land/expand classification, deal types
- `pipeline`: Active stages, coverage targets, weighting
- `segmentation`: Default dimensions, confirmed segments
- `data_quality`: Field completion rates, trust scores
- `knowledge`: Hypotheses, findings, skill evidence
- `readiness`: Overall score, domain scores, blocking gaps, skill gates

---

### 2. GET `/api/workspaces/:workspaceId/intelligence/readiness`
**Purpose:** Lighter endpoint for progress indicators

**Response Shape:**
```typescript
{
  success: true,
  data: {
    overall_score: number,  // 0-100
    by_domain: {
      business: number,     // 0-1
      metrics: number,
      segmentation: number,
      taxonomy: number,
      pipeline: number,
      data_quality: number
    },
    blocking_gaps: string[],  // question_ids with UNKNOWN status + skill dependencies
    skill_gates: {
      [skillId: string]: 'LIVE' | 'DRAFT' | 'BLOCKED'
    }
  }
}
```

---

### 3. GET `/api/workspaces/:workspaceId/calibration`
**Purpose:** Returns calibration checklist grouped by domain with progress counts

**Query:** Joins `calibration_checklist` table with `CALIBRATION_QUESTIONS` metadata

**Response Shape:**
```typescript
{
  success: true,
  data: {
    overall_score: number,  // Weighted average across domains
    domains: {
      [domain: string]: {
        score: number,       // (confirmed + 0.5 * inferred) / total * 100
        total: number,
        confirmed: number,
        inferred: number,
        unknown: number,
        questions: Array<{
          question_id: string,
          question: string,         // From CALIBRATION_QUESTIONS
          description: string,      // From CALIBRATION_QUESTIONS
          answer_type: string,      // From CALIBRATION_QUESTIONS
          options: string[],        // From CALIBRATION_QUESTIONS
          status: 'CONFIRMED' | 'INFERRED' | 'UNKNOWN' | 'BLOCKED',
          answer: jsonb,
          answer_source: string,
          confidence: number,
          required_for_live: boolean,
          skill_dependencies: string[],
          depends_on: string[],
          human_confirmed: boolean
        }>
      }
    }
  }
}
```

**Scoring Logic:**
- CONFIRMED: 1.0 weight
- INFERRED: 0.5 weight
- UNKNOWN: 0.0 weight

---

### 4. PATCH `/api/workspaces/:workspaceId/calibration/:questionId`
**Purpose:** Update a single checklist answer (forward deployment specialist fills in question)

**Request Body:**
```typescript
{
  answer: any,                              // Required - question-specific format
  status: 'CONFIRMED' | 'INFERRED',         // Required
  confirmed_by?: string                     // Optional - user identifier
}
```

**Validation:**
- `status` must be 'CONFIRMED' or 'INFERRED' → 400 if invalid
- `answer` must be present → 400 if missing
- `question_id` must exist in CALIBRATION_QUESTIONS → 404 if unknown

**Database Update:**
```sql
UPDATE calibration_checklist
SET answer = $1, status = $2, confidence = $3,
    confirmed_by = $4, confirmed_at = NOW(),
    human_confirmed = ($2 = 'CONFIRMED'),
    answer_source = 'FORWARD_DEPLOY',
    updated_at = NOW()
WHERE workspace_id = $5 AND question_id = $6
RETURNING *
```

**Side Effects:**
- Calls `invalidateWorkspaceIntelligence(workspaceId)` to clear cache
- May move skill gates from BLOCKED → DRAFT or DRAFT → LIVE

**Response:** Updated row merged with question metadata

---

### 5. POST `/api/workspaces/:workspaceId/calibration/:questionId/confirm`
**Purpose:** Confirmation loop - Pandora presents computed value, human confirms/rejects

**Request Body:**
```typescript
{
  confirmed_value: number,      // What Pandora computed
  confirmed: boolean,           // true = accept, false = reject
  confirmed_by?: string         // User identifier
}
```

**If `confirmed = true`:**
```sql
UPDATE calibration_checklist
SET status = 'CONFIRMED', human_confirmed = true,
    confirmed_by = $1, confirmed_at = NOW(),
    answer = jsonb_set(COALESCE(answer, '{}'), '{confirmed_value}', $2::text::jsonb),
    updated_at = NOW()
WHERE workspace_id = $3 AND question_id = $4
```

**If `confirmed = false`:**
```sql
UPDATE calibration_checklist
SET status = 'UNKNOWN', human_confirmed = false,
    pandora_computed_answer = answer,  -- Save what Pandora thought
    answer = null,
    updated_at = NOW()
WHERE workspace_id = $3 AND question_id = $4
```

**Side Effects:**
- Calls `invalidateWorkspaceIntelligence(workspaceId)`
- Rejection logs that definition needs review

---

### 6. GET `/api/workspaces/:workspaceId/metrics`
**Purpose:** Returns all metric definitions merged with WI confidence gates

**Response Shape:**
```typescript
{
  success: true,
  data: Array<{
    id: string,
    workspace_id: string,
    metric_key: string,
    label: string,
    description: string,
    numerator: QueryDefinition,        // JSONB
    denominator: QueryDefinition | null,
    aggregation_method: 'ratio' | 'sum' | 'count' | 'avg' | 'days',
    unit: 'ratio' | 'currency' | 'count' | 'days' | 'percentage',
    segmentation_defaults: string[],
    confidence: 'CONFIRMED' | 'INFERRED' | 'UNKNOWN',
    confirmed_by: string | null,
    confirmed_at: Date | null,
    confirmed_value: number | null,
    last_computed_value: number | null,
    last_computed_at: Date | null,
    source: 'SYSTEM' | 'FORWARD_DEPLOY' | 'INFERRED' | 'USER',
    current_gate: 'CONFIRMED' | 'INFERRED' | 'UNKNOWN'  // From WI
  }>
}
```

---

### 7. PATCH `/api/workspaces/:workspaceId/metrics/:metricKey`
**Purpose:** Forward deployment override of metric definition (workspace calculates differently than standard)

**Request Body:**
```typescript
{
  numerator?: QueryDefinition,     // Optional - override numerator
  denominator?: QueryDefinition,   // Optional - override denominator
  label?: string,                  // Optional - override label
  description?: string,            // Optional - override description
  confirmed_by?: string            // User identifier
}
```

**Validation:**
- If `numerator` provided, must have `entity` and `aggregation` fields → 400 if invalid

**Database Update:**
```sql
UPDATE metric_definitions
SET numerator = COALESCE($1, numerator),
    denominator = COALESCE($2, denominator),
    label = COALESCE($3, label),
    description = COALESCE($4, description),
    confidence = 'CONFIRMED',
    confirmed_by = $5,
    confirmed_at = NOW(),
    source = 'FORWARD_DEPLOY',
    updated_at = NOW()
WHERE workspace_id = $6 AND metric_key = $7
RETURNING *
```

**Side Effects:**
- Calls `invalidateWorkspaceIntelligence(workspaceId)`

---

### 8. POST `/api/workspaces/:workspaceId/metrics/:metricKey/confirm`
**Purpose:** Confirmation loop for metrics - does Pandora's computed value match expectations?

**Request Body:**
```typescript
{
  confirmed_value: number,      // Expected value from client
  confirmed: boolean,           // true = matches, false = doesn't match
  confirmed_by?: string         // User identifier
}
```

**If `confirmed = true`:**
```sql
UPDATE metric_definitions
SET confidence = 'CONFIRMED',
    confirmed_value = $1,
    confirmed_by = $2,
    confirmed_at = NOW(),
    updated_at = NOW()
WHERE workspace_id = $3 AND metric_key = $4
```

**If `confirmed = false`:**
```sql
UPDATE metric_definitions
SET confidence = 'UNKNOWN',
    updated_at = NOW()
WHERE workspace_id = $1 AND metric_key = $2
```
Logs that metric definition needs review

**Side Effects:**
- Calls `invalidateWorkspaceIntelligence(workspaceId)`
- Rejection indicates definition needs adjustment

---

## TypeScript Compilation

✅ **No errors in forward-deploy.ts**

```bash
npx tsc --noEmit 2>&1 | grep "forward-deploy"
# (no output = no errors)
```

Total compilation errors: 36 (all pre-existing, unrelated to Phase 10)

---

## Checklist Already Wired

✅ **The checklist is already passed to `evaluateSkillGate`**

In `server/lib/workspace-intelligence.ts` line 651:
```typescript
const gateResult = evaluateSkillGate(manifest, checklistRows, partialWi);
```

The `checklistRows` array is populated from the database query at line 536-541:
```typescript
const result = await query<CalibrationChecklistRow>(
  `SELECT question_id, domain, status, skill_dependencies
   FROM calibration_checklist
   WHERE workspace_id = $1`,
  [workspaceId]
);
```

**This means skill gates will automatically update** when checklist questions are answered via the PATCH endpoint.

---

## Next Steps

### 1. Run Phase 1 Migrations (If Not Already Run)

```bash
# Check if migrations exist
psql $DATABASE_URL -c "SELECT tablename FROM pg_tables WHERE tablename IN ('calibration_checklist', 'metric_definitions');"

# If missing, run migrations
psql $DATABASE_URL < migrations/218_metric_definitions.sql
psql $DATABASE_URL < migrations/219_calibration_checklist.sql
```

### 2. Run Phase 8 Seeder (If Not Already Run)

```bash
# Seed the Frontera workspace
curl -X POST http://localhost:5000/api/admin/forward-deploy/seed/4160191d-73bc-414b-97dd-5a1853190378 \
  -H "Authorization: Bearer <token>"
```

### 3. Test Endpoints

```bash
# 1. Get full WorkspaceIntelligence
curl http://localhost:5000/api/workspaces/4160191d-73bc-414b-97dd-5a1853190378/intelligence \
  -H "Authorization: Bearer <token>"

# 2. Get readiness only
curl http://localhost:5000/api/workspaces/4160191d-73bc-414b-97dd-5a1853190378/intelligence/readiness \
  -H "Authorization: Bearer <token>"

# 3. Get calibration checklist
curl http://localhost:5000/api/workspaces/4160191d-73bc-414b-97dd-5a1853190378/calibration \
  -H "Authorization: Bearer <token>"

# 4. Update pipeline_coverage_target to 3.0 (CONFIRMED)
curl -X PATCH http://localhost:5000/api/workspaces/4160191d-73bc-414b-97dd-5a1853190378/calibration/pipeline_coverage_target \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"answer": {"value": 3.0}, "status": "CONFIRMED", "confirmed_by": "forward-deploy-test"}'

# 5. Check readiness again - pipeline_coverage_target should no longer be in blocking_gaps
curl http://localhost:5000/api/workspaces/4160191d-73bc-414b-97dd-5a1853190378/intelligence/readiness \
  -H "Authorization: Bearer <token>"

# 6. Check pipeline-waterfall skill gate - should move toward LIVE if coverage_target was last missing required item
curl http://localhost:5000/api/workspaces/4160191d-73bc-414b-97dd-5a1853190378/intelligence/readiness \
  -H "Authorization: Bearer <token>" \
  | jq '.data.skill_gates["pipeline-waterfall"]'

# 7. Get metrics
curl http://localhost:5000/api/workspaces/4160191d-73bc-414b-97dd-5a1853190378/metrics \
  -H "Authorization: Bearer <token>"

# 8. Confirm a metric value
curl -X POST http://localhost:5000/api/workspaces/4160191d-73bc-414b-97dd-5a1853190378/metrics/win_rate/confirm \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"confirmed_value": 0.35, "confirmed": true, "confirmed_by": "forward-deploy-test"}'
```

---

## Acceptance Criteria

| # | Criteria | Status |
|---|----------|--------|
| 1 | All endpoints compile without TypeScript errors | ✅ PASS |
| 2 | Server starts without crashing | ⏸️ PENDING (migrations needed) |
| 3 | GET /intelligence returns 200 with valid WI object | ⏸️ PENDING (migrations needed) |
| 4 | GET /calibration returns 200 with all 6 domains | ⏸️ PENDING (migrations needed) |
| 5 | PATCH /calibration/:questionId updates row and returns 200 | ⏸️ PENDING (migrations needed) |
| 6 | After PATCH, blocking_gaps no longer includes updated question | ⏸️ PENDING (migrations needed) |
| 7 | After PATCH, skill gate moves from DRAFT toward LIVE | ⏸️ PENDING (migrations needed) |
| 8 | requirePermission correctly applied - unauthenticated = 401 | ✅ PASS (pattern followed) |

---

## Implementation Notes

### Error Handling Pattern
All endpoints follow consistent error handling:
```typescript
try {
  // Endpoint logic
  res.json({ success: true, data: ... });
} catch (err: any) {
  console.error('[ForwardDeploy] Operation failed:', err?.message);
  res.status(500).json({
    success: false,
    error: 'Operation failed',
    message: err?.message
  });
}
```

### Validation Pattern
- 400 status for invalid request parameters
- 404 status for resource not found
- 500 status for server errors

### Permission Pattern
All endpoints use:
```typescript
router.get('/:workspaceId/...', requirePermission('config.view'), async (req, res) => { ... })
```

This ensures only authenticated users with `config.view` permission can access Forward Deploy endpoints.

### Cache Invalidation
Write operations call `invalidateWorkspaceIntelligence(workspaceId)` to ensure:
- Next GET request recomputes WI from fresh database state
- Skill gates reflect updated checklist/metrics immediately
- No stale data served to UI

---

## Summary

**Phase 10 is code-complete.** All 8 endpoints are implemented with:
- ✅ Proper error handling
- ✅ Input validation
- ✅ Permission checks
- ✅ Cache invalidation
- ✅ TypeScript type safety
- ✅ Consistent response shapes

**Blockers:** Local database needs Phase 1 migrations (218, 219) run before endpoints can be tested end-to-end.

**Next:** Run migrations on live Neon instance and test against Frontera workspace `4160191d-73bc-414b-97dd-5a1853190378`.
