# Workspace Memory System - Testing Instructions

## Prerequisites (Run in Replit)

### 1. Run Pre-Read Verification Queries

```sql
-- 1. Confirm tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
  'targets', 'sales_reps', 'business_dimensions',
  'workspace_knowledge', 'metric_definitions',
  'workspaces'
)
ORDER BY table_name;

-- 2. Show targets schema
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'targets'
ORDER BY ordinal_position;

-- 3. Show sales_reps schema
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'sales_reps'
ORDER BY ordinal_position;

-- 4. Show business_dimensions schema
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'business_dimensions'
ORDER BY ordinal_position;

-- 5. Check Frontera data - targets
SELECT period_label, target_amount, pipeline,
  target_type, period_start, period_end
FROM targets
WHERE workspace_id = (
  SELECT id FROM workspaces
  WHERE name ILIKE '%frontera%' LIMIT 1
)
ORDER BY period_start DESC
LIMIT 6;

-- 6. Check Frontera data - sales_reps
SELECT name, email, role, manager_email
FROM sales_reps
WHERE workspace_id = (
  SELECT id FROM workspaces
  WHERE name ILIKE '%frontera%' LIMIT 1
);

-- 7. Check Frontera data - business_dimensions
SELECT dimension_key, label, is_active,
  left(filter_definition::text, 100) as filter_preview
FROM business_dimensions
WHERE workspace_id = (
  SELECT id FROM workspaces
  WHERE name ILIKE '%frontera%' LIMIT 1
);
```

### 2. Apply Migration

```bash
psql $DATABASE_URL -f migrations/209_workspace_knowledge.sql
```

Verify:
```sql
SELECT COUNT(*) FROM workspace_knowledge;
-- Should return 0 (empty table)
```

---

## Build 1: Workspace Context Expansion

### Test: Coverage Question

**Action:** Open Ask Pandora on Frontera workspace and ask:
```
What's our pipeline coverage?
```

**Expected:**
- Should show actual Q2 2026 target (e.g. "150K")
- Should NOT say "unknown target"
- Coverage ratio should be calculated using actual target

### Test: System Prompt Inspection

**Action:** Check logs for system prompt generation

**Expected to see:**
```
WORKSPACE CONFIGURATION:

Current quarter target: 150K

Quota targets:
  Q2 2026: 150K (quarterly)
  Q3 2026: 175K (quarterly)

Sales team:
  John Smith (AE) · reports to jane@frontera.com
  Jane Doe (AE)

Confirmed business definitions:
  Active Pipeline (active_pipeline): Deals not in closed_won or closed_lost
```

---

## Build 2: Workspace Knowledge Extraction

### Test: Knowledge Extraction

**Action:** Tell Pandora in Ask Pandora:
```
Our ABA therapy deals take 90 days minimum because of insurance authorization requirements.
```

**Expected:**
- Response acknowledges the statement
- No errors in logs

**Verify extraction:**
```sql
SELECT key, value, source, confidence, used_count
FROM workspace_knowledge
WHERE workspace_id = (
  SELECT id FROM workspaces
  WHERE name ILIKE '%frontera%' LIMIT 1
);
```

**Should show:**
- key: `cycle_time.aba_therapy_deals`
- value: "Our ABA therapy deals take 90 days minimum because of insurance authorization requirements"
- source: `conversation`
- confidence: `0.70`

### Test: Knowledge Retrieval

**Action:** In a new conversation, ask:
```
What do you know about our deal cycles?
```

**Expected:**
- Response should reference the ABA therapy 90-day cycle
- Should cite it: "Based on what you've told me about ABA therapy deals..."

**Verify knowledge in system prompt:**
```
BUSINESS KNOWLEDGE (learned from conversations):
  [medium] Our ABA therapy deals take 90 days minimum because of insurance authorization requirements

When using any item above with confidence "high", cite it: "Based on what you've told me about [topic]..."
```

### Test: Confidence Increment

**Action:** Tell Pandora again (in a new conversation):
```
Our ABA therapy deals take 90 days because of insurance authorization.
```

**Verify:**
```sql
SELECT key, confidence, used_count
FROM workspace_knowledge
WHERE key LIKE '%aba_therapy%'
  AND workspace_id = (
    SELECT id FROM workspaces
    WHERE name ILIKE '%frontera%' LIMIT 1
  );
```

