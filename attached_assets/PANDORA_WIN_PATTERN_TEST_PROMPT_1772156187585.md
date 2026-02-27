# Replit Prompt: Test Win-Pattern Coaching Engine

Read REPLIT_CONTEXT.md if you haven't already.

This tests the win-pattern coaching engine against real production data. 
The engine replaces hardcoded coaching signals with data-driven patterns 
discovered from closed-won vs closed-lost deals.

---

## Step 0: Pre-flight Checks

Before anything else, verify the prerequisites are in place:

```typescript
// Run this diagnostic first
async function preflight(workspaceId: string) {
  // 1. Check closed deal counts
  const closedDeals = await db.query(`
    SELECT 
      stage_normalized,
      COUNT(*) as n,
      AVG(amount) as avg_amount,
      MIN(amount) as min_amount,
      MAX(amount) as max_amount
    FROM deals 
    WHERE workspace_id = $1 
      AND stage_normalized IN ('closed_won', 'closed_lost')
      AND created_date > NOW() - INTERVAL '12 months'
    GROUP BY stage_normalized
  `, [workspaceId]);
  
  console.log('=== CLOSED DEAL INVENTORY ===');
  console.table(closedDeals.rows);
  
  // 2. Check conversation coverage on closed deals
  const convCoverage = await db.query(`
    SELECT 
      d.stage_normalized as outcome,
      COUNT(DISTINCT d.id) as deals,
      COUNT(DISTINCT CASE WHEN c.id IS NOT NULL THEN d.id END) as deals_with_conversations,
      ROUND(COUNT(DISTINCT CASE WHEN c.id IS NOT NULL THEN d.id END)::numeric / 
            NULLIF(COUNT(DISTINCT d.id), 0) * 100, 1) as coverage_pct
    FROM deals d
    LEFT JOIN conversations c ON c.deal_id = d.id
    WHERE d.workspace_id = $1 
      AND d.stage_normalized IN ('closed_won', 'closed_lost')
      AND d.created_date > NOW() - INTERVAL '12 months'
    GROUP BY d.stage_normalized
  `, [workspaceId]);
  
  console.log('\n=== CONVERSATION COVERAGE ON CLOSED DEALS ===');
  console.table(convCoverage.rows);
  
  // 3. Check resolved_participants population
  const resolvedParts = await db.query(`
    SELECT 
      COUNT(*) as total_conversations,
      COUNT(*) FILTER (WHERE resolved_participants IS NOT NULL 
        AND resolved_participants != '[]'::jsonb) as has_resolved,
      COUNT(*) FILTER (WHERE call_metrics IS NOT NULL) as has_metrics,
      COUNT(*) FILTER (WHERE deal_id IS NOT NULL) as linked_to_deal
    FROM conversations 
    WHERE workspace_id = $1
  `, [workspaceId]);
  
  console.log('\n=== CONVERSATION DATA QUALITY ===');
  console.table(resolvedParts.rows);
  
  // 4. Check deal_stage_history population
  const stageHistory = await db.query(`
    SELECT COUNT(*) as entries, COUNT(DISTINCT deal_id) as deals_with_history
    FROM deal_stage_history
    WHERE workspace_id = $1
  `, [workspaceId]);
  
  console.log('\n=== STAGE HISTORY ===');
  console.table(stageHistory.rows);
  
  // 5. Determine which workspaces have enough data
  const wonCount = closedDeals.rows.find(r => r.stage_normalized === 'closed_won')?.n || 0;
  const lostCount = closedDeals.rows.find(r => r.stage_normalized === 'closed_lost')?.n || 0;
  
  if (wonCount >= 15 && lostCount >= 10) {
    console.log(`\n✅ READY: ${wonCount} won + ${lostCount} lost — sufficient for pattern discovery`);
  } else if (wonCount >= 5 && lostCount >= 3) {
    console.log(`\n⚠️ MARGINAL: ${wonCount} won + ${lostCount} lost — can run discovery but segments will be limited`);
    console.log('   Will use single segment (no size banding). Results are directional, not definitive.');
  } else {
    console.log(`\n❌ INSUFFICIENT: ${wonCount} won + ${lostCount} lost — need 15+ won and 10+ lost`);
    console.log('   Coaching tab should show "Building your benchmarks" message.');
  }
  
  return { wonCount, lostCount, convCoverage: convCoverage.rows };
}
```

