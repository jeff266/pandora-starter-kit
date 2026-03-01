# URGENT: Three Patches to Fix Ask Pandora UX

These three patches are independent and can be run in parallel. All three are critical — the assistant is currently alarmist, preachy, and refuses to answer simple data questions.

---

## Patch 1: Greeting Severity Filter

### Problem
The greeting shows raw finding counts: "34 critical findings. 74 warnings." This is 108 problems screaming at a CRO before they've asked anything. It's alarmist, unhelpful, and makes the product feel broken. Additionally, "THIS MORNING" appears even when the greeting says "Good evening."

### Files to Read First
- Wherever the greeting/briefing assembler lives — likely `server/briefing/greeting-engine.ts` or `server/briefing/brief-assembler.ts`
- The findings query that populates the greeting
- The component that renders the greeting on the Command Center page

### Changes

**1. Fix time-of-day consistency.** The "THIS MORNING" / "THIS AFTERNOON" / "TODAY" label must match the greeting's time-of-day. If greeting says "Good evening", the section header should say "TODAY" or "THIS EVENING" — never "THIS MORNING."

```typescript
// The label should derive from the same time-of-day logic as the greeting:
function getRecencyLabel(hour: number): string {
  if (hour < 12) return 'THIS MORNING';
  if (hour < 17) return 'THIS AFTERNOON';
  return 'TODAY';
}
```

**2. Filter findings for the greeting to leadership-relevant items only.** Don't dump every finding. The greeting should surface at most 3-5 findings, filtered by:

```typescript
// For the greeting briefing, filter findings to what leadership actually needs:
const greetingFindings = allFindings
  // Only 'act' severity — not 'watch', 'notable', or 'info'
  .filter(f => f.severity === 'act')
  // Deduplicate by category — don't show 15 stale deal findings, show 1 summary
  .reduce((acc, f) => {
    const existing = acc.find(a => a.category === f.category);
    if (existing) {
      existing.count = (existing.count || 1) + 1;
      existing.total_amount = (existing.total_amount || 0) + (f.deal_amount || 0);
    } else {
      acc.push({ ...f, count: 1, total_amount: f.deal_amount || 0 });
    }
    return acc;
  }, [])
  // Sort by dollar impact
  .sort((a, b) => (b.total_amount || 0) - (a.total_amount || 0))
  // Cap at 5
  .slice(0, 5);
```

**3. Rewrite the greeting tagline.** Replace the raw count format with a calm, informative summary.

Current: `Pipeline at $2.2M across 80 deals. 34 critical findings. 74 warnings.`

Replace with pipeline broken down by pipeline name (since the data exists in `deals.pipeline`):

```typescript
// Build tagline from actual pipeline data:
const pipelineSummary = await query(`
  SELECT pipeline, COUNT(*) as deal_count, COALESCE(SUM(amount), 0) as total
  FROM deals
  WHERE workspace_id = $1
    AND stage NOT IN (SELECT stage_name FROM stage_configs WHERE workspace_id = $1 AND (is_won = true OR is_lost = true))
  GROUP BY pipeline
  ORDER BY total DESC
`, [workspaceId]);

// Format: "Pipeline at $2.2M — Core Sales $1.6M (52 deals), Renewals $420K (21), Expansion $180K (7)"
const parts = pipelineSummary.rows.map(r => 
  `${r.pipeline} $${formatCompact(r.total)} (${r.deal_count})`
);
const total = pipelineSummary.rows.reduce((sum, r) => sum + parseFloat(r.total), 0);
const tagline = `Pipeline at $${formatCompact(total)} — ${parts.join(', ')}`;

// For findings, only mention if there are 'act' severity items:
const actCount = greetingFindings.length;
const findingsSuffix = actCount > 0 
  ? `. ${actCount} item${actCount > 1 ? 's' : ''} need${actCount === 1 ? 's' : ''} attention.`
  : '';

// Final: "Pipeline at $2.2M — Core Sales $1.6M (52), Renewals $420K (21), Expansion $180K (7). 3 items need attention."
```

**4. If findings count is zero after filtering, show a positive message:**

```
"No urgent items. Your operators last ran 2 hours ago."
```

NOT: "No recent findings." (which sounds like nothing is working)

