# Phase 3: Self-Reference (Memory Across Runs) — Build Prompt

## Context

Phase 1 (Editorial Synthesis Engine) and Phase 2 (Agent Templates + Builder Parameters) are complete.

**Phase 1 files (already built):**
- `server/agents/editorial-synthesizer.ts` (253 lines) — Single Claude call, produces editorial decisions + sections + opening narrative
- `server/agents/evidence-gatherer.ts` (166 lines) — Smart caching with staleness thresholds
- `server/agents/tuning.ts` (135 lines) — Reads tuning pairs from `agent_tuning_pairs` table
- `server/agents/editorial-generator.ts` (287 lines) — Pipeline integration, routes editorial vs static path
- `server/db/migrations/075_agent_editorial.sql` — Links agents to templates, stores editorial decisions

**Phase 2 files (already built):**
- `server/agents/agent-templates.ts` — 5 pre-built templates with audience/focus/data_window configs
- `server/db/migrations/076_agent_templates.sql` — Added `audience`, `focus_questions`, `data_window`, `output_formats`, `event_config` columns to agents table + `agent_templates` table
- Agent Builder UI — Template gallery, audience tab, focus questions tab, data window, event prep mode
- Editorial synthesizer updated to inject audience role, detail level, vocabulary preferences, and focus questions into the Claude prompt

**What works now:** The agent reads all evidence, makes editorial decisions (lead_with, drop_section, promote_finding, merge_sections), and produces audience-tailored briefings with focus question alignment. But every run starts from scratch — it doesn't know what it said last week.

**Phase 3 Goal:** The agent reads its own previous outputs and uses them to inform the current briefing — without blowing the context window. After this phase, the agent can say "Last week I flagged Apex Industries — it's now in legal review" and "This is the 3rd week I've flagged data quality issues."

---

## The Core Design: Two-Tier Bounded Memory

Memory stays between 600-1200 tokens regardless of whether the agent has run 4 times or 52 times.

**Tier 1: Structured digest of last run (~400-600 tokens)**
Generated at write time after each briefing completes. Not the full `SectionContent[]` — a compressed summary with just headlines, deal names, metric snapshots, and recommended actions. No LLM call needed, just field extraction from the editorial output.

**Tier 2: Rolling memory (~600-800 tokens)**
Fixed-size structures that track patterns across runs: recurring flags, deal mention history, metric trends, prediction accuracy. Capped and evicted so they never grow unbounded.

Combined, these inject ~1,300 tokens of memory context into the synthesis prompt — a fixed ceiling that doesn't grow over time.

---

## Task 3A: Migration

Create `server/db/migrations/077_agent_memory.sql`:

```sql
-- Add run_digest column to report_generations for storing compressed output summaries
-- NOTE: Check if 075_agent_editorial.sql already added agent_id, editorial_decisions, 
-- opening_narrative to report_generations. If so, only add run_digest.
ALTER TABLE report_generations ADD COLUMN IF NOT EXISTS run_digest JSONB;

-- If 075 did NOT add these, add them now:
-- ALTER TABLE report_generations ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id);
-- ALTER TABLE report_generations ADD COLUMN IF NOT EXISTS editorial_decisions JSONB;
-- ALTER TABLE report_generations ADD COLUMN IF NOT EXISTS opening_narrative TEXT;

-- Index for fast digest lookup: "get the latest completed generation for this agent"
CREATE INDEX IF NOT EXISTS idx_rg_agent_digest 
  ON report_generations(workspace_id, agent_id, created_at DESC) 
  WHERE status = 'completed';
```

Rolling memory is stored in the existing `context_layer` table — no new table needed:
- `category = 'agent_memory'`
- `key = 'memory:{agentId}'`
- `value = AgentMemory JSON`

**Before writing the migration**, inspect the current schema:
1. Run `\d report_generations` to see which columns 075 already added
2. Run `\d context_layer` to confirm the table exists and has `category`, `key`, `value` columns
3. Only ADD columns that don't already exist (use `IF NOT EXISTS`)

---

## Task 3B: Run Digest — Extract and Store