Run preflight for ALL active workspaces. Log which ones are testable:

```typescript
const workspaces = await db.query(`SELECT id, name FROM workspaces WHERE status = 'active'`);
for (const ws of workspaces.rows) {
  console.log(`\n========== ${ws.name} ==========`);
  await preflight(ws.id);
}
```

Capture the output. We need at least one workspace with 15+ won / 10+ lost 
to fully test. If no workspace meets the threshold, use the best available 
and note that results are from a thin sample.

---

## Step 1: Run Migration

Run the win_patterns migration. Use the next available migration number:

```sql
-- migrations/XXX_win_patterns.sql

CREATE TABLE IF NOT EXISTS win_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL,
  segment_size_min NUMERIC,
  segment_size_max NUMERIC,
  segment_pipeline TEXT,
  won_median NUMERIC NOT NULL,
  won_p25 NUMERIC NOT NULL,
  won_p75 NUMERIC NOT NULL,
  lost_median NUMERIC NOT NULL,
  lost_p25 NUMERIC NOT NULL,
  lost_p75 NUMERIC NOT NULL,
  separation_score NUMERIC NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('higher_wins', 'lower_wins')),
  sample_size_won INTEGER NOT NULL,
  sample_size_lost INTEGER NOT NULL,
  relevant_stages TEXT[] NOT NULL DEFAULT '{all}',
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_win_patterns_current 
  ON win_patterns (workspace_id, dimension) 
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_win_patterns_history
  ON win_patterns (workspace_id, discovered_at DESC);
```

Verify: `SELECT COUNT(*) FROM win_patterns;` should return 0.

---

## Step 2: Run Discovery on Best Workspace

Pick the workspace with the most closed deal data from preflight.

Import and run the discovery function:

```typescript
import { discoverWinPatterns } from '../server/coaching/win-pattern-discovery';

const workspaceId = 'PASTE_BEST_WORKSPACE_ID_HERE';

console.log('Starting win pattern discovery...');
const result = await discoverWinPatterns(workspaceId, db);

console.log('\n=== DISCOVERY RESULTS ===');
console.log(`Total closed deals analyzed: ${result.total_closed_deals}`);
console.log(`Won: ${result.won_deals}, Lost: ${result.lost_deals}`);
console.log(`Segments analyzed: ${result.segments_analyzed}`);
console.log(`Dimensions checked: ${result.dimensions_checked}`);
console.log(`Patterns found: ${result.patterns_found.length}`);
console.log(`Insufficient data for: ${result.insufficient_data.join(', ') || 'none'}`);

console.log('\n=== DISCOVERED PATTERNS ===');
for (const p of result.patterns_found) {
  const sizeLabel = p.segment.size_band_min != null 
    ? `$${p.segment.size_band_min}-$${p.segment.size_band_max}` 
    : 'all sizes';
  console.log(`\n  ${p.dimension} (${sizeLabel})`);
  console.log(`    Won median: ${p.won_median} | Lost median: ${p.lost_median}`);
  console.log(`    Won range: ${p.won_p25} - ${p.won_p75}`);
  console.log(`    Direction: ${p.direction}`);
  console.log(`    Separation: ${p.separation_score.toFixed(3)}`);
  console.log(`    Relevant stages: ${p.relevant_stages.join(', ')}`);
  console.log(`    Sample: ${p.sample_size_won} won + ${p.sample_size_lost} lost`);
}

console.log('\n=== INSUFFICIENT DATA DIMENSIONS ===');
for (const dim of result.insufficient_data) {
  console.log(`  ⏭️ ${dim} — skipped (not enough non-null values)`);
}
```