### Acceptance Criteria
- Greeting at 7pm says "Good evening" with "TODAY" section header, never "THIS MORNING"
- Tagline shows pipeline broken down by pipeline name with deal counts
- Finding count in tagline only shows 'act' severity, deduplicated by category, capped at 5
- "34 critical findings. 74 warnings" NEVER appears in the greeting

---

## Patch 2: Tier 0 — Direct Data Query Path

### Problem
"How much pipeline in Core Sales?" and "Break down pipeline by record types" are SQL queries. They should return a number or a table in under 2 seconds with zero AI. Instead, the system routes them through skills → investigation → synthesis, which either fails (missing quotas) or produces a 400-word essay.

### Files to Read First
- `server/investigation/complexity-gate.ts` — you're adding Tier 0 above Tier 1
- `server/chat/orchestrator.ts` or `server/routes/conversation-stream.ts` — wherever the gate result is consumed
- `server/db/` — understand the deals table schema, especially: `deals.pipeline`, `deals.stage`, `deals.amount`, `deals.owner_email`, `deals.custom_fields`, `deals.close_date`
- `stage_configs` table — to identify won/lost stages

### Changes

**1. Add Tier 0 to the complexity gate.**

In `server/investigation/complexity-gate.ts`, add a new tier at the very top of `classifyComplexity()`, before any other checks:

```typescript
export type QuestionComplexity = 'data_query' | 'lookup' | 'focused' | 'investigation';

// At the TOP of classifyComplexity(), before all other patterns:

// ─── TIER 0: Direct data queries ───
// These are questions that can be answered with a SQL query. No skills, no AI synthesis.
// "How much pipeline in Core Sales?" → SELECT SUM(amount)
// "Break down pipeline by record type" → SELECT record_type, SUM(amount) GROUP BY
// "How many deals in proposal?" → SELECT COUNT(*)
// "List deals over $100K" → SELECT * WHERE amount > 100000
// "What's our average deal size?" → SELECT AVG(amount)

const dataQueryPatterns = [
  // "How much/many [metric] in/by/for [filter]?"
  /^how (much|many)\s+(pipeline|revenue|deals?|opportunities?|arr)\b/i,
  // "Break down / breakdown [metric] by [dimension]"
  /\b(break\s*down|breakdown|split|segment)\b.+\b(by|per|across)\b/i,
  // "Total pipeline/revenue/deals in/for [filter]"
  /^(total|sum|count)\s+(pipeline|revenue|deals?|opportunities?)\b/i,
  // "List/show deals [filter]" — without analytical intent
  /^(list|show|give me|pull)\s+(all\s+)?(the\s+)?(open\s+)?(deals?|opportunities?)\b/i,
  // "What's the average deal size / cycle time"
  /\b(average|avg|mean|median)\s+(deal\s+size|deal\s+value|cycle|amount)\b/i,
  // "How many deals in [stage]"
  /how many\s+(deals?|opportunities?|opps?)\s+(in|at)\s+/i,
  // "Pipeline by [dimension]" — short, direct
  /^pipeline\s+(by|per|across)\s+/i,
  // "What's in [pipeline name]?" / "What do we have in [pipeline]?"
  /\b(what('?s| is| do we have))\s+in\s+/i,
];

// Negative patterns that look like data queries but are actually analytical
const notDataQuery = [
  /\bwhy\b/i,
  /\bshould\b/i,
  /\bhealthy\b/i,
  /\bon track\b/i,
  /\bcompare\b.*\b(to|with|against)\b/i,
  /\btrend\b/i,
  /\bchanged?\b/i,
  /\bimprove\b/i,
  /\brisk\b/i,
  /\bforecast\b/i,
];

const isDataQuery = dataQueryPatterns.some(p => p.test(lower));
const isAnalytical = notDataQuery.some(p => p.test(lower));

if (isDataQuery && !isAnalytical) {
  return {
    tier: 'data_query',
    primary_skill: null,  // No skill needed
    max_skills: 0,
    allow_fresh_runs: false,
    reasoning: 'Direct data query — SQL, no AI needed',
  };
}
```

**2. Create the data query executor.**

Create `server/investigation/data-query-executor.ts`:

