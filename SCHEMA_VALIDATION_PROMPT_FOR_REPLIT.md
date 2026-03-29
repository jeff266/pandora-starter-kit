# Schema Validation for Engagement Drop-Off Analysis Skill

**Before Claude Code builds the engagement-dropoff-analysis skill, we need to verify these column names exist in the database.**

Run these queries against your Neon Postgres database and paste back the results:

---

## 1. Conversations Table

```sql
-- Check conversations table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'conversations'
  AND column_name IN ('id', 'workspace_id', 'deal_id', 'participants', 'started_at', 'ended_at')
ORDER BY ordinal_position;
```

**Questions:**
- Does `conversations.deal_id` exist? (column name exact)
- Does `conversations.participants` exist? (column name exact)
- Is `participants` JSONB type?
- Does the participants JSONB contain an `affiliation` key for external participants?

**Sample query to verify participants structure:**
```sql
SELECT participants
FROM conversations
WHERE participants IS NOT NULL
  AND jsonb_array_length(participants) > 0
LIMIT 3;
```

Paste 2-3 sample values so we can see the structure.

---

## 2. Activities Table

```sql
-- Check activities table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'activities'
  AND column_name IN ('id', 'workspace_id', 'deal_id', 'occurred_at', 'activity_date', 'created_at')
ORDER BY ordinal_position;
```

**Questions:**
- Does `activities.deal_id` exist? (column name exact)
- What is the timestamp column name? `occurred_at` or `activity_date`?

---

## 3. Activity Signals Table

```sql
-- Check activity_signals table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'activity_signals'
  AND column_name IN ('id', 'activity_id', 'speaker_type', 'signal_type')
ORDER BY ordinal_position;
```

**Questions:**
- Does `activity_signals.activity_id` exist? (FK to activities.id)
- Does `activity_signals.speaker_type` exist?
- What are the valid values for `speaker_type`? ('prospect', 'rep', 'unknown'?)

**Sample query:**
```sql
SELECT DISTINCT speaker_type, COUNT(*)
FROM activity_signals
GROUP BY speaker_type;
```

---

## 4. Deals Table - Outcome Column

```sql
-- Check deals table for outcome-related columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'deals'
  AND (column_name LIKE '%outcome%' OR column_name LIKE '%stage%' OR column_name = 'close_date')
ORDER BY ordinal_position;
```

**Critical question:**
- Is there a `deals.outcome` column with values like ('won', 'lost')?
- OR do we derive outcome from `stage_normalized` IN ('closed_won', 'closed_lost')?

**If no outcome column exists, run this:**
```sql
SELECT DISTINCT stage_normalized, COUNT(*)
FROM deals
WHERE stage_normalized IN ('closed_won', 'closed_lost')
GROUP BY stage_normalized;
```

**Confirm:**
- Column name for close date: `close_date` or `closed_date`?
- Column name for deal stage: `stage` or `stage_normalized` or both?
- Column name for deal amount: `amount` or `value`?

---

## 5. Two-Way Engagement Test Query

**Run this test query to confirm the engagement detection logic will work:**

```sql
-- Test: Find deals with two-way engagement signals (last 30 days)
WITH two_way_touches AS (
  -- Conversations with external participants
  SELECT c.deal_id, MAX(c.started_at) as touch_at, 'call' as touch_type
  FROM conversations c
  WHERE c.deal_id IS NOT NULL
    AND c.participants @> '[{"affiliation":"External"}]'
    AND c.started_at >= NOW() - INTERVAL '30 days'
  GROUP BY c.deal_id

  UNION ALL

  -- Activities with prospect speaker signals
  SELECT a.deal_id, MAX(a.occurred_at) as touch_at, 'email' as touch_type
  FROM activities a
  WHERE a.deal_id IS NOT NULL
    AND a.occurred_at >= NOW() - INTERVAL '30 days'
    AND EXISTS (
      SELECT 1 FROM activity_signals s
      WHERE s.activity_id = a.id AND s.speaker_type = 'prospect'
    )
  GROUP BY a.deal_id
)
SELECT
  touch_type,
  COUNT(DISTINCT deal_id) as deals_with_signal,
  MIN(touch_at) as earliest,
  MAX(touch_at) as latest
FROM two_way_touches
GROUP BY touch_type;
```

