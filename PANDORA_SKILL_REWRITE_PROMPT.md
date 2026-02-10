# Rewritten Pipeline Hygiene Skill
## Claude Code Prompt — Replace existing pipeline-hygiene.ts

```
Read server/skills/library/pipeline-hygiene.ts (the current version) and 
PANDORA_SKILL_DESIGN_GUIDE.md (the new pattern all skills must follow).

Rewrite pipeline-hygiene to follow the three-phase pattern: COMPUTE → CLASSIFY → SYNTHESIZE.

The current skill sends raw deal arrays to Claude, which blew up to 200K+ tokens 
with real client data (291 stale deals). The fix is architectural, not truncation.

## Changes to Make

### 1. New aggregation utility: server/analysis/aggregations.ts

Create this shared module that all skills will use:

```typescript
// Group items by a field and compute stats per group
export function aggregateBy<T>(
  items: T[], 
  groupBy: (item: T) => string,
  valueOf: (item: T) => number
): Record<string, { count: number; totalValue: number; avgValue: number }>;

// Bucket items by numeric thresholds
// Example: bucketByThreshold(deals, d => d.days_since_activity, [7, 14, 30])
// Returns: { "0-7": { count, value }, "7-14": { count, value }, "14-30": { count, value }, "30+": { count, value } }
export function bucketByThreshold<T>(
  items: T[],
  valueOf: (item: T) => number,
  amountOf: (item: T) => number,
  thresholds: number[],
  labels?: string[]
): Record<string, { count: number; totalValue: number }>;

// Get top N items sorted by a field, with a summary of the rest
export function topNWithSummary<T>(
  items: T[],
  n: number,
  sortBy: (item: T) => number,
  descending?: boolean  // default true
): { topItems: T[]; remaining: { count: number; totalValue?: number } };

