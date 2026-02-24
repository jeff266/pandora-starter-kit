# Claude Code Prompt: Build Missing Chat Tools — 10 Tools, Prioritized

## Context

The Verification Report (`VERIFICATION_REPORT.md`) shows 19 of 33 MECE tools are 🟢 LIVE. 
13 are 🔴 MISSING (zero code). We're dropping 3 from spec (query_product_usage, compute_wallet_share, compute_attention_score — no data sources exist). That leaves **10 tools to build**.

All chat tools live in `server/chat/data-tools.ts` and are dispatched via `server/chat/pandora-agent.ts`.

**Before writing ANY code, read these files completely:**
1. `server/chat/data-tools.ts` — understand the existing tool pattern, how tools are defined, how they query the database, how they return results
2. `server/chat/pandora-agent.ts` — understand how tools are registered, how the agent selects and calls them
3. `server/skills/tool-definitions.ts` — the SKILL runtime tool registry (80+ tools). Some of the "missing" chat tools may already have implementations here that just need to be exposed as chat tools
4. `server/db.ts` — the database query function
5. `VERIFICATION_REPORT.md` — the gap analysis

**Critical pattern to follow:**
- Every tool must be registered in the chat tool system with: name, description, parameters schema, and execute function
- Every tool must accept `workspaceId` as a parameter (multi-tenant isolation)
- Every tool must return structured data that Claude can reason over
- Every tool must handle empty results gracefully (don't throw, return empty array with a message)
- SQL queries must be parameterized (no string interpolation)
- Add the tool to the agent's tool selection prompt so it knows when to use it

---

## Priority 1: Expose Existing Skill Logic as Chat Tools (3 tools, ~3 hours)

These tools ALREADY have implementations in the skill runtime (`server/skills/tool-definitions.ts`). 
The work is wrapping them for the chat tool interface.

### Tool 1: score_icp_fit (~1 hour)

**What exists:** ICP scoring runs as a skill (`icp-discovery`) and has produced 25 ICP profiles and 4,573 account scores. The scoring logic exists in the skill runtime. `account_scores` table has data.

**What to build:**
```typescript
// Chat tool: score_icp_fit
// Input: { deal_id?: string, account_id?: string, account_name?: string }
// Output: { score: number (0-100), breakdown: { firmographic, technographic, win_pattern }, icp_segment, evidence[] }

// Implementation approach:
// 1. Look up the account (from deal_id → account, or directly by account_id/name)
// 2. Query account_scores table for existing ICP score
// 3. If no score exists, query the account's attributes and compare against icp_profiles
// 4. Return score with breakdown showing which factors contributed
```

Search for:
- `account_scores` queries in skill runtime tools — find the function that reads/computes ICP scores
- `icp_profiles` queries — find how ICP profiles are compared against accounts
- Adapt into a chat tool that accepts deal_id OR account_id OR account_name

### Tool 2: compute_rep_conversions (~1 hour)

**What exists:** `deal_stage_history` has 4,175 rows. Stage transition data is available.

**What to build:**
```typescript
// Chat tool: compute_rep_conversions
// Input: { rep_email?: string, date_range?: string, pipeline?: string }
// Output: { 
//   stages: [{ from, to, rep_rate, team_rate, delta, rep_count, team_count }],
//   rep_summary: { total_deals, best_conversion_stage, worst_conversion_stage },
//   vs_team: 'above' | 'below' | 'on_par'
// }

// SQL approach:
// 1. Join deal_stage_history with deals to get owner_email
// 2. Count transitions from each stage to next stage, grouped by rep
// 3. Calculate conversion rate = advanced / (advanced + fell_back + fell_out)
// 4. Compare rep rates to team average
// 5. If rep_email provided, filter to that rep; otherwise return all reps
```

```sql
-- Core query pattern
WITH stage_transitions AS (
  SELECT 
    dsh.workspace_id,
    d.owner_email,
    dsh.from_stage,
    dsh.to_stage,
    CASE 
      WHEN dsh.to_stage_order > dsh.from_stage_order THEN 'advanced'
      WHEN dsh.to_stage_order < dsh.from_stage_order THEN 'regressed'
      ELSE 'lateral'
    END AS direction
  FROM deal_stage_history dsh
  JOIN deals d ON d.id = dsh.deal_id AND d.workspace_id = dsh.workspace_id
  WHERE dsh.workspace_id = $1
    AND dsh.changed_at >= $2  -- date range start
)
SELECT 
  owner_email,
  from_stage,
  COUNT(*) AS total_transitions,
  COUNT(*) FILTER (WHERE direction = 'advanced') AS advanced,
  COUNT(*) FILTER (WHERE direction = 'regressed') AS regressed,
  ROUND(COUNT(*) FILTER (WHERE direction = 'advanced')::numeric / NULLIF(COUNT(*), 0), 3) AS conversion_rate
FROM stage_transitions
GROUP BY owner_email, from_stage
ORDER BY owner_email, from_stage;
```

**NOTE:** Read the actual `deal_stage_history` schema first — column names may differ from what I've sketched above. Adapt the SQL to match real column names.

### Tool 3: compute_competitive_rates (~1 hour)

**What exists:** `conversations` table has data (calls with transcripts). Competitive mentions can be found via text search.

**What to build:**
```typescript
// Chat tool: compute_competitive_rates  
// Input: { competitor_name?: string, date_range?: string }
// Output: {
//   competitors: [{
//     name, mention_count, deals_with_mentions,
//     win_rate_when_present, loss_rate_when_present,
//     win_rate_without, avg_cycle_with, avg_cycle_without
//   }],
//   top_competitor: string,
//   most_dangerous: string (lowest win rate when present)
// }

// Implementation approach:
// 1. Search conversations for competitor mentions (text search on transcript/summary)
// 2. Join to deals via deal_id or account_id
// 3. For deals with competitor mentions: calculate win/loss rates
// 4. Compare to deals WITHOUT competitor mentions
// 5. If competitor_name provided, filter to that competitor; otherwise find all mentioned competitors
```

**Challenge:** There may not be a structured "competitor" field. This tool needs to:
- Search conversation text for competitor names
- If no competitor list exists, use the most common proper nouns in lost deal conversations as candidates
- Cross-reference with deal outcomes

Check if any skill (competitive-intelligence, conversation-intelligence) already extracts competitor names. If so, there may be a `competitors` or `account_signals` column you can query instead of doing full-text search every time.

---

## Priority 2: Pure SQL/Math Tools (4 tools, ~4 hours)

These need to be built from scratch but are straightforward SQL + math.

### Tool 4: compute_source_conversion (~1 hour)

```typescript
// Chat tool: compute_source_conversion
// Input: { date_range?: string, source?: string }
// Output: {
//   sources: [{
//     source, lead_count, opp_count, win_count,
//     lead_to_opp_rate, opp_to_win_rate, overall_rate,
//     avg_cycle_days, avg_deal_size
//   }],
//   best_source: string (highest win rate),
//   highest_volume: string,
//   best_roi: string (highest avg deal size × win rate)
// }

// SQL: Query deals grouped by lead_source (or equivalent field)
// Join with contacts for lead count if available
// Calculate conversion funnels per source
```

**First:** Check what field stores lead/deal source in the deals table. It might be `lead_source`, `source`, `deal_source`, or a custom field. Read the deals table schema.

### Tool 5: compute_shrink_rate (~30 min)

**Note:** This tool EXISTS but returns hardcoded 10% because `field_change_log` was missing. After Fix 4 from the Quick Fixes prompt creates and populates that table, this tool should work. 

**Verify:** Read `compute_shrink_rate` in `data-tools.ts`. If the `field_change_log` table now has data (from the quick fixes), test that this tool returns real values. If the fallback logic needs updating, adjust it. If it still doesn't work, check:
- Does the query column names match the actual `field_change_log` schema?
- Is the fallback catch block too aggressive (catching real errors as "no data")?

### Tool 6: compute_rep_conversions — already covered in Priority 1

### Tool 7: score_multithreading (~1.5 hours)

```typescript
// Chat tool: score_multithreading
// Input: { deal_id: string }
// Output: {
//   score: number (0-100),
//   contacts_total: number,
//   contacts_engaged: number (appeared on calls or had activities),
//   roles_covered: string[] (e.g., ['champion', 'economic_buyer', 'technical_evaluator']),
//   roles_missing: string[] (expected roles not found),
//   engagement_by_contact: [{
//     name, title, role, calls_attended, last_activity, engagement_level
//   }],
//   risk_factors: string[]
// }

// Implementation:
// 1. Query deal_contacts for all contacts on this deal
// 2. For each contact, query activities + conversations for engagement evidence
// 3. Check contact roles (if populated). If not populated, infer from titles:
//    - VP/C-level/Director with "Finance"/"Procurement" → economic_buyer
//    - "Manager"/"Director" with product-relevant title → champion candidate
//    - "Engineer"/"Architect"/"Developer" → technical_evaluator
//    - "Legal"/"Counsel" → legal
//    - "Procurement"/"Purchasing" → procurement
// 4. Score based on:
//    - Contact count (1 = 0pts, 2 = 20pts, 3+ = 30pts)
//    - Role diversity (each unique role = 15pts, max 45pts)
//    - Engagement recency (all contacts active in 14d = 25pts, declining from there)
// 5. Flag risk factors: "single-threaded", "no economic buyer", "champion not engaged recently"
```

### Tool 8: compute_source_conversion — already covered as Tool 4

---

## Priority 3: LLM-Powered Tools (3 tools, ~5 hours)

These require an LLM call as part of execution. Use DeepSeek (via Fireworks) for cost efficiency, consistent with the skill architecture.

### Tool 9: score_conversation_sentiment (~2 hours)

```typescript
// Chat tool: score_conversation_sentiment
// Input: { deal_id: string, last_n_calls?: number (default 3) }
// Output: {
//   score: number (-1.0 to 1.0),
//   trend: 'improving' | 'stable' | 'declining',
//   signals: { positive: string[], negative: string[], neutral: string[] },
//   red_flags: string[],
//   buying_signals: string[],
//   per_call: [{ call_id, date, sentiment, key_moments: string[] }]
// }

// Implementation:
// 1. Query last N conversations for this deal (join conversations on deal_id or account_id)
// 2. For each call, extract summary/transcript (use summary if available, truncated transcript if not)
// 3. Send to DeepSeek with classification prompt:
//    "Analyze these sales call summaries for deal sentiment.
//     For each call, classify:
//     - sentiment: positive/neutral/negative (with confidence)
//     - buying_signals: any statements indicating purchase intent
//     - red_flags: objections, delays, competitor mentions, budget concerns
//     - key_moments: the 2-3 most important exchanges
//     Return JSON."
// 4. Aggregate per-call results into deal-level score and trend
```

**LLM routing:** Find how skills call DeepSeek — likely through `server/llm/router.ts` or `server/llm/classify.ts`. Use the same routing for this tool. The chat tool should call the LLM, not expect the agent to do it.

**Token budget:** Keep input under 4K tokens per call. If transcripts are long, use summaries. If no summaries exist, truncate to first 2000 chars + last 1000 chars of transcript.

### Tool 10: detect_process_blockers (~1.5 hours)

```typescript
// Chat tool: detect_process_blockers
// Input: { deal_id: string }
// Output: {
//   blockers: [{
//     type: 'security_review' | 'legal' | 'procurement' | 'budget_approval' | 'technical_validation' | 'other',
//     evidence: string,
//     detected_from: 'crm_field' | 'call_transcript' | 'activity_pattern',
//     estimated_days?: number,
//     status: 'active' | 'cleared' | 'unknown'
//   }],
//   has_active_blockers: boolean,
//   estimated_total_delay_days: number
// }

// Implementation:
// 1. Check CRM fields: look for fields like 'next_steps', 'notes', custom fields with keywords
//    (security, legal, procurement, IT review, vendor assessment)
// 2. Check recent conversations: search for blocker-related terms in summaries
// 3. Check activity patterns: long gaps after late-stage advancement may indicate review process
// 4. If evidence found, send to DeepSeek for structured extraction:
//    "Given this deal context, identify procurement/approval blockers.
//     Classify each by type and estimate days to clear based on the evidence."
// 5. If no evidence of blockers, return empty array with has_active_blockers: false
```

### Tool 11: detect_buyer_signals (~1.5 hours)

```typescript
// Chat tool: detect_buyer_signals
// Input: { deal_id: string }
// Output: {
//   signals: [{
//     type: 'buyer_scheduled_followup' | 'rfp_received' | 'procurement_intro' | 
//            'security_review_started' | 'budget_allocated' | 'verbal_commitment' |
//            'reference_request' | 'contract_redline' | 'executive_sponsor_engaged',
//     evidence: string,
//     date: string,
//     confidence: number (0-1),
//     source: 'call' | 'email' | 'crm_field' | 'activity'
//   }],
//   signal_strength: 'strong' | 'moderate' | 'weak' | 'none',
//   strongest_signal: string | null
// }

// Implementation:
// 1. Query recent activities — look for inbound activity types (buyer sent email, 
//    buyer scheduled meeting vs. rep scheduled meeting)
// 2. Query conversations — search summaries for buyer commitment language
// 3. Check deal fields — procurement contact added, security questionnaire field populated,
//    legal review status
// 4. Send combined evidence to DeepSeek for signal classification
// 5. Return classified signals sorted by recency and confidence
```

---

## Registration Pattern

After building each tool, register it in the chat system. Follow the EXACT pattern of existing tools.

Read the existing tool registration in `pandora-agent.ts` or wherever tools are listed. Each tool needs:

1. **Tool definition** in the agent's tool list:
```typescript
{
  name: 'score_icp_fit',
  description: 'Get ICP fit score for an account or deal. Returns 0-100 score with firmographic/technographic/win pattern breakdown.',
  parameters: {
    type: 'object',
    properties: {
      deal_id: { type: 'string', description: 'Deal ID to score' },
      account_id: { type: 'string', description: 'Account ID to score' },
      account_name: { type: 'string', description: 'Account name to search for' }
    }
  }
}
```

2. **Dispatch handler** in the tool execution switch/map:
```typescript
case 'score_icp_fit':
  return await scoreIcpFit(workspaceId, params);
```

3. **Implementation function** in `data-tools.ts` (or a new file if data-tools.ts is getting too large — check its current size first. If over 2000 lines, create `server/chat/scoring-tools.ts` and `server/chat/analysis-tools.ts`).

---

## Testing Each Tool

After building each tool, test it by:

1. **Direct function call test:** Write a quick test that calls the function with a known workspace_id and real parameters. Check:
   - Does it return the expected shape?
   - Does it handle missing/null inputs gracefully?
   - Does it work for a deal/account/rep that exists in the database?
   - Does it return sensible empty results for a non-existent entity?

2. **SQL verification:** For each SQL query in the tool, run it directly against the database with sample parameters. Confirm it returns rows and the columns match what the code expects.

3. **For LLM tools:** Test with a real call transcript/summary to confirm the LLM prompt returns parseable JSON.

---

## Build Order Summary

| Order | Tool | Type | Effort | Unblocks |
|-------|------|------|--------|----------|
| 1 | score_icp_fit | Expose existing | 1 hr | "How does this account match our ICP?" in chat |
| 2 | compute_rep_conversions | SQL | 1 hr | "Where does this rep leak deals?" in chat |
| 3 | compute_competitive_rates | SQL + text search | 1 hr | "How do we do against [competitor]?" in chat |
| 4 | compute_source_conversion | SQL | 1 hr | "Which lead sources convert best?" in chat |
| 5 | score_multithreading | SQL + inference | 1.5 hr | "How well-threaded is this deal?" in chat |
| 6 | score_conversation_sentiment | LLM | 2 hr | "What's the sentiment trend on this deal?" in chat |
| 7 | detect_process_blockers | LLM | 1.5 hr | "What's blocking this deal from closing?" in chat |
| 8 | detect_buyer_signals | LLM | 1.5 hr | "Is the buyer showing real purchase intent?" in chat |

**Total: ~10.5 hours of implementation for 8 new tools.**

After this prompt completes, the chat tool coverage goes from 19/33 (58%) to 27/30 (90%) — we dropped 3 tools from spec, so the new denominator is 30.

---

## What NOT To Build (Confirmed Drops)

These 3 tools have no data source and no near-term path to one:
- `query_product_usage` — needs product telemetry connector (no integration planned)
- `compute_wallet_share` — needs account potential data (no data model)
- `compute_attention_score` — vague concept, covered adequately by activity_timeline

Also defer these 2 until external API integrations are prioritized:
- `check_stakeholder_status` — needs LinkedIn API (costs, rate limits, TBD)
- `enrich_market_signals` — needs News API (Serper exists but not wired for market signals)

These 2 deferred tools can be built later as enrichment pipeline items. They're nice-to-have for Deal Scoring Model accuracy but not blocking anything critical.

---

## Completion Report

After building all tools, produce a summary:

```
| Tool | Status | Registered | Tested | Notes |
|------|--------|-----------|--------|-------|
| score_icp_fit | ✅ | ✅ | ✅ | |
| compute_rep_conversions | ✅ | ✅ | ✅ | |
| ... | | | | |
```

And update the count: "Chat tools: X/30 live (Y%)"