**Should show:**
- confidence: `0.75` (incremented by 0.05)
- used_count: `1` (or higher if retrieved)

---

## Build 3: Three-Tier Metric Confidence

### Test: Metric Assertion with No Computed Value

**Action:** Tell Pandora:
```
Our quota target is $2M this quarter.
```

**Expected Response:**
```
You mentioned $2M as your quota target. I don't have enough data to verify that from your CRM yet. I'll store it as your stated value. You can update it anytime.

Should I use $2M for calculations?
```

**Verify stored in workspace_knowledge:**
```sql
SELECT key, value, confidence
FROM workspace_knowledge
WHERE key LIKE '%quota_target%'
  AND workspace_id = (
    SELECT id FROM workspaces
    WHERE name ILIKE '%frontera%' LIMIT 1
  );
```

### Test: Metric Assertion with Matching Computed Value

**Action:** Tell Pandora:
```
Our win rate is 30%
```

**Expected Response:**
```
You mentioned 30% — that matches what I computed: 30.2% from your 15 closed-won out of 50 total closed deals over the last 12 months.

Should I lock this in as your official win rate benchmark?
```

### Test: Metric Assertion with Divergent Computed Value

**Action:** Tell Pandora:
```
Our win rate is 50%
```

**Expected Response:**
```
You mentioned 50%, but I'm computing 30.2% from your 15 closed-won out of 50 total closed deals over the last 12 months.

A few things could explain the difference: different time period, different pipeline scope, or data not yet synced.

Which should I use?
  A) Your number: 50%
  B) My computed number: 30.2%
  C) Let me dig deeper first
```

### Test: No Direct Write to metric_definitions

**Verify:**
```sql
SELECT metric_key, value, calibration_source
FROM metric_definitions
WHERE workspace_id = (
  SELECT id FROM workspaces
  WHERE name ILIKE '%frontera%' LIMIT 1
)
AND metric_key IN ('win_rate', 'quota_target', 'avg_deal_size');
```

**Should show:**
- NO rows for asserted metrics
- Only CONFIRMED metrics (if any exist from calibration)

---

## Client-Side TODO (Build 3 - Data Dictionary Badges)

**File:** `client/src/pages/DataDictionary.tsx` (or wherever source badges are rendered)

**Add these badge types:**
```typescript
const SOURCE_BADGES = {
  // Existing:
  system:   { label: 'System',   color: 'gray' },
  USER:     { label: 'User',     color: 'teal' },
  // New:
  computed:  {
    label: 'Computed',
    color: 'blue',
    tooltip: 'Calculated from your CRM data'
  },
  confirmed: {
    label: 'Confirmed',
    color: 'teal',
    tooltip: 'Verified and locked by your team'
  },
  asserted:  {
    label: 'Asserted',
    color: 'amber',
    tooltip: 'Stated in conversation — not yet verified against CRM data'
  },
}
```

**Render:**
- Show badge on every Data Dictionary row
- Tooltip appears on hover
- Color-code by confidence tier

---

## Final Verification Checklist

- [ ] Ask "what's our coverage?" uses actual target, not "unknown"
- [ ] Tell Pandora "our ABA deals take 90 days because of insurance auth"
- [ ] Next query, ask "what do you know about our deal cycles?" — surfaces it
- [ ] Tell Pandora "our win rate is 30%" — shows comparison with computed rate
- [ ] Check Data Dictionary — shows source badges (after client-side implementation)
- [ ] Run: `SELECT * FROM workspace_knowledge WHERE workspace_id = (SELECT id FROM workspaces WHERE name ILIKE '%frontera%') LIMIT 5;`
  → Should show extracted claims

---

## Rollback (if needed)

```sql
-- Remove migration
DROP TABLE IF EXISTS workspace_knowledge CASCADE;

-- Revert code changes
git checkout HEAD~1
```

---

## Success Criteria

1. ✅ Coverage calculations use actual targets from `targets` table
2. ✅ System prompt shows sales team roster from `sales_reps` table
3. ✅ System prompt shows confirmed dimensions from `business_dimensions` table
4. ✅ Workspace knowledge extraction works (pattern matching, no LLM calls)
5. ✅ Knowledge appears in system prompt for future conversations
6. ✅ Metric assertions trigger comparison responses
7. ✅ Asserted metrics stored in `workspace_knowledge`, NOT `metric_definitions`
8. ✅ Zero new TypeScript errors
