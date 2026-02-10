# Pandora Skill Design Guide
## The Mandatory Three-Phase Pattern

**Purpose**: Every skill MUST follow this structure. No exceptions. This prevents token waste, ensures Claude gets structured inputs, and keeps costs predictable.

---

## The Pattern

```
Phase 1: COMPUTE (Tier 1 — Free)
  Aggregate, bucket, rank, filter.
  Output: summaries with totals, breakdowns, top-N lists.
  Claude NEVER sees raw data. It sees numbers and structure.

Phase 2: CLASSIFY (Tier 2 — DeepSeek, cheap)
  Classify, extract, categorize individual items.
  Input: top N items from compute phase (N ≤ 30).
  Output: structured JSON — one classification per item.
  DeepSeek does the per-item grunt work Claude shouldn't touch.

Phase 3: SYNTHESIZE (Tier 3 — Claude, expensive)
  Reason, strategize, narrate.
  Input: compute summaries + DeepSeek classifications.
  Output: strategic insight, recommendations, narrative.
  Claude's context should be < 4K tokens total.
  Claude gets tools for follow-up queries if it needs to drill deeper.
```

**Token budget rule of thumb:**
- Compute steps: 0 tokens
- DeepSeek steps: < 2K input, < 2K output
- Claude steps: < 4K input, < 4K output
- Total per skill run: < 12K tokens (target), < 20K tokens (hard ceiling)

If your skill exceeds 20K tokens, you haven't aggregated enough in compute.

---

## What Each Phase Produces

### Phase 1: COMPUTE outputs

Compute steps produce **summary objects**, never raw record arrays.

**BAD** (sends raw data downstream):
```json
{
  "staleDeals": [{ "name": "Acme", "amount": 50000, "stage": "qualification", ... }, ...291 items]
}
```

**GOOD** (sends aggregated summary):
```json
{
  "staleDealsSummary": {
    "total": 291,
    "totalValue": 4200000,
    "byStage": { "qualification": 142, "evaluation": 89, "decision": 60 },
    "byOwner": { "Jane Smith": 45, "Mike Chen": 38, "Sarah Lee": 52 },
    "bySeverity": {
      "critical": { "count": 47, "value": 1100000, "thresholdDays": 30 },
      "warning": { "count": 112, "value": 1800000, "thresholdDays": 14 },
      "watch": { "count": 132, "value": 1300000, "thresholdDays": 7 }
    },
    "avgDaysStale": 23,
    "medianDaysStale": 18
  },
  "topStaleDeals": [
    { "name": "Acme Corp", "amount": 220000, "stage": "decision", "daysStale": 87, "owner": "Mike Chen", "lastActivityType": "email", "contactCount": 2 },
    ...top 20 by amount
  ]
}
```

The summary is ~500 tokens. The top-20 list is ~1,000 tokens. Total: ~1,500 tokens vs 200K+ for raw data.

### Phase 2: CLASSIFY outputs

DeepSeek receives the top-N items and classifies each one. Output is structured JSON.

```json
{
  "classifications": [
    {
      "dealName": "Acme Corp",
      "rootCause": "rep_neglect",
      "confidence": 0.85,
      "signals": ["no activity in 87 days", "single-threaded (1 contact)", "stuck in decision stage"],
      "suggestedAction": "immediate outreach or close as lost"
    },
    {
      "dealName": "Globex Industries",
      "rootCause": "prospect_stalled",
      "confidence": 0.72,
      "signals": ["last activity was prospect email 45 days ago", "3 contacts engaged", "awaiting budget approval"],
      "suggestedAction": "follow up with champion on budget timeline"
    }
  ]
}
```

Root cause categories (standardized across all skills):
- `rep_neglect` — rep hasn't followed up
- `prospect_stalled` — waiting on prospect action
- `data_hygiene` — deal should be closed/updated but wasn't
- `process_gap` — no defined next step or handoff failed
- `timing` — prospect has a future timeline, deal is legitimately paused
- `competitive_loss` — lost to competitor but not marked
- `champion_change` — key contact left or changed roles

### Phase 3: SYNTHESIZE outputs

Claude receives summaries + classifications and produces strategic narrative.

Claude's input context looks like this:
```
BUSINESS CONTEXT (from context layer):
- Pipeline coverage target: 3.0x
- Current quota: $2M
- Stale deal threshold: 14 days
- Team: 8 reps

PIPELINE SUMMARY (from compute):
- Total pipeline: $8.4M (4.2x coverage)
- 291 stale deals worth $4.2M
- 47 critical (30+ days), concentrated in qualification stage
- Mike Chen and Sarah Lee have most stale deals

DEAL CLASSIFICATIONS (from DeepSeek):
- Top 20 deals classified by root cause
- 8 rep_neglect, 5 prospect_stalled, 4 data_hygiene, 3 process_gap

YOUR TASK:
Produce a Pipeline Hygiene Report...
```

Total input: ~3K tokens. Claude produces ~2K tokens of output. Total: ~5K tokens.

---

## Enforcing the Pattern

### Validation Rules (enforce in SkillRuntime)

Before executing a skill, the runtime validates:

1. **No CLAUDE step receives raw data arrays > 10 items.**
   If a compute step output contains an array with > 10 items, the runtime REJECTS the skill definition. Force the skill author to aggregate.

2. **Every CLAUDE step has a preceding COMPUTE or DEEPSEEK step.**
   Claude should never be step 1. There must be data preparation first.

3. **No DEEPSEEK step receives > 30 items.**
   If you need to classify more than 30 items, add another compute step to filter/rank first.