Create `server/agents/agent-memory.ts` (or add to existing memory-related file).

The run digest is generated immediately after each editorial synthesis completes. It compresses the full `EditorialOutput` into a ~400-600 token structured summary.

### AgentRunDigest Interface

```typescript
interface AgentRunDigest {
  generated_at: string;              // ISO timestamp
  opening_narrative: string;         // The 2-3 sentence narrative (already exists in output)
  
  // Compressed findings — headlines + entities, NOT full section content
  key_findings: {
    section_id: string;
    headline: string;                // First sentence of section narrative
    deals_flagged: string[];         // Deal names only: ["Apex Industries", "Helios Corp"]
    metrics_snapshot: Record<string, number>;  // { coverage: 1.4, stale_count: 12 }
    severity: 'good' | 'warning' | 'critical';
  }[];
  
  // Action items the agent recommended (max 10)
  actions_recommended: {
    deal_or_target: string;
    action: string;                  // "Update close date", "Add champion contact"
    urgency: string;
  }[];
  
  // Editorial decisions (already logged in Phase 1 output)
  sections_included: string[];
  sections_dropped: string[];
  lead_section: string;              // Which section the agent led with
}
```

### Extract Function

```typescript
function extractDigest(output: EditorialOutput): AgentRunDigest {
  return {
    generated_at: new Date().toISOString(),
    opening_narrative: output.opening_narrative,
    key_findings: output.sections.map(s => ({
      section_id: s.section_id,
      headline: s.narrative?.split('.')[0] || s.title,  // First sentence only
      deals_flagged: (s.deal_cards || []).map(d => d.name),
      metrics_snapshot: Object.fromEntries(
        (s.metrics || []).map(m => [m.key, m.value])
      ),
      severity: s.metrics?.some(m => m.severity === 'critical') ? 'critical'
        : s.metrics?.some(m => m.severity === 'warning') ? 'warning' : 'good',
    })),
    actions_recommended: output.sections
      .flatMap(s => s.action_items || [])
      .slice(0, 10)
      .map(a => ({ deal_or_target: a.target, action: a.action, urgency: a.urgency || 'normal' })),
    sections_included: output.sections_included || output.sections.map(s => s.section_id),
    sections_dropped: output.sections_dropped || [],
    lead_section: output.editorial_decisions?.find(d => d.decision === 'lead_with')?.affected_sections?.[0] 
      || output.sections[0]?.section_id,
  };
}
```

**Important:** Adapt the field access paths to match the ACTUAL `EditorialOutput` structure from `editorial-synthesizer.ts`. The interfaces above are the spec — the real code may use different field names (e.g., `section_id` vs `id`, `deal_cards` vs `deals`, `metrics` vs `metric_cards`). Read the editorial synthesizer output format before writing this.

### Save Function

```typescript
async function saveDigest(generationId: string, digest: AgentRunDigest): Promise<void> {
  await db.query(`
    UPDATE report_generations 
    SET run_digest = $1
    WHERE id = $2
  `, [JSON.stringify(digest), generationId]);
}
```

### Load Function (get latest digest for an agent)

```typescript
async function getLatestDigest(
  agentId: string, 
  workspaceId: string
): Promise<AgentRunDigest | null> {
  const result = await db.query(`
    SELECT run_digest 
    FROM report_generations 
    WHERE agent_id = $1 
      AND workspace_id = $2 
      AND status = 'completed'
      AND run_digest IS NOT NULL
    ORDER BY created_at DESC 
    LIMIT 1
  `, [agentId, workspaceId]);
  
  return result.rows[0]?.run_digest || null;
}
```

---

## Task 3C: Rolling Memory — Track Patterns Across Runs

### AgentMemory Interface