```typescript
// server/investigation/data-query-executor.ts

/**
 * Translates natural language data questions into SQL queries against the deals table.
 * Returns structured data (numbers, tables) with NO AI synthesis.
 * 
 * This is Tier 0 — the fastest, cheapest path. Zero skills, zero LLM calls.
 * The only AI call is a small one to parse the user's intent into query parameters.
 */

interface DataQueryResult {
  type: 'single_value' | 'table' | 'list';
  title: string;
  
  // For single_value:
  value?: string;        // "$2.2M"
  subtitle?: string;     // "across 80 deals"
  
  // For table:
  columns?: string[];
  rows?: Record<string, any>[];
  
  // For list:
  items?: { label: string; value: string; detail?: string }[];
  
  // Always:
  footnote?: string;     // "Quota targets not configured — coverage ratios unavailable"
  query_ms: number;      // How long the SQL took
}

export async function executeDataQuery(
  workspaceId: string,
  message: string
): Promise<DataQueryResult> {
  const startTime = Date.now();
  const lower = message.toLowerCase();
  
  // Get workspace context: pipeline names, stage configs
  const pipelines = await query(
    `SELECT DISTINCT pipeline FROM deals WHERE workspace_id = $1 AND pipeline IS NOT NULL`,
    [workspaceId]
  );
  const pipelineNames = pipelines.rows.map(r => r.pipeline);
  
  const wonLostStages = await query(
    `SELECT stage_name, is_won, is_lost FROM stage_configs 
     WHERE workspace_id = $1 AND (is_won = true OR is_lost = true)`,
    [workspaceId]
  );
  const excludeStages = wonLostStages.rows.map(r => r.stage_name);
  
  // ── Pattern 1: "How much pipeline [in X]?" → SUM(amount) ──
  if (/how much\s+(pipeline|revenue)/i.test(lower)) {
    const pipelineFilter = detectPipelineFilter(lower, pipelineNames);
    const stageFilter = detectStageFilter(lower);
    
    const result = await query(`
      SELECT 
        COALESCE(SUM(amount), 0) as total,
        COUNT(*) as deal_count,
        COALESCE(AVG(amount), 0) as avg_deal
      FROM deals
      WHERE workspace_id = $1
        AND stage NOT IN (SELECT unnest($2::text[]))
        ${pipelineFilter.clause}
        ${stageFilter.clause}
    `, [workspaceId, excludeStages, ...pipelineFilter.params, ...stageFilter.params]);
    
    const row = result.rows[0];
    const filterLabel = pipelineFilter.label || 'all pipelines';
    
    return {
      type: 'single_value',
      title: `Pipeline — ${filterLabel}`,
      value: formatCurrency(row.total),
      subtitle: `across ${row.deal_count} deals (avg ${formatCurrency(row.avg_deal)})`,
      query_ms: Date.now() - startTime,
    };
  }
  
  // ── Pattern 2: "Break down by [dimension]" → GROUP BY ──
  if (/\b(break\s*down|breakdown|split|segment)\b/i.test(lower) || /^pipeline\s+(by|per)/i.test(lower)) {
    const dimension = detectDimension(lower);
    
    let groupByColumn: string;
    let groupByLabel: string;
    
    switch (dimension) {
      case 'record_type':
        // Try custom_fields->>'record_type_name' first (Salesforce), 
        // then custom_fields->>'dealtype' (HubSpot)
        groupByColumn = `COALESCE(
          custom_fields->>'record_type_name',
          custom_fields->>'dealtype',
          'Unspecified'
        )`;
        groupByLabel = 'Record Type';
        break;
      case 'pipeline':
        groupByColumn = `COALESCE(pipeline, 'Default')`;
        groupByLabel = 'Pipeline';
        break;
      case 'stage':
        groupByColumn = 'stage';
        groupByLabel = 'Stage';
        break;
      case 'owner':
        groupByColumn = `COALESCE(owner_name, owner_email, 'Unassigned')`;
        groupByLabel = 'Owner';
        break;
      case 'close_month':
        groupByColumn = `TO_CHAR(close_date, 'YYYY-MM')`;
        groupByLabel = 'Close Month';
        break;
      default:
        groupByColumn = `COALESCE(pipeline, 'Default')`;
        groupByLabel = 'Pipeline';
    }
    
    const result = await query(`
      SELECT 
        ${groupByColumn} as dimension,
        COUNT(*) as deals,
        COALESCE(SUM(amount), 0) as total,
        COALESCE(AVG(amount), 0) as avg_deal
      FROM deals
      WHERE workspace_id = $1
        AND stage NOT IN (SELECT unnest($2::text[]))
      GROUP BY ${groupByColumn}
      ORDER BY total DESC
    `, [workspaceId, excludeStages]);
    
    const grandTotal = result.rows.reduce((sum, r) => sum + parseFloat(r.total), 0);
    
    return {
      type: 'table',
      title: `Pipeline by ${groupByLabel}`,
      columns: [groupByLabel, 'Deals', 'Amount', 'Avg Deal', '% of Total'],
      rows: result.rows.map(r => ({
        [groupByLabel]: r.dimension,
        'Deals': r.deals,
        'Amount': formatCurrency(r.total),
        'Avg Deal': formatCurrency(r.avg_deal),
        '% of Total': `${((parseFloat(r.total) / grandTotal) * 100).toFixed(1)}%`,
      })),
      query_ms: Date.now() - startTime,
    };
  }
  
  // ── Pattern 3: "How many deals [in stage/pipeline]?" → COUNT ──
  if (/how many\s+(deals?|opportunities?|opps?)/i.test(lower)) {
    const pipelineFilter = detectPipelineFilter(lower, pipelineNames);
    const stageFilter = detectStageFilter(lower);
    
    const result = await query(`
      SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
      FROM deals
      WHERE workspace_id = $1
        AND stage NOT IN (SELECT unnest($2::text[]))
        ${pipelineFilter.clause}
        ${stageFilter.clause}
    `, [workspaceId, excludeStages, ...pipelineFilter.params, ...stageFilter.params]);
    
    const row = result.rows[0];
    
    return {
      type: 'single_value',
      title: 'Deal Count',
      value: row.count.toString(),
      subtitle: `totaling ${formatCurrency(row.total)}`,
      query_ms: Date.now() - startTime,
    };
  }
  
  // ── Pattern 4: "Average deal size" → AVG ──
  if (/\b(average|avg)\s+(deal|opportunity)\s*(size|value|amount)?/i.test(lower)) {
    const pipelineFilter = detectPipelineFilter(lower, pipelineNames);
    
    const result = await query(`
      SELECT 
        COALESCE(AVG(amount), 0) as avg_amount,
        COUNT(*) as deal_count,
        COALESCE(MIN(amount), 0) as min_amount,
        COALESCE(MAX(amount), 0) as max_amount
      FROM deals
      WHERE workspace_id = $1
        AND stage NOT IN (SELECT unnest($2::text[]))
        AND amount > 0
        ${pipelineFilter.clause}
    `, [workspaceId, excludeStages, ...pipelineFilter.params]);
    
    const row = result.rows[0];
    
    return {
      type: 'single_value',
      title: 'Average Deal Size',
      value: formatCurrency(row.avg_amount),
      subtitle: `across ${row.deal_count} deals (range: ${formatCurrency(row.min_amount)} — ${formatCurrency(row.max_amount)})`,
      query_ms: Date.now() - startTime,
    };
  }
  
  // ── Pattern 5: "List deals [filter]" → SELECT with filters ──
  if (/^(list|show|give me|pull)\s+(all\s+)?(the\s+)?(open\s+)?(deals?|opportunities?)/i.test(lower)) {
    const pipelineFilter = detectPipelineFilter(lower, pipelineNames);
    const stageFilter = detectStageFilter(lower);
    const amountFilter = detectAmountFilter(lower);
    
    const result = await query(`
      SELECT 
        name as deal_name,
        COALESCE(owner_name, owner_email) as owner,
        stage,
        amount,
        close_date,
        pipeline
      FROM deals
      WHERE workspace_id = $1
        AND stage NOT IN (SELECT unnest($2::text[]))
        ${pipelineFilter.clause}
        ${stageFilter.clause}
        ${amountFilter.clause}
      ORDER BY amount DESC
      LIMIT 25
    `, [workspaceId, excludeStages, ...pipelineFilter.params, ...stageFilter.params, ...amountFilter.params]);
    
    return {
      type: 'table',
      title: `Open Deals`,
      columns: ['Deal', 'Owner', 'Stage', 'Amount', 'Close Date', 'Pipeline'],
      rows: result.rows.map(r => ({
        'Deal': r.deal_name,
        'Owner': r.owner,
        'Stage': r.stage,
        'Amount': formatCurrency(r.amount),
        'Close Date': r.close_date ? new Date(r.close_date).toLocaleDateString() : '—',
        'Pipeline': r.pipeline,
      })),
      footnote: result.rows.length === 25 ? 'Showing top 25 by amount' : undefined,
      query_ms: Date.now() - startTime,
    };
  }
  
  // ── Fallback: Can't parse as data query, return null to let next tier handle it ──
  return null;
}

// ═══════════════════════════════════════════
// Helper: Detect pipeline name filter from natural language
// ═══════════════════════════════════════════
function detectPipelineFilter(
  lower: string,
  pipelineNames: string[]
): { clause: string; params: any[]; label: string | null } {
  // Check if any pipeline name appears in the question
  for (const name of pipelineNames) {
    if (lower.includes(name.toLowerCase())) {
      return {
        clause: `AND pipeline = $3`,
        params: [name],
        label: name,
      };
    }
  }
  // Check for partial matches: "core sales" matches "Core Sales Pipeline"
  for (const name of pipelineNames) {
    const nameLower = name.toLowerCase();
    const words = nameLower.split(/\s+/);
    // If 2+ words from the pipeline name appear in the question
    const matchCount = words.filter(w => w.length > 3 && lower.includes(w)).length;
    if (matchCount >= 2 || (words.length === 1 && lower.includes(nameLower))) {
      return {
        clause: `AND pipeline = $3`,
        params: [name],
        label: name,
      };
    }
  }
  return { clause: '', params: [], label: null };
}

// ═══════════════════════════════════════════
// Helper: Detect stage filter
// ═══════════════════════════════════════════
function detectStageFilter(lower: string): { clause: string; params: any[] } {
  // Common stage names — match against the question
  const stagePatterns = [
    { pattern: /\b(proposal|proposing)\b/i, stage: 'Proposal' },
    { pattern: /\b(discovery|disco)\b/i, stage: 'Discovery' },
    { pattern: /\b(negotiat|negoti)\b/i, stage: 'Negotiation' },
    { pattern: /\b(closed? won|won)\b/i, stage: 'Closed Won' },
    { pattern: /\b(qualification|qualified)\b/i, stage: 'Qualification' },
    { pattern: /\b(demo)\b/i, stage: 'Demo' },
    { pattern: /\b(evaluation)\b/i, stage: 'Evaluation' },
  ];
  
  for (const { pattern, stage } of stagePatterns) {
    if (pattern.test(lower)) {
      return { clause: `AND stage ILIKE $${4}`, params: [`%${stage}%`] };
    }
  }
  return { clause: '', params: [] };
}

// ═══════════════════════════════════════════
// Helper: Detect amount filter ("over $100K", "above $50K")
// ═══════════════════════════════════════════
function detectAmountFilter(lower: string): { clause: string; params: any[] } {
  const match = lower.match(/\b(over|above|more than|greater than|>\s*)\$?([\d,.]+)\s*(k|m|million|thousand)?/i);
  if (match) {
    let amount = parseFloat(match[2].replace(/,/g, ''));
    const unit = (match[3] || '').toLowerCase();
    if (unit === 'k' || unit === 'thousand') amount *= 1000;
    if (unit === 'm' || unit === 'million') amount *= 1000000;
    return { clause: `AND amount >= $${5}`, params: [amount] };
  }
  
  const matchUnder = lower.match(/\b(under|below|less than|<\s*)\$?([\d,.]+)\s*(k|m|million|thousand)?/i);
  if (matchUnder) {
    let amount = parseFloat(matchUnder[2].replace(/,/g, ''));
    const unit = (matchUnder[3] || '').toLowerCase();
    if (unit === 'k' || unit === 'thousand') amount *= 1000;
    if (unit === 'm' || unit === 'million') amount *= 1000000;
    return { clause: `AND amount <= $${5}`, params: [amount] };
  }
  
  return { clause: '', params: [] };
}

// ═══════════════════════════════════════════
// Helper: Detect GROUP BY dimension
// ═══════════════════════════════════════════
function detectDimension(lower: string): string {
  if (/\b(record\s*type|deal\s*type|type)\b/i.test(lower)) return 'record_type';
  if (/\b(pipeline)\b/i.test(lower)) return 'pipeline';
  if (/\b(stage)\b/i.test(lower)) return 'stage';
  if (/\b(owner|rep|sales\s*rep|assigned)\b/i.test(lower)) return 'owner';
  if (/\b(month|quarter|close\s*date)\b/i.test(lower)) return 'close_month';
  // Default to pipeline if no dimension detected
  return 'pipeline';
}

// ═══════════════════════════════════════════
// Formatting
// ═══════════════════════════════════════════
function formatCurrency(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (num >= 1000000) return `$${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `$${(num / 1000).toFixed(0)}K`;
  return `$${num.toFixed(0)}`;
}
```

**3. Wire Tier 0 into the orchestrator.**

Find where the complexity gate result is consumed (orchestrator or conversation-stream handler) and add the Tier 0 path:

```typescript
switch (complexity.tier) {
  case 'data_query': {
    // Tier 0: Pure SQL, no AI, no skills
    const dataResult = await executeDataQuery(workspaceId, message);
    
    if (dataResult) {
      // Format for the chat response
      let responseText = '';
      
      if (dataResult.type === 'single_value') {
        responseText = `**${dataResult.title}**\n\n${dataResult.value}`;
        if (dataResult.subtitle) responseText += `\n${dataResult.subtitle}`;
      } 
      else if (dataResult.type === 'table') {
        responseText = `**${dataResult.title}**\n\n`;
        // Format as markdown table
        const cols = dataResult.columns;
        responseText += `| ${cols.join(' | ')} |\n`;
        responseText += `| ${cols.map(() => '---').join(' | ')} |\n`;
        for (const row of dataResult.rows) {
          responseText += `| ${cols.map(c => row[c] || '—').join(' | ')} |\n`;
        }
      }
      
      if (dataResult.footnote) {
        responseText += `\n_${dataResult.footnote}_`;
      }
      
      responseText += `\n\n_(${dataResult.query_ms}ms)_`;
      
      // For SSE streaming, send as a single complete message:
      // (No agent recruitment, no synthesis streaming — just the answer)
      send({ type: 'synthesis_start' });
      send({ type: 'synthesis_chunk', text: responseText });
      send({ type: 'synthesis_done' });
      send({ type: 'done' });
      
      return;
    }
    
    // If executeDataQuery returned null (couldn't parse), fall through to Tier 1
    // Fall through intentionally
  }
  
  case 'lookup': {
    // ... existing Tier 1 logic
  }
  // ... etc
}
```

**4. Handle Tier 0 in the UI.** The frontend needs to handle a response that has NO agent recruitment events — just immediate synthesis. Check that the conversation UI doesn't break or show empty operator cards when no `recruiting` or `agent_thinking` events arrive.

### Acceptance Criteria
- "How much pipeline in Core Sales?" → "$1.6M across 52 deals" in <2 seconds, NO AI
- "Break down pipeline by record type" → table with record types, amounts, percentages, NO AI
- "How many deals in proposal?" → count + total, NO AI  
- "List deals over $100K" → table of matching deals, NO AI
- "Average deal size" → number with range, NO AI
- "Why is pipeline down?" → still routes to Tier 3 investigation (negative guard works)
- "How much pipeline do we need to hit quota?" → still routes to Tier 2+ (analytical question)
- Query time logged as `_(Xms)_` at bottom of response
- No operator recruitment animation for Tier 0 responses
- If query can't be parsed → falls through to Tier 1 gracefully, doesn't error

---

## Patch 3: Tone Reset for Synthesis Prompts

### Problem
The synthesis prompt produces condescending, alarmist, preachy responses. Examples from production:

- "That should terrify you."
- "You're flying blind."
- "every pipeline report is just vanity metrics"
- "you're asking me to analyze a building when the blueprints are missing"
- "This is a data infrastructure problem masquerading as a reporting question"

This tone is unacceptable. A CRO doesn't need a lecture. They need answers.

### Files to Read
Find EVERY file that contains a Claude synthesis prompt. This includes but is not limited to:
- `server/investigation/synthesizer.ts`
- `server/investigation/single-skill-synthesis.ts` (if it exists)
- `server/chat/orchestrator.ts` (may have inline prompts)
- `server/agents/runtime.ts` (may have synthesis prompts)
- `server/skills/runtime.ts` (may have per-skill synthesis)
- Any file matching: `grep -r "You are Pandora" server/`
- Any file matching: `grep -r "SYNTHESIS RULES" server/`
- Any file matching: `grep -r "VOICE:" server/`
- Any file matching: `grep -r "system prompt" server/`

### Changes

**1. Replace ALL synthesis prompt voice/rules sections** with this standard block. Every synthesis prompt in the codebase must use this voice:

```
VOICE AND TONE — MANDATORY:
- Answer the question first. Data before commentary.
- Be direct, specific, and calm. Never alarmist, never preachy.
- Report what the data shows. If data is missing, say what's missing and move on.
- Never say "that should terrify you", "you're flying blind", "this is a crisis", 
  or any language designed to create urgency or fear.