---

## Step 3: Validate Patterns Make Sense

This is the critical step — eyeball the results and confirm they pass the smell test.

```typescript
// Query the stored patterns
const patterns = await db.query(`
  SELECT * FROM win_patterns 
  WHERE workspace_id = $1 AND superseded_at IS NULL
  ORDER BY separation_score DESC
`, [workspaceId]);

console.log('\n=== PATTERN VALIDATION ===');
console.log(`${patterns.rows.length} active patterns stored\n`);

for (const p of patterns.rows) {
  const flag = p.separation_score >= 0.7 ? '🟢 STRONG' :
               p.separation_score >= 0.5 ? '🟡 MODERATE' : '🔵 EMERGING';
  
  console.log(`${flag} ${p.dimension}`);
  console.log(`  Size band: ${p.segment_size_min ?? 'any'} - ${p.segment_size_max ?? 'any'}`);
  console.log(`  Won: median=${p.won_median}, IQR=[${p.won_p25}, ${p.won_p75}]`);
  console.log(`  Lost: median=${p.lost_median}, IQR=[${p.lost_p25}, ${p.lost_p75}]`);
  console.log(`  ${p.direction === 'higher_wins' ? '📈 Higher is better' : '📉 Lower is better'}`);
  console.log(`  Stages: ${p.relevant_stages}`);
  console.log('');
}
```

### What to look for:

**Sanity checks — these should be TRUE:**
- `sales_cycle_days` should be `lower_wins` (faster deals win more)
- `call_count` should be `higher_wins` (more engagement = better)
- `days_between_calls_avg` should be `lower_wins` (tighter cadence = better)
- `stage_regression_count` should be `lower_wins` (fewer regressions = better)

**Interesting if they appear:**
- `unique_external_participants` might NOT show up as a pattern for small deal sizes
- `avg_talk_ratio_rep` might show `lower_wins` (less rep talking = more discovery)
- `avg_action_items_per_call` direction could go either way — interesting signal

**Red flags — investigate if you see:**
- `sales_cycle_days` as `higher_wins` (longer deals win more?) — probably data quality issue
- Very low separation scores across the board (< 0.3) — closed deals may not have enough variance
- Zero conversation-related patterns — conversations may not be linked to enough closed deals

---

## Step 4: Test Against Known Deals

Pick 3 specific deals you know well and test coaching signal generation:

```typescript
import { generateCoachingSignals } from '../server/coaching/coaching-signals';

// Pick deals across different scenarios:
// 1. A small deal at late stage (should NOT get multi-threading advice)
// 2. A large deal at early stage (should get whatever patterns apply to large deals)
// 3. A deal that you know is in trouble (should surface real issues)

const testDeals = [
  'DEAL_ID_1_SMALL_LATE_STAGE',
  'DEAL_ID_2_LARGE_EARLY_STAGE', 
  'DEAL_ID_3_KNOWN_AT_RISK',
];

for (const dealId of testDeals) {
  const deal = await db.query(`
    SELECT d.*, d.inferred_phase, d.phase_confidence, d.phase_divergence
    FROM deals d WHERE d.id = $1
  `, [dealId]);
  
  if (!deal.rows[0]) {
    console.log(`Deal ${dealId} not found, skipping`);
    continue;
  }
  
  const d = deal.rows[0];
  console.log(`\n========================================`);
  console.log(`DEAL: ${d.name}`);
  console.log(`Amount: $${d.amount} | Stage: ${d.stage} | Close: ${d.close_date}`);
  console.log(`========================================`);
  
  // Get a conversation for this deal to pass to the function
  const conv = await db.query(`
    SELECT * FROM conversations 
    WHERE deal_id = $1 ORDER BY started_at DESC LIMIT 1
  `, [dealId]);
  
  const signals = await generateCoachingSignals(
    conv.rows[0] || null,
    d,
    workspaceId,
    db
  );
  
  console.log(`\nSignals generated: ${signals.length}`);
  for (const s of signals) {
    const badge = s.type === 'action' ? '🔴 ACTION' : 
                  s.type === 'positive' ? '🟢 STRENGTH' : 'ℹ️ INFO';
    console.log(`  ${badge} ${s.label}`);
    console.log(`    ${s.insight}`);
    if (s.data) {
      console.log(`    Current: ${s.data.current_value} | Won median: ${s.data.won_median} | Sample: ${s.data.sample_size}`);
    }
  }
}
```