```typescript
interface AgentMemory {
  workspace_id: string;
  agent_id: string;
  
  // What keeps coming up (capped at 30, prune resolved older than 30 days)
  recurring_flags: {
    key: string;                     // "stale_deals_manufacturing", "low_coverage"
    first_flagged: string;           // ISO date
    times_flagged: number;
    last_flagged: string;            // ISO date
    resolved: boolean;
  }[];
  
  // What we said about specific deals (capped at 20 deals, 5 mentions each, FIFO)
  deal_history: {
    deal_name: string;
    deal_id: string;
    first_mentioned: string;
    mentions: {
      date: string;
      status: string;                // "flagged_at_risk", "recommended_action", "closed_won", "advanced"
      summary: string;               // One line
    }[];
  }[];
  
  // Metric trends (max 8 data points per metric, FIFO per series)
  metric_history: {
    metric: string;                  // "pipeline_coverage", "forecast_gap", "stale_deal_count"
    values: { date: string; value: number }[];
  }[];
  
  // Prediction tracking (capped at 10, FIFO)
  predictions: {
    date: string;
    prediction: string;              // "Apex will slip past March close date"
    outcome: string | null;          // "closed_won" | "slipped" | null (pending)
    correct: boolean | null;
  }[];
  
  last_updated: string;
}
```

### Bounding Constraints (CRITICAL — enforce these)

| Structure | Cap | Eviction Policy |
|-----------|-----|-----------------|
| Run digest (Tier 1) | 1 entry | Replaced each run |
| Recurring flags | 30 max | Prune resolved flags older than 30 days |
| Deal history | 20 deals, 5 mentions each | FIFO on deals |
| Metric history | 8 data points per metric | FIFO per series |
| Predictions | 10 max | FIFO |

These caps ensure the memory block never exceeds ~1,300 tokens regardless of run count.

---

## Task 3D: Memory Update Function

Runs after each generation completes. Reads the current digest + current skill evidence, updates the rolling memory structure, persists to `context_layer`.

```typescript
async function updateAgentMemory(
  agentId: string,
  workspaceId: string,
  currentDigest: AgentRunDigest,
  previousMemory: AgentMemory | null,
  currentEvidence: Record<string, SkillEvidence>
): Promise<AgentMemory> {
  const memory = previousMemory || createEmptyMemory(workspaceId, agentId);
  
  // 1. UPDATE RECURRING FLAGS
  // For each non-good finding, increment or create a flag
  for (const finding of currentDigest.key_findings) {
    if (finding.severity === 'good') continue;
    const existing = memory.recurring_flags.find(f => f.key === finding.section_id);
    if (existing) {
      existing.times_flagged++;
      existing.last_flagged = currentDigest.generated_at;
      existing.resolved = false;
    } else {
      memory.recurring_flags.push({
        key: finding.section_id,
        first_flagged: currentDigest.generated_at,
        times_flagged: 1,
        last_flagged: currentDigest.generated_at,
        resolved: false,
      });
    }
  }
  // Mark flags resolved if their section was severity=good this run
  for (const flag of memory.recurring_flags) {
    const currentFinding = currentDigest.key_findings.find(f => f.section_id === flag.key);
    if (currentFinding?.severity === 'good') flag.resolved = true;
  }
  // Prune: remove resolved flags older than 30 days, enforce cap of 30
  memory.recurring_flags = memory.recurring_flags
    .filter(f => !f.resolved || daysSince(f.last_flagged) < 30)
    .slice(0, 30);
  
  // 2. UPDATE DEAL HISTORY
  // Add mentions for all deals flagged in this run
  for (const finding of currentDigest.key_findings) {
    for (const dealName of finding.deals_flagged) {
      const existing = memory.deal_history.find(d => d.deal_name === dealName);
      if (existing) {
        existing.mentions.push({
          date: currentDigest.generated_at,
          status: 'flagged',
          summary: `Flagged in ${finding.section_id} (${finding.severity})`,
        });
        // Cap at 5 mentions per deal
        if (existing.mentions.length > 5) existing.mentions.shift();
      } else {
        memory.deal_history.push({
          deal_name: dealName,
          deal_id: '', // Could be enriched from evidence if deal IDs are available
          first_mentioned: currentDigest.generated_at,
          mentions: [{
            date: currentDigest.generated_at,
            status: 'flagged',
            summary: `First mention in ${finding.section_id}`,
          }],
        });
      }
    }
  }
  
  // Check for deals previously flagged but no longer appearing (resolved/closed)
  for (const tracked of memory.deal_history) {
    const stillFlagged = currentDigest.key_findings.some(
      f => f.deals_flagged.includes(tracked.deal_name)
    );
    const lastMention = tracked.mentions[tracked.mentions.length - 1];
    if (!stillFlagged && lastMention?.status === 'flagged') {
      // Deal dropped off — check evidence for outcome
      const outcome = findDealOutcome(tracked.deal_name, currentEvidence);
      if (outcome) {
        tracked.mentions.push({
          date: currentDigest.generated_at,
          status: outcome,
          summary: `No longer flagged — ${outcome}`,
        });
        if (tracked.mentions.length > 5) tracked.mentions.shift();
      }
    }
  }
  // Cap at 20 deals (FIFO)
  if (memory.deal_history.length > 20) {
    memory.deal_history = memory.deal_history.slice(-20);
  }
  
  // 3. APPEND METRIC SNAPSHOTS
  for (const finding of currentDigest.key_findings) {
    for (const [metric, value] of Object.entries(finding.metrics_snapshot)) {
      let series = memory.metric_history.find(m => m.metric === metric);
      if (!series) {
        series = { metric, values: [] };
        memory.metric_history.push(series);
      }
      series.values.push({ date: currentDigest.generated_at, value });
      // Cap at 8 data points per metric (FIFO)
      if (series.values.length > 8) series.values.shift();
    }
  }
  
  // 4. CHECK PREVIOUS PREDICTIONS
  for (const prediction of memory.predictions) {
    if (prediction.outcome !== null) continue; // Already resolved
    const outcome = checkPredictionOutcome(prediction, currentEvidence);
    if (outcome) {
      prediction.outcome = outcome.result;
      prediction.correct = outcome.correct;
    }
  }
  
  memory.last_updated = currentDigest.generated_at;
  
  // PERSIST to context_layer
  await db.query(`
    INSERT INTO context_layer (workspace_id, category, key, value, updated_at)
    VALUES ($1, 'agent_memory', $2, $3, NOW())
    ON CONFLICT (workspace_id, category, key)
    DO UPDATE SET value = $3, updated_at = NOW()
  `, [workspaceId, `memory:${agentId}`, JSON.stringify(memory)]);
  
  return memory;
}
```