- Never lecture the user about data hygiene, system configuration, or process gaps 
  unless they specifically asked about those topics.
- Never withhold data because context is incomplete. Show what you have.
- Never assign homework with deadlines unless the user asked "what should we do."
- Missing quotas/goals means you can't show ratios — it does NOT mean you can't 
  show the raw numbers. Always show the raw numbers.
- If something is genuinely urgent (deal about to close, renewal at risk), state 
  the fact calmly. Don't add emotional language.
- Treat the user as a competent professional who can draw their own conclusions 
  from well-presented data.
- Short answers are better than long ones. A table is better than three paragraphs 
  saying the same thing.
```

**2. Remove or replace these specific anti-patterns** wherever they appear in any prompt:

```
REMOVE: "Never refuse to answer because goals are missing" 
  → This was a patch fix. Replace with the positive framing above.

REMOVE: "answer the question directly against the goal"
  → Replace with: "answer the question directly. Add goal context if available."

REMOVE: "Every number should be relative to a goal"
  → Replace with: "Add goal context when available. Never withhold a number because 
    goal context is missing."

REMOVE: "Start with THE NUMBER"
  → Replace with: "Lead with the answer to the question."

REMOVE: any reference to "CRITICAL:" anti-refusal instructions
  → The positive voice rules above make these unnecessary.