// Summarize a set of deals into a compact object for LLM consumption
// This is the standard "deal summary" shape that compute steps should produce
export function summarizeDeals(deals: any[]): {
  total: number;
  totalValue: number;
  avgValue: number;
  medianValue: number;
  byStage: Record<string, { count: number; value: number }>;
  byOwner: Record<string, { count: number; value: number }>;
};
```

### 2. Rewrite pipeline-hygiene.ts

The skill should have 8 steps, not 6:

STEP 1: gather-pipeline-summary (COMPUTE)
  - Call getPipelineSummary(workspaceId)
  - Output: { totalValue, dealCount, avgDealSize, coverage (vs quota from context) }
  - Expected size: ~300 tokens

STEP 2: gather-stage-breakdown (COMPUTE)
  - Call getDealsByStage(workspaceId)
  - Use aggregateBy() to produce { stage: { count, value, avgValue } }
  - Output: object with one key per stage
  - Expected size: ~400 tokens

STEP 3: aggregate-stale-deals (COMPUTE)
  - Call getStaleDeals(workspaceId, staleDaysThreshold from context)
  - Do NOT pass raw deals downstream
  - Use summarizeDeals() for the full set → summary object
  - Use bucketByThreshold() with thresholds [7, 14, 30] → severity buckets
  - Use aggregateBy(owner) → per-rep stale count
  - Use topNWithSummary(20, sortBy amount) → top 20 deals for classification
  - Output: {
      summary: { total, totalValue, avgDaysStale },
      bySeverity: { critical: {...}, warning: {...}, watch: {...} },
      byOwner: { "rep name": { count, value } },
      byStage: { stage: { count, value } },
      topDeals: [ ...20 items with: name, amount, stage, daysStale, owner, 
                   lastActivityType, contactCount ],
      remaining: { count, totalValue }
    }
  - Expected size: ~1,500 tokens

STEP 4: aggregate-closing-soon (COMPUTE)
  - Call getDealsClosingInRange(workspaceId, today, today + 30 days)
  - Use summarizeDeals() for summary
  - Use topNWithSummary(10, sortBy amount) → top 10 for classification
  - Output: {
      summary: { total, totalValue },
      byStage: { stage: { count, value } },
      topDeals: [ ...10 items ],
      remaining: { count, totalValue }
    }
  - Expected size: ~800 tokens

STEP 5: gather-activity-summary (COMPUTE)
  - Call getActivitySummary(workspaceId, last 7 days)
  - Output: { byType: { email: N, call: N, meeting: N }, byOwner: {...}, 
              totalActivities, activeDealCount, inactiveDealCount }
  - Expected size: ~500 tokens

STEP 6: gather-owner-performance (COMPUTE)
  - Cross-reference: for each deal owner, compute:
    - Number of open deals
    - Total pipeline value
    - Number of stale deals
    - Activity count (last 7 days)
    - Stale rate (stale deals / open deals)
  - Output: per-owner summary sorted by stale rate descending
  - Expected size: ~400 tokens

STEP 7: classify-at-risk-deals (DEEPSEEK)
  - depends_on: [aggregate-stale-deals, aggregate-closing-soon]
  - Input: topDeals from stale (20) + topDeals from closing soon (10) = up to 30 deals
  - Deduplicate (a deal can be both stale AND closing soon)
  - Prompt: classify each deal's root cause from standard categories:
    [rep_neglect, prospect_stalled, data_hygiene, process_gap, timing, 
     competitive_loss, champion_change]
  - Include business context: stale threshold, avg sales cycle
  - Output schema (enforce JSON):
    { classifications: [{ dealName, amount, rootCause, confidence, signals, suggestedAction }] }
  - Expected size: ~1,500 tokens input, ~1,500 tokens output

STEP 8: synthesize-hygiene-report (CLAUDE)
  - depends_on: ALL previous steps
  - System prompt: "You are a VP of Revenue Operations..."
  - Input context (assembled from all step outputs):
    - Business context from context layer (~300 tokens)
    - Pipeline summary from step 1 (~300 tokens)
    - Stage breakdown from step 2 (~400 tokens)
    - Stale deals summary from step 3 — SUMMARY ONLY, not topDeals (~500 tokens)
    - Closing soon summary from step 4 — SUMMARY ONLY (~300 tokens)
    - Activity summary from step 5 (~500 tokens)
    - Owner performance from step 6 (~400 tokens)
    - DeepSeek classifications from step 7 (~1,500 tokens)
  - Total input: ~4,200 tokens ✓ (under 5K target)
  - Claude prompt:
    """
    Analyze this pipeline health data and produce a Pipeline Hygiene Report.
    
    Cover these sections:
    1. PIPELINE HEALTH: coverage status, total value, trajectory
    2. STALE DEAL CRISIS: severity breakdown, root cause patterns from classifications, 
       which reps need intervention
    3. CLOSING THIS MONTH: readiness assessment, which deals are at risk of slipping
    4. REP PERFORMANCE: who's executing well, who needs coaching, activity patterns
    5. TOP 3 ACTIONS: specific, named, actionable this week. Include deal names and rep names.
    
    Be direct. Use numbers. Name names. No generic advice.
    
    If you need to check specific deal details or activity timelines, use the available tools.
    But prefer the pre-analyzed data — only use tools to verify or drill into something specific.
    """
  - Tools available: queryDeals, getActivityTimeline (maxToolCalls: 3)
  - Expected output: ~2,000 tokens

TOTAL SKILL TOKEN BUDGET: ~10K tokens (vs 230K+ before)

### 3. Update deal-risk-review.ts and weekly-recap.ts

Apply the same pattern:

**deal-risk-review.ts:**
- Step 1 (COMPUTE): Get open deals, aggregate by risk factors
- Step 2 (COMPUTE): Get activity timelines for top deals, compute recency scores
- Step 3 (COMPUTE): Get stakeholder maps, compute threading scores
- Step 4 (DEEPSEEK): Extract call signals from recent transcripts (per deal)
- Step 5 (CLAUDE): Synthesize risk assessment from summaries + classifications

**weekly-recap.ts:**
- Step 1 (COMPUTE): Activity summary for the week
- Step 2 (COMPUTE): Pipeline changes (new, won, lost, current state — all aggregated)
- Step 3 (COMPUTE): Conversation stats (count, total duration, participants)
- Step 4 (DEEPSEEK): Summarize call themes and extract critical signals from transcripts
- Step 5 (CLAUDE): Write VP-ready recap from summaries + call themes

### 4. Add validation to SkillRuntime

In the runtime's step execution logic, add these checks:

Before passing data to a CLAUDE step:
- Serialize the input context
- If serialized size > 8,000 tokens (estimate: 4 chars per token), log a WARNING
- If serialized size > 20,000 tokens, ABORT with error:
  "Claude step '{stepId}' input exceeds 20K token limit ({actualTokens} estimated). 
   Add more compute aggregation steps to reduce data volume."

Before passing data to a DEEPSEEK step:
- Count items in any arrays in the input
- If any array > 30 items, ABORT with error:
  "DeepSeek step '{stepId}' receives array with {N} items (max 30).
   Add a compute step to filter/rank before classification."

These are guardrails that prevent the 200K token problem from ever happening again,
regardless of which skill is running.

### 5. Do NOT change

- types.ts (the type system is fine)
- tool-definitions.ts (tools don't change)
- registry.ts (registration pattern is fine)
- formatters/ (output formatting is separate from data flow)
- webhook.ts (webhook handlers don't change)
- runtime.ts tool_use loop (the Claude interaction pattern is correct, 
  only the input size validation is new)
```