### Helper: Find Deal Outcome

```typescript
function findDealOutcome(
  dealName: string,
  evidence: Record<string, SkillEvidence>
): string | null {
  // Check pipeline-hygiene or deal-risk-review evidence for deal status changes
  for (const skillId of ['pipeline-hygiene', 'deal-risk-review', 'forecast-rollup']) {
    const skillEvidence = evidence[skillId];
    if (!skillEvidence) continue;
    
    // Look in claims for this deal
    const claims = skillEvidence.claims || [];
    const dealClaim = claims.find(c => 
      c.message?.toLowerCase().includes(dealName.toLowerCase()) && 
      (c.message?.includes('closed') || c.message?.includes('won') || 
       c.message?.includes('lost') || c.message?.includes('advanced'))
    );
    
    if (dealClaim?.message?.toLowerCase().includes('closed-won') || 
        dealClaim?.message?.toLowerCase().includes('won')) return 'closed_won';
    if (dealClaim?.message?.toLowerCase().includes('closed-lost') || 
        dealClaim?.message?.toLowerCase().includes('lost')) return 'closed_lost';
    if (dealClaim?.message?.toLowerCase().includes('advanced')) return 'advanced';
    
    // Also check evaluated_records if available
    const records = skillEvidence.evaluated_records || [];
    const dealRecord = records.find((r: any) => 
      r.name?.toLowerCase() === dealName.toLowerCase() || 
      r.deal_name?.toLowerCase() === dealName.toLowerCase()
    );
    if (dealRecord) {
      const stage = (dealRecord as any).stage?.toLowerCase() || '';
      if (stage.includes('closed') && stage.includes('won')) return 'closed_won';
      if (stage.includes('closed') && stage.includes('lost')) return 'closed_lost';
    }
  }
  
  return null;
}
```