```

**3. Add a maximum word budget to ALL synthesis prompts:**

```
RESPONSE LENGTH:
- Tier 1 (lookup): 50-100 words max. Just the answer.
- Tier 2 (focused): 100-250 words. Answer + key context.
- Tier 3 (investigation): 250-500 words. Answer + investigation chain + recommendations.
- Never exceed 500 words in any response. If you need more space, offer to go deeper.
```

Pass the tier as a variable in the synthesis prompt so Claude knows the budget:

```typescript
const wordBudget = {
  lookup: '50-100 words. Just answer the question.',
  focused: '100-250 words. Answer plus key context.',
  investigation: '250-500 words. Answer, investigation summary, and 3-5 actions.',
}[tier];

// In prompt:
`RESPONSE LENGTH: ${wordBudget}`
```

**4. Remove "Investigation" from Tier 1/2 response titles.**

The current system titles responses "Weighted Forecast Investigation Summary" or "Core Sales Pipeline Investigation" even for simple questions. The word "Investigation" should only appear in Tier 3 responses.

Find where the response title is generated and make it tier-aware:

```typescript
// Tier 0: No title needed (data result has its own title)
// Tier 1: Use the metric name: "Weighted Forecast", "Pipeline Summary"
// Tier 2: Use the topic: "Pipeline Health", "Forecast Update"  
// Tier 3: Can include "Investigation": "Pipeline Investigation"
```

If the title is generated by Claude in the synthesis, add to the prompt:

```
TITLE: Give this response a short title (2-4 words). 
Do NOT use the word "Investigation" — just name the topic.
Example: "Pipeline by Record Type", "Forecast Update", "Deal Risk Summary"
```

### Acceptance Criteria
- `grep -r "terrify\|flying blind\|vanity metrics\|masquerading\|should scare" server/` returns ZERO results
- Tier 1 responses are under 100 words
- Tier 2 responses are under 250 words
- Tier 3 responses are under 500 words
- No response title contains "Investigation" unless it's Tier 3
- Missing quotas → response shows raw numbers + one-sentence note about quotas, NOT a refusal
- Missing data → response says what's missing in one sentence, NOT a multi-paragraph diagnosis
- No response assigns deadlines or homework unless the user asked "what should we do"
- Voice is calm, professional, and direct across all tiers
- Run these test queries and verify tone:
  - "What's our pipeline?" → calm number, no lecture
  - "Forecast update" → numbers + brief context, no fear
  - "Break down by rep" → table, no commentary about data quality
  - "Are we going to hit the number?" → can be longer, but still calm and factual