4. **Token budget tracking per step.**
   If a step's input exceeds 8K tokens, log a warning. If it exceeds 20K tokens, abort with an error explaining which step produced too much data.

5. **Output size caps.**
   Each step output is capped at 8KB serialized. If a compute step produces more, it hasn't aggregated enough.

### Skill Definition Checklist

When creating a new skill, answer these questions:

- [ ] What raw data do I need? (tables and filters)
- [ ] What aggregations reduce this to summaries? (group by, count, sum, avg)
- [ ] What's the top-N that needs per-item classification? (N ≤ 30)
- [ ] What categories should DeepSeek classify into? (use standard categories or define new ones)
- [ ] What strategic question does Claude answer? (one clear question, not "analyze everything")
- [ ] What tools does Claude need for follow-up? (limit to 2-3 tools, maxToolCalls ≤ 5)
- [ ] What's the output format? (Slack, markdown, structured JSON)
- [ ] Is the Claude input < 4K tokens? If not, go back to step 2.

### Standard Compute Aggregation Functions

Build these once, reuse across all skills:

```typescript
// These belong in server/analysis/aggregations.ts

// Aggregate deals by any field
aggregateDeals(deals, groupBy: 'stage' | 'owner' | 'pipeline' | 'forecast_category')
  → { [key: string]: { count: number, totalValue: number, avgValue: number, deals: Deal[] } }

// Bucket deals by a numeric threshold
bucketByThreshold(deals, field: 'days_in_stage' | 'days_since_activity' | 'health_score', thresholds: number[])
  → { [bucket: string]: { count: number, totalValue: number } }

// Get top N items by a field, with the rest summarized
topNWithSummary(items, n: number, sortBy: string, descending: boolean)
  → { topItems: Item[], remaining: { count: number, totalValue: number } }

// Compute period-over-period changes
periodComparison(current: Summary, previous: Summary)
  → { changes: { field: string, current: number, previous: number, delta: number, direction: 'up' | 'down' | 'flat' }[] }
```

---

## Example: Converting a Bad Skill to a Good Skill

### BAD: Pipeline Hygiene (before)

```
Step 1 (COMPUTE): Get pipeline summary → 500 tokens ✓
Step 2 (COMPUTE): Get deals by stage → 800 tokens ✓
Step 3 (COMPUTE): Get stale deals → 291 deals → 200,000 tokens ✗ EXPLOSION
Step 4 (COMPUTE): Get deals closing soon → 28 deals → 15,000 tokens ✗ TOO MUCH
Step 5 (COMPUTE): Get activity summary → 600 tokens ✓
Step 6 (CLAUDE): Analyze everything → receives 217,000 tokens ✗ CATASTROPHIC
```

Total: ~230K tokens. Cost: ~$3 per run. Most tokens wasted on raw data Claude doesn't need.

### GOOD: Pipeline Hygiene (after)

```
Step 1 (COMPUTE): Pipeline summary → 500 tokens
Step 2 (COMPUTE): Stage breakdown (aggregated) → 400 tokens
Step 3 (COMPUTE): Stale deals aggregated + top 20 → 1,500 tokens
Step 4 (COMPUTE): Closing soon aggregated + top 10 → 800 tokens
Step 5 (COMPUTE): Activity summary → 600 tokens
Step 6 (COMPUTE): Owner performance summary → 400 tokens
Step 7 (DEEPSEEK): Classify top 20 stale + top 10 closing → 2,000 tokens
Step 8 (CLAUDE): Synthesize with 2-3 tools available → 5,000 tokens
```

Total: ~11K tokens. Cost: ~$0.15 per run. 95% cost reduction. Better analysis because Claude works from structured findings.

---

## DeepSeek Prompt Templates

### Classification Template (reuse across skills)

```
You are a RevOps data analyst. Classify each deal below.

For each deal, determine:
1. root_cause: one of [rep_neglect, prospect_stalled, data_hygiene, process_gap, timing, competitive_loss, champion_change]
2. confidence: 0.0 to 1.0
3. signals: list of specific evidence supporting your classification
4. suggested_action: one concrete next step

Context:
- Company's stale threshold: {{staleDealDays}} days
- Average sales cycle: {{avgSalesCycleDays}} days

Deals to classify:
{{deals}}

Respond with ONLY a JSON object: { "classifications": [...] }
```

### Extraction Template (for call/transcript analysis)

```
You are a RevOps analyst reviewing sales call data.

Extract from these call summaries:
1. Key themes (max 5)
2. Critical signals (competitive mentions, budget concerns, timeline delays)
3. Action items mentioned but not yet tracked

Call summaries:
{{calls}}

Respond with ONLY a JSON object: { "themes": [...], "signals": [...], "actionItems": [...] }
```

---

## Claude Synthesis Prompt Template

```
You are a VP of Revenue Operations analyzing {{skillName}} for {{companyName}}.

BUSINESS CONTEXT:
{{businessContext}}

DATA SUMMARY (from automated analysis):
{{computeSummaries}}

ITEM CLASSIFICATIONS (from automated review):
{{deepseekClassifications}}

YOUR TASK:
{{specificQuestion}}

RULES:
- Lead with the most important finding
- Use specific deal names, dollar amounts, and rep names
- Every recommendation must be actionable this week
- If you need more data, use the available tools — don't guess
- Keep your response under 1,500 words

Available tools: {{toolList}}
```

---

**This guide should be read by anyone creating or modifying skills. When in doubt: compute more, classify in batches, and give Claude less.**