### Helper: Check Prediction Outcome

```typescript
function checkPredictionOutcome(
  prediction: { prediction: string; date: string },
  evidence: Record<string, SkillEvidence>
): { result: string; correct: boolean } | null {
  // Extract deal name from prediction text
  // Predictions are typically formatted like "Apex will slip past March close date"
  // This is a best-effort match — not every prediction can be auto-resolved
  
  // For now, check if any deal mentioned in the prediction text appears in 
  // closed-won or closed-lost evidence
  for (const skillId of ['pipeline-hygiene', 'deal-risk-review']) {
    const skillEvidence = evidence[skillId];
    if (!skillEvidence?.evaluated_records) continue;
    
    for (const record of skillEvidence.evaluated_records) {
      const dealName = (record as any).name || (record as any).deal_name || '';
      if (!dealName || !prediction.prediction.toLowerCase().includes(dealName.toLowerCase())) continue;
      
      const stage = ((record as any).stage || '').toLowerCase();
      if (stage.includes('closed') && stage.includes('won')) {
        // Deal closed won — was prediction about risk/slippage?
        const predictedRisk = prediction.prediction.toLowerCase().includes('slip') ||
          prediction.prediction.toLowerCase().includes('risk') ||
          prediction.prediction.toLowerCase().includes('stall');
        return { result: 'closed_won', correct: !predictedRisk };
      }
      if (stage.includes('closed') && stage.includes('lost')) {
        const predictedRisk = prediction.prediction.toLowerCase().includes('risk') ||
          prediction.prediction.toLowerCase().includes('lose');
        return { result: 'closed_lost', correct: predictedRisk };
      }
    }
  }
  
  return null; // Can't determine outcome yet
}
```

### Helper: Utility functions

```typescript
function daysSince(isoDate: string): number {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24));
}

function createEmptyMemory(workspaceId: string, agentId: string): AgentMemory {
  return {
    workspace_id: workspaceId,
    agent_id: agentId,
    recurring_flags: [],
    deal_history: [],
    metric_history: [],
    predictions: [],
    last_updated: new Date().toISOString(),
  };
}
```

### Load Function

```typescript
async function getAgentMemory(
  agentId: string, 
  workspaceId: string
): Promise<AgentMemory | null> {
  const result = await db.query(`
    SELECT value 
    FROM context_layer 
    WHERE workspace_id = $1 
      AND category = 'agent_memory' 
      AND key = $2
  `, [workspaceId, `memory:${agentId}`]);
  
  if (!result.rows[0]?.value) return null;
  
  const memory = typeof result.rows[0].value === 'string' 
    ? JSON.parse(result.rows[0].value) 
    : result.rows[0].value;
  
  return memory as AgentMemory;
}
```

---

## Task 3E: Memory Formatter for Synthesis Prompt

Format the digest + rolling memory into a prompt block. This function is called before the editorial synthesis and its output is injected into the Claude prompt.