### Validation criteria:

For DEAL 1 (small, late stage):
- ❌ Should NOT see "expand buying committee" at Contract Sent
- ❌ Should NOT see coaching based on large-deal patterns
- ✅ May see nothing (if deal is on track) — that's correct
- ✅ If signals appear, they should reference the correct size band

For DEAL 2 (large, early stage):  
- ✅ Multi-threading signal is fair game IF the data supports it for large deals
- ✅ Signals should be stage-appropriate (discovery/evaluation patterns only)
- ❌ Should NOT reference Contract Sent or Closed Won patterns

For DEAL 3 (at risk):
- ✅ Should surface at least 1-2 action signals
- ✅ Signals should point to the ACTUAL issue (whatever you know about this deal)
- ✅ Each signal should have non-trivial sample size (10+)

---

## Step 5: Test Edge Cases

### 5A: Workspace with no closed deals

```typescript
// Create a temporary test or find a workspace with zero closed deals
const emptyWsResult = await discoverWinPatterns('WORKSPACE_WITH_FEW_DEALS', db);
console.log('Empty workspace result:', emptyWsResult);
// Expected: patterns_found = [], insufficient_data populated
```

### 5B: Deal with no conversations

```typescript
// Find a deal with no linked conversations
const noConvDeal = await db.query(`
  SELECT d.id, d.name, d.amount, d.stage 
  FROM deals d
  LEFT JOIN conversations c ON c.deal_id = d.id
  WHERE d.workspace_id = $1 
    AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
    AND c.id IS NULL
  LIMIT 1
`, [workspaceId]);

if (noConvDeal.rows[0]) {
  const signals = await generateCoachingSignals(null, noConvDeal.rows[0], workspaceId, db);
  console.log('No-conversation deal signals:', signals);
  // Expected: only CRM-based signals (stage duration, contact count), no conversation-based ones
  // Conversation dimensions should be skipped gracefully, not error
}
```

### 5C: Second discovery run (supersession)

```typescript
// Run discovery again — previous patterns should be superseded
const firstRunPatterns = await db.query(`
  SELECT COUNT(*) as n FROM win_patterns 
  WHERE workspace_id = $1 AND superseded_at IS NULL
`, [workspaceId]);
console.log(`Active patterns before re-run: ${firstRunPatterns.rows[0].n}`);

await discoverWinPatterns(workspaceId, db);

const afterRunPatterns = await db.query(`
  SELECT COUNT(*) as n, superseded_at IS NULL as is_current
  FROM win_patterns WHERE workspace_id = $1
  GROUP BY superseded_at IS NULL
`, [workspaceId]);
console.log('After re-run:', afterRunPatterns.rows);
// Expected: previous patterns have superseded_at set, new patterns are current
// Total count roughly doubled (old superseded + new current)
```

### 5D: Segmentation behavior

```typescript
// Verify that deal size segmentation is working
const segments = await db.query(`
  SELECT DISTINCT segment_size_min, segment_size_max, 
    COUNT(*) as pattern_count
  FROM win_patterns 
  WHERE workspace_id = $1 AND superseded_at IS NULL
  GROUP BY segment_size_min, segment_size_max