**Expected output:**
- Row 1: touch_type='call', deals_with_signal=X, dates
- Row 2: touch_type='email', deals_with_signal=Y, dates

**If this query fails:**
- Note which part failed (conversations? activities? activity_signals?)
- Paste the exact error message
- We'll adjust the column names

---

## 6. Closed Deals Historical Data Check

**Verify we have enough historical closed deals for threshold analysis:**

```sql
SELECT
  stage,
  stage_normalized,
  COUNT(*) as deal_count,
  MIN(close_date) as earliest_close,
  MAX(close_date) as latest_close
FROM deals
WHERE stage_normalized IN ('closed_won', 'closed_lost')
  AND close_date >= NOW() - INTERVAL '18 months'
GROUP BY stage, stage_normalized
ORDER BY deal_count DESC;
```

**Questions:**
- Do we have at least 50-100 closed deals in the last 18 months?
- Are there multiple stage values (Discovery, Demo, Proposal, etc.) represented?
- Or do closed deals only show final stage values?

---

## 7. Workspace-Specific Data Availability

**Frontera workspace (4160191d-73bc-414b-97dd-5a1853190378):**
```sql
-- Check Frontera has both conversation and activity signal data
SELECT
  (SELECT COUNT(*) FROM conversations WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378') as conversation_count,
  (SELECT COUNT(*) FROM conversations WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378' AND deal_id IS NOT NULL) as conversations_with_deals,
  (SELECT COUNT(*) FROM activity_signals WHERE activity_id IN (
    SELECT id FROM activities WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378'
  )) as activity_signal_count,
  (SELECT COUNT(*) FROM activity_signals WHERE speaker_type = 'prospect' AND activity_id IN (
    SELECT id FROM activities WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378'
  )) as prospect_signals;
```

**Paste the counts so we know:**
- Does Frontera have conversation data? (Gong integration)
- Does Frontera have activity_signals? (Email enrichment)
- Can we use both call + email signals?

---

## Summary Checklist

After running all queries above, confirm:

- [ ] `conversations.deal_id` exists and is populated
- [ ] `conversations.participants` is JSONB with `affiliation` key structure
- [ ] `conversations.started_at` is the timestamp column name
- [ ] `activities.deal_id` exists and is populated
- [ ] `activities.occurred_at` (or `activity_date`) is the timestamp column name
- [ ] `activity_signals.activity_id` is the FK to activities
- [ ] `activity_signals.speaker_type` exists with values: 'prospect', 'rep', 'unknown'
- [ ] `deals.stage_normalized` contains 'closed_won' and 'closed_lost' values
- [ ] `deals.close_date` (or `closed_date`) exists
- [ ] `deals.amount` exists
- [ ] Two-way engagement test query (section 5) runs successfully
- [ ] At least 50 closed deals exist in last 18 months (section 6)
- [ ] Frontera has both conversation + activity signal data (section 7)

---

**Once you paste back all results, Claude Code can:**
1. Adjust column names in the SQL queries if needed
2. Determine if we derive outcome from stage_normalized or use a dedicated column
3. Confirm the participants JSONB structure for external affiliation detection
4. Build the engagement-dropoff-analysis skill with correct column references
5. Set appropriate confidence levels based on data availability

**Paste your results in this format:**

```
## Query 1 - Conversations Table
[paste output]

## Query 2 - Activities Table
[paste output]

## Query 3 - Activity Signals
[paste output]

## Query 4 - Deals Outcome
[paste output]

## Query 5 - Two-Way Engagement Test
[paste output or error message]

## Query 6 - Closed Deals Historical
[paste output]

## Query 7 - Frontera Data Availability
[paste output]
```