```typescript
function formatMemoryForPrompt(
  digest: AgentRunDigest | null,
  memory: AgentMemory | null
): string {
  if (!digest && !memory) {
    return 'This is your first run. No previous briefings to reference.';
  }
  
  const parts: string[] = ['MEMORY (from your previous runs):'];
  
  // ── Tier 1: Last run digest ──
  if (digest) {
    const daysAgo = daysSince(digest.generated_at);
    parts.push(`\nLast briefing (${daysAgo} day${daysAgo !== 1 ? 's' : ''} ago):`);
    parts.push(`- Opening: "${digest.opening_narrative}"`);
    parts.push(`- Led with: ${digest.lead_section}`);
    
    const allDeals = digest.key_findings.flatMap(f => f.deals_flagged);
    if (allDeals.length > 0) {
      parts.push(`- Deals flagged: ${allDeals.join(', ')}`);
    }
    
    const keyMetrics = digest.key_findings
      .flatMap(f => Object.entries(f.metrics_snapshot))
      .slice(0, 6)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    if (keyMetrics) {
      parts.push(`- Key metrics: ${keyMetrics}`);
    }
    
    if (digest.actions_recommended.length > 0) {
      parts.push(`- Actions recommended: ${digest.actions_recommended.slice(0, 3).map(a => `${a.deal_or_target}: ${a.action}`).join('; ')}`);
    }
  }
  
  // ── Tier 2: Rolling memory ──
  if (memory) {
    // Recurring flags (only unresolved with 2+ occurrences)
    const unresolved = memory.recurring_flags.filter(f => !f.resolved && f.times_flagged > 1);
    if (unresolved.length > 0) {
      parts.push('\nRecurring patterns (still unresolved):');
      for (const flag of unresolved.slice(0, 5)) {
        parts.push(`- "${flag.key}" flagged ${flag.times_flagged} times (since ${flag.first_flagged.split('T')[0]})`);
      }
    }
    
    // Recently resolved flags (positive signal)
    const recentlyResolved = memory.recurring_flags.filter(f => f.resolved && daysSince(f.last_flagged) < 14);
    if (recentlyResolved.length > 0) {
      parts.push('\nRecently resolved:');
      for (const flag of recentlyResolved.slice(0, 3)) {
        parts.push(`- "${flag.key}" resolved after ${flag.times_flagged} flags`);
      }
    }
    
    // Deal tracking (only deals with multiple mentions — the narrative arcs)
    const trackedDeals = memory.deal_history.filter(d => d.mentions.length > 1);
    if (trackedDeals.length > 0) {
      parts.push('\nDeal tracking:');
      for (const deal of trackedDeals.slice(0, 5)) {
        const latest = deal.mentions[deal.mentions.length - 1];
        const first = deal.mentions[0];
        parts.push(`- ${deal.deal_name}: ${first.status} on ${first.date.split('T')[0]} → ${latest.status} on ${latest.date.split('T')[0]} (${deal.mentions.length} mentions)`);
      }
    }
    
    // Metric trends (only metrics with 3+ readings and clear direction)
    const trends = memory.metric_history
      .filter(m => m.values.length >= 3)
      .map(m => {
        const vals = m.values.map(v => v.value);
        const recent = vals.slice(-3);
        const direction = recent[2] > recent[0] ? 'improving' 
          : recent[2] < recent[0] ? 'declining' : 'flat';
        return { metric: m.metric, values: recent, direction };
      })
      .filter(t => t.direction !== 'flat');
    
    if (trends.length > 0) {
      parts.push('\nMetric trends (last 3 readings):');
      for (const t of trends.slice(0, 5)) {
        parts.push(`- ${t.metric}: ${t.values.join(' → ')} (${t.direction})`);
      }
    }
    
    // Prediction accuracy
    const resolved = memory.predictions.filter(p => p.outcome !== null);
    if (resolved.length > 0) {
      const correct = resolved.filter(p => p.correct).length;
      parts.push(`\nPrediction accuracy: ${correct}/${resolved.length} correct`);
      const latest = resolved[resolved.length - 1];
      parts.push(`- Latest: "${latest.prediction}" → ${latest.outcome} (${latest.correct ? '✓ correct' : '✗ wrong'})`);
    }
  }
  
  // ── Self-reference instructions ──
  parts.push('\nSELF-REFERENCE INSTRUCTIONS:');
  parts.push('- Reference what changed since last briefing (improved, worsened, resolved, new)');
  parts.push('- If you flagged deals last time, report their status (advanced? stalled? closed?)');
  parts.push('- If you\'ve flagged the same issue multiple runs in a row, escalate: "This is the Nth time I\'ve flagged X — it hasn\'t been addressed"');
  parts.push('- If a prediction was wrong, acknowledge it: "I predicted X would slip — good news, it closed"');
  parts.push('- Do NOT repeat the same opening narrative — lead with what\'s NEW or DIFFERENT');
  parts.push('- Use metric trends to show direction: "Coverage improved from 1.8x to 2.3x over the last 3 weeks"');
  
  return parts.join('\n');
}
```

**Token budget for memory block:** This function should produce 600-1200 tokens of text. To verify, log the character count — 1 token ≈ 4 characters. If the output exceeds ~5,000 characters, you're over budget and should tighten the slicing (fewer flags, fewer deals, fewer trends).