`, [workspaceId]);

console.log('\n=== SEGMENTS ===');
console.table(segments.rows);
// If deal amounts span a wide range (q3 > 3x q1), should see 2-3 segments
// If narrow range, should see 1 segment (null-null = all sizes)
```

---

## Step 6: Compare Old vs New Signals

Load the conversation detail page for the same deal shown in the screenshot
(Rally Behavioral - AB + RAB, $3k, Contract Sent) and verify:

```typescript
// Load the conversation dossier for the screenshot deal
const rallyDeal = await db.query(`
  SELECT id FROM deals 
  WHERE workspace_id = $1 AND name ILIKE '%Rally Behavioral%'
  LIMIT 1
`, [workspaceId]);

if (rallyDeal.rows[0]) {
  const conv = await db.query(`
    SELECT id FROM conversations 
    WHERE deal_id = $1 ORDER BY started_at DESC LIMIT 1
  `, [rallyDeal.rows[0].id]);
  
  if (conv.rows[0]) {
    // Import the conversation dossier assembler
    const dossier = await assembleConversationDossier(
      workspaceId, conv.rows[0].id, db
    );
    
    console.log('\n=== RALLY BEHAVIORAL COACHING SIGNALS (NEW ENGINE) ===');
    for (const s of dossier.coaching_signals) {
      console.log(`  [${s.type.toUpperCase()}] ${s.label}`);
      console.log(`    ${s.insight}`);
    }
    
    // THE KEY CHECK:
    // "Limited multi-threading" should NOT appear because either:
    // a) The pattern doesn't exist for $3k deals (data doesn't support it)
    // b) The pattern exists but relevant_stages doesn't include Contract Sent
    // c) Both
    
    const hasMultiThreading = dossier.coaching_signals.some(s => 
      s.label.toLowerCase().includes('multi-thread') || 
      s.label.toLowerCase().includes('buyer contact')
    );
    
    if (hasMultiThreading) {
      console.log('\n❌ FAIL: Multi-threading signal still appears for $3k Contract Sent deal');
      console.log('   Check: segment filtering, stage relevance filtering');
    } else {
      console.log('\n✅ PASS: Multi-threading signal correctly suppressed');
    }
  }
}
```

---

## Step 7: Performance Check

Discovery should be fast since it's pure SQL:

```typescript
const start = Date.now();
const result = await discoverWinPatterns(workspaceId, db);
const elapsed = Date.now() - start;

console.log(`\nDiscovery completed in ${elapsed}ms`);
console.log(`Deals processed: ${result.total_closed_deals}`);
console.log(`Patterns found: ${result.patterns_found.length}`);

if (elapsed > 5000) {
  console.log('⚠️ Discovery took >5s — check query performance');
  console.log('   Likely culprit: resolved_participants JSONB expansion');
  console.log('   Consider: pre-computing conversation aggregates per deal');
} else {
  console.log('✅ Performance OK');
}
```

Signal generation (per deal) should be <100ms:

```typescript
const signalStart = Date.now();
await generateCoachingSignals(conv.rows[0], deal.rows[0], workspaceId, db);
const signalElapsed = Date.now() - signalStart;

console.log(`Signal generation: ${signalElapsed}ms`);
if (signalElapsed > 100) {
  console.log('⚠️ Signal gen >100ms — page load may feel slow');
} else {
  console.log('✅ Signal generation fast enough for page render');
}
```

---

## Expected Output Summary

After running all steps, you should have:

1. **Preflight report** showing which workspaces have enough data
2. **Discovery results** with X patterns across Y segments
3. **Validation table** confirming patterns pass sanity checks
4. **3 deal tests** showing context-appropriate signals (or correct absence of signals)
5. **Edge case results** — empty workspace handled, no-conversation deals handled, supersession works
6. **Rally Behavioral check** — multi-threading signal confirmed absent
7. **Performance numbers** — discovery <5s, signal generation <100ms

Log all output. If patterns look wrong or unexpected, paste the full 
output back and we'll diagnose before wiring into the UI.