---

## Task 3F: Wire Into Generation Pipeline

The editorial generation pipeline needs three changes:

### 1. Load memory BEFORE editorial synthesis

In `server/agents/editorial-generator.ts` (or wherever the editorial path orchestrates the pipeline), add memory loading:

```typescript
// BEFORE calling editorialSynthesize():

// Load previous run digest (Tier 1)
const digest = await getLatestDigest(agent.id, workspaceId);

// Load rolling memory (Tier 2)
const memory = await getAgentMemory(agent.id, workspaceId);

// Format into prompt block
const memoryBlock = formatMemoryForPrompt(digest, memory);

// Pass to editorial synthesizer
const editorial = await editorialSynthesize({
  ...existingParams,
  memoryContext: memoryBlock,  // NEW parameter
});
```

### 2. Update editorial synthesizer to accept memory

In `server/agents/editorial-synthesizer.ts`, add the `memoryContext` parameter to the input interface and inject it into the Claude prompt between the TUNING section and the EVIDENCE section:

```
SYSTEM: You are the {agent.role} for {workspace.name}.
...audience config from Phase 2...
...focus questions from Phase 2...

TUNING:
{tuningPairs}

{memoryContext}     ← INSERT HERE (between tuning and evidence)

EVIDENCE:
{skill evidence}

INSTRUCTIONS:
...existing instructions...
```

If `memoryContext` is null/empty (first run or memory not yet available), omit it from the prompt entirely. Don't include a blank section.

### 3. Save digest and update memory AFTER generation completes

After the editorial synthesizer returns and the generation is saved:

```typescript
// AFTER editorial synthesis completes and generation is saved:

// Extract compressed digest from the output
const newDigest = extractDigest(editorial);

// Save digest to the generation row
await saveDigest(generation.id, newDigest);

// Update rolling memory with new data points
await updateAgentMemory(
  agent.id, 
  workspaceId, 
  newDigest, 
  memory,           // The memory we loaded before synthesis (null on first run)
  evidence           // Current skill evidence (needed for deal outcome checking)
);
```

### Pipeline flow (complete):

```
1. Load agent config (audience, focus_questions, data_window) ← Phase 2
2. Gather fresh evidence (staleness check + cache) ← Phase 1
3. Load tuning pairs ← Phase 1
4. Load previous digest + rolling memory ← NEW (Phase 3)
5. Format memory into prompt block ← NEW (Phase 3)
6. Call editorial synthesizer (evidence + tuning + memory + audience) ← Modified
7. Extract digest from output ← NEW (Phase 3)
8. Save generation + digest ← Modified (adds run_digest)
9. Update rolling memory ← NEW (Phase 3)
10. Render to formats + deliver to channels ← Unchanged
```

---

## Task 3G: Prediction Extraction (Optional Enhancement)

The editorial synthesizer's output sometimes contains implicit predictions ("This deal will likely slip" or "Coverage should recover next week"). To populate the `predictions` array in rolling memory, you can either:

**Option A (Simple):** Skip prediction extraction for now. The predictions array stays empty until Phase 4 when users can explicitly confirm/deny agent predictions via feedback.

**Option B (Auto-extract):** After the editorial synthesis, scan the output sections for prediction-like statements and add them to memory:

```typescript
function extractPredictions(editorial: EditorialOutput): Array<{
  prediction: string;
  date: string;
}> {
  const predictions: Array<{ prediction: string; date: string }> = [];
  
  for (const section of editorial.sections) {
    const narrative = section.narrative || '';
    // Look for prediction patterns
    const predictionPatterns = [
      /(?:will likely|expected to|should|at risk of)\s+(.{20,80})/gi,
      /(?:predict|expect|anticipate)\s+(?:that\s+)?(.{20,80})/gi,
    ];
    
    for (const pattern of predictionPatterns) {
      const matches = narrative.matchAll(pattern);
      for (const match of matches) {
        predictions.push({
          prediction: match[0].trim().slice(0, 120), // Cap length
          date: new Date().toISOString(),
        });
      }
    }
  }
  
  return predictions.slice(0, 3); // Max 3 new predictions per run
}
```

**Recommendation:** Start with Option A. Prediction tracking is powerful but prediction extraction is fragile. Better to add it deliberately in Phase 4 when users can confirm what counts as a prediction.

---

## Verification Checklist

### First run (empty memory):
1. **First run works cleanly** — Agent generates briefing with memory block showing "This is your first run. No previous briefings to reference."
2. **Digest saved** — After generation, `report_generations.run_digest` contains the compressed digest JSONB
3. **Rolling memory created** — `context_layer` row exists with `category='agent_memory'` and `key='memory:{agentId}'`

### Second run (memory available):
4. **Memory loaded** — Agent's prompt includes the memory block with last run's digest
5. **Self-reference in output** — Opening narrative references previous run: "Last week I flagged X" or "Since last briefing, Y changed"
6. **Different opening** — Opening narrative is NOT the same as the previous run's
7. **Deal tracking works** — Deals flagged in both runs show up in `deal_history` with 2 mentions
8. **Metric trends populate** — `metric_history` has entries with 2 data points

### Third+ run (patterns emerge):
9. **Recurring flags escalate** — If same section stays critical/warning 3 runs in a row, memory shows `times_flagged: 3`
10. **Deal resolution detected** — When a previously-flagged deal disappears from findings, memory records the outcome if detectable
11. **Metric trends show direction** — With 3+ data points, trends show "improving" or "declining"

### Bounding:
12. **Memory stays bounded** — After 10+ simulated runs, the memory block in the prompt stays under 1,500 tokens (~6,000 characters)
13. **Deal history caps at 20** — Add 25+ unique deals across runs, verify only 20 remain
14. **Metric history caps at 8** — Run 10+ times, verify each metric series has max 8 data points
15. **Recurring flags cap at 30** — Verify pruning works

### Backward compatibility:
16. **Non-agent templates unaffected** — Static generation path (no agent_id) works exactly as before, no memory loading attempted
17. **Agents without memory work** — If `context_layer` has no memory row, agent runs normally with "first run" message

---

## What This Does NOT Change

- The editorial-synthesizer.ts core logic (just adds one more input parameter: `memoryContext`)
- The evidence-gatherer.ts caching/staleness logic
- The tuning.ts reader
- The renderer pipeline (PDF/DOCX/PPTX/Slack/email)
- The report viewer
- The Agent Builder UI
- The agent templates
- The static section-generator.ts fallback path

---

## Token Budget (Updated with Memory)

| Component | Tokens | Source |
|-----------|--------|--------|
| System prompt + agent config + audience | ~800 | Phase 2 |
| Focus questions | ~200 | Phase 2 |
| Tuning pairs (max 10) | ~400 | Phase 1 |
| **Tier 1: Last run digest** | **~500** | **Phase 3 NEW** |
| **Tier 2: Rolling memory** | **~800** | **Phase 3 NEW** |
| Skill evidence (summarized) | ~4,000 | Phase 1 |
| Available sections library | ~600 | Phase 1 |
| **Total input** | **~7,300** | |
| Output (sections + decisions) | ~3,000 | Variable |
| **Total per briefing** | **~10,300** | **~$0.12** |

Memory adds ~1,300 tokens. This is a fixed ceiling — week 1 and week 52 have the same memory footprint.

---

## File Summary

| Action | File | Purpose |
|--------|------|---------|
| CREATE | `server/db/migrations/077_agent_memory.sql` | Add `run_digest` column + index |
| CREATE | `server/agents/agent-memory.ts` | All memory functions: extract digest, load/save digest, load/save/update rolling memory, format for prompt, helpers |
| MODIFY | `server/agents/editorial-synthesizer.ts` | Accept `memoryContext` param, inject into Claude prompt |
| MODIFY | `server/agents/editorial-generator.ts` | Load memory before synthesis, save digest + update memory after |

**Total new code:** ~350-450 lines in `agent-memory.ts`, ~20-30 lines modified in synthesizer + generator.
