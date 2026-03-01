# Claude Code Patch: Investigation Complexity Gate + Progressive Streaming

## Problem

Every Ask Pandora message currently fires the full investigation engine (3-5 skills, 33-35K tokens, 15+ seconds). Simple questions like "forecast update" or "show me Sarah's deals" don't need a multi-skill investigation chain. Two fixes needed:

1. **Complexity gate** — classify question complexity BEFORE dispatching the investigation planner. Simple questions get fast, cheap answers. Only genuinely complex questions trigger full investigation.
2. **Progressive streaming** — findings should stream to the UI as each skill completes, not batch at the end. This makes even complex investigations feel faster.

## Before You Start — Read These Files

1. `server/chat/orchestrator.ts` — the multi-layer router. Find where investigation engine is currently triggered.
2. `server/investigation/planner.ts` — the `createInvestigationPlan()` function.
3. `server/investigation/executor.ts` — the `executeInvestigation()` function and its callbacks.
4. `server/routes/conversation-stream.ts` (or wherever the SSE endpoint lives that streams to the Ask Pandora UI).
5. `server/skills/runtime.ts` — `executeSkill()` to understand cache lookup timing.

## Task 1: Complexity Classifier

Create `server/investigation/complexity-gate.ts`:

```typescript
// server/investigation/complexity-gate.ts

export type QuestionComplexity = 'lookup' | 'focused' | 'investigation';

export interface ComplexityResult {
  tier: QuestionComplexity;
  primary_skill: string | null;     // Best single skill to answer this
  max_skills: number;               // 1, 2, or 5
  allow_fresh_runs: boolean;        // Tier 1-2 use cache only, Tier 3 can run fresh
  reasoning: string;                // For logging/debugging
}

/**
 * Fast classifier that determines how much investigation a question needs.
 * Runs BEFORE the investigation planner. Uses pattern matching first,
 * falls back to a cheap LLM call only when ambiguous.
 * 
 * Tier 1 — Lookup (1 skill, cache only, <5s, <3K tokens)
 *   Single-entity or single-metric questions with no "why" component.
 *   "Show me pipeline by stage", "What's our close rate?", "Sarah's deals"
 * 
 * Tier 2 — Focused (1-2 skills, cache preferred, <10s, <10K tokens)
 *   Questions about a domain that may need one follow-up.
 *   "Forecast update", "How's pipeline looking?", "Any deal risks?"
 * 
 * Tier 3 — Investigation (3-5 skills, fresh OK, <30s, <35K tokens)
 *   Questions that span multiple domains, ask "why", reference goals/targets,
 *   or require causal reasoning across skills.
 *   "Are we going to hit the number?", "Why did pipeline drop?", 
 *   "What's wrong with outbound?"
 */
export async function classifyComplexity(
  message: string,
  context?: {
    hasStructuredGoals: boolean;
    recentSkillRunCount: number;  // How many cached runs are available
  }
): Promise<ComplexityResult> {
  
  const lower = message.toLowerCase().trim();
  
  // ─── TIER 1: Lookup patterns ───
  // Direct entity requests
  if (/^(show|list|give|get|pull|what('?s| is| are))\s+(me\s+)?(the\s+)?\w+('?s)?\s+(deals?|pipeline|opportunities|accounts?|contacts?)/i.test(lower)) {
    return {
      tier: 'lookup',
      primary_skill: inferPrimarySkill(lower),
      max_skills: 1,
      allow_fresh_runs: false,
      reasoning: 'Direct entity/metric request — single skill lookup',
    };
  }
  
  // Single metric questions
  if (/^what('?s| is| are)\s+(the|our|my)\s+(close|win|conversion)\s+rate/i.test(lower)) {
    return {
      tier: 'lookup',
      primary_skill: 'forecast-rollup',
      max_skills: 1,
      allow_fresh_runs: false,
      reasoning: 'Single metric question',
    };
  }
  
  // Rep-specific questions without "why"
  if (/\b(sarah|mike|jack|nate|jake)\b.*\b(deals?|pipeline|quota|numbers?)\b/i.test(lower) &&
      !/\bwhy\b/i.test(lower)) {
    return {
      tier: 'lookup',
      primary_skill: 'rep-scorecard',
      max_skills: 1,
      allow_fresh_runs: false,
      reasoning: 'Rep-specific lookup without causal question',
    };
  }
  
  // ─── TIER 3: Investigation patterns ───
  // Goal/target reference + complexity
  if (/\b(hit(ting)?|miss(ing)?|make|on track|behind|ahead|gap|target|goal|quota|number)\b/i.test(lower) &&
      /\b(going to|will we|can we|are we|why|what.*(need|change|do|fix))\b/i.test(lower)) {
    return {
      tier: 'investigation',
      primary_skill: 'forecast-rollup',
      max_skills: 5,
      allow_fresh_runs: true,
      reasoning: 'Goal-referenced question with causal/predictive component',
    };
  }
  
  // Explicit "why" questions
  if (/^why\b/i.test(lower) || /\bwhy (did|is|are|has|have|does)\b/i.test(lower)) {
    return {
      tier: 'investigation',
      primary_skill: inferPrimarySkill(lower),
      max_skills: 5,
      allow_fresh_runs: true,
      reasoning: '"Why" question requires causal investigation across skills',
    };
  }
  
  // Multi-domain questions
  if (/\b(and|versus|vs|compared|across|between)\b/i.test(lower) &&
      countDomains(lower) >= 2) {
    return {
      tier: 'investigation',
      primary_skill: inferPrimarySkill(lower),
      max_skills: 5,
      allow_fresh_runs: true,
      reasoning: 'Multi-domain comparison requires cross-skill analysis',
    };
  }
  
  // "What's going wrong", "what should we do", open-ended strategic
  if (/\b(what('?s| is)\s+(going\s+)?(wrong|happening)|what\s+should\s+(we|i)|give me the full picture|deep dive)\b/i.test(lower)) {
    return {
      tier: 'investigation',
      primary_skill: inferPrimarySkill(lower),
      max_skills: 5,
      allow_fresh_runs: true,
      reasoning: 'Open-ended strategic question',
    };
  }
  
  // ─── TIER 2: Everything else (default) ───
  return {
    tier: 'focused',
    primary_skill: inferPrimarySkill(lower),
    max_skills: 2,
    allow_fresh_runs: false,
    reasoning: 'Standard question — focused investigation with 1-2 skills',
  };
}

/**
 * Map question content to the most relevant primary skill.
 */
function inferPrimarySkill(lower: string): string {
  if (/\b(forecast|predict|landing|commit|best case|worst case|upside|p50|weighted)\b/i.test(lower)) {
    return 'forecast-rollup';
  }
  if (/\b(pipeline|coverage|hygiene|stale|stuck|aging)\b/i.test(lower)) {
    return 'pipeline-hygiene';
  }
  if (/\b(rep|scorecard|performance|quota attainment|activity|ramp)\b/i.test(lower)) {
    return 'rep-scorecard';
  }
  if (/\b(deal|risk|regression|slip|push|close date|single.?thread)\b/i.test(lower)) {
    return 'deal-risk-review';
  }
  if (/\b(waterfall|created|generation|gen|new pipeline|sourced|net new)\b/i.test(lower)) {
    return 'pipeline-waterfall';
  }
  if (/\b(conversation|call|meeting|talk|said|discussed|sentiment|objection)\b/i.test(lower)) {
    return 'conversation-intelligence';
  }
  if (/\b(coach|feedback|improve|training|skill gap)\b/i.test(lower)) {
    return 'coaching-insights';
  }
  if (/\b(bowtie|funnel|full|review|everything|overview|brief)\b/i.test(lower)) {
    return 'forecast-rollup'; // Start broad, planner can add more
  }
  
  // Default
  return 'forecast-rollup';
}

/**
 * Count how many distinct domains (pipeline, forecast, rep, deal, conversation) 
 * are referenced in the question.
 */
function countDomains(lower: string): number {
  let count = 0;
  if (/\b(pipeline|coverage|hygiene)\b/.test(lower)) count++;
  if (/\b(forecast|commit|weighted|landing)\b/.test(lower)) count++;
  if (/\b(rep|scorecard|performance|quota)\b/.test(lower)) count++;
  if (/\b(deal|risk|regression|slip)\b/.test(lower)) count++;
  if (/\b(conversation|call|meeting|sentiment)\b/.test(lower)) count++;
  return count;
}
```

## Task 2: Wire Gate into Orchestrator

Find where the investigation engine is triggered in the chat flow. It's likely in `server/chat/orchestrator.ts` or `server/routes/conversation-stream.ts`. Replace the unconditional investigation call with the gated version:

```typescript
// BEFORE (current — everything goes through full investigation):
// const plan = await createInvestigationPlan(workspaceId, message, { maxSteps: 5 });
// const result = await executeInvestigation(plan, callbacks);

// AFTER (gated):
import { classifyComplexity } from '../investigation/complexity-gate';

const hasGoals = (await goalService?.list?.(workspaceId, { is_active: true }))?.length > 0;
const recentRuns = await query(
  `SELECT COUNT(*) as cnt FROM skill_runs 
   WHERE workspace_id = $1 AND status = 'completed' 
   AND started_at >= NOW() - INTERVAL '1 hour'`,
  [workspaceId]
);

const complexity = await classifyComplexity(message, {
  hasStructuredGoals: hasGoals || false,
  recentSkillRunCount: parseInt(recentRuns.rows[0]?.cnt || '0'),
});

console.log(`[investigation-gate] "${message}" → ${complexity.tier} (${complexity.reasoning})`);

let result;

switch (complexity.tier) {
  case 'lookup': {
    // Fast path: single skill, cache only, light synthesis
    const cached = await getMostRecentSkillRun(workspaceId, complexity.primary_skill);
    
    if (cached) {
      // Synthesize directly from cached result — no planner needed
      const synthesis = await synthesizeSingleSkill(
        workspaceId, message, cached, { goalContext: hasGoals }
      );
      result = { synthesis, steps_executed: 1, total_tokens: synthesis.tokens };
    } else {
      // No cache — run the one skill, then synthesize
      const skillResult = await executeAndCache(workspaceId, complexity.primary_skill);
      const synthesis = await synthesizeSingleSkill(
        workspaceId, message, skillResult, { goalContext: hasGoals }
      );
      result = { synthesis, steps_executed: 1, total_tokens: synthesis.tokens };
    }
    break;
  }
  
  case 'focused': {
    // Medium path: investigation planner with max 2 steps, cache preferred
    const plan = await createInvestigationPlan(workspaceId, message, {
      maxSteps: 2,
      preferCache: true,
      primarySkill: complexity.primary_skill,
    });
    result = await executeInvestigation(plan, callbacks);
    break;
  }
  
  case 'investigation': {
    // Full path: investigation planner with up to 5 steps
    const plan = await createInvestigationPlan(workspaceId, message, {
      maxSteps: 5,
      preferCache: false,
      primarySkill: complexity.primary_skill,
    });
    result = await executeInvestigation(plan, callbacks);
    break;
  }
}
```

## Task 3: Single-Skill Synthesis (for Tier 1)

Create `server/investigation/single-skill-synthesis.ts`:

Tier 1 questions don't need the full investigation → synthesis pipeline. They need a quick, focused answer from one skill's cached output.

```typescript
// server/investigation/single-skill-synthesis.ts

export async function synthesizeSingleSkill(
  workspaceId: string,
  question: string,
  skillRun: { skill_id: string; output_text: string; result: any },
  options?: { goalContext?: boolean }
): Promise<{ text: string; tokens: number }> {
  
  // Build a lean prompt — no investigation chain, no persistence block
  // Just: question + skill output + optional goal context
  let goalBlock = '';
  if (options?.goalContext) {
    // Lightweight goal summary — just the top-level numbers
    const goals = await query(`
      SELECT g.label, g.target_value, gs.current_value, gs.attainment_pct, 
             gs.trajectory, gs.days_remaining
      FROM goals g
      LEFT JOIN goal_snapshots gs ON gs.goal_id = g.id 
        AND gs.snapshot_date = (SELECT MAX(snapshot_date) FROM goal_snapshots WHERE goal_id = g.id)
      WHERE g.workspace_id = $1 AND g.is_active = true AND g.level IN ('board', 'company')
      LIMIT 3
    `, [workspaceId]);
    
    if (goals.rows.length > 0) {
      goalBlock = `\nGOAL CONTEXT:\n${goals.rows.map(g => 
        `- ${g.label}: ${g.current_value || '?'}/${g.target_value} (${g.attainment_pct || '?'}% attainment, ${g.trajectory || 'unknown'})`
      ).join('\n')}\n`;
    }
  }
  
  const prompt = `You are Pandora. Answer this question concisely using the skill output below.
  
QUESTION: "${question}"
${goalBlock}
SKILL OUTPUT (${skillRun.skill_id}):
${skillRun.output_text || JSON.stringify(skillRun.result, null, 2).substring(0, 3000)}

RULES:
- Answer the question directly in 2-4 sentences.
- Reference specific numbers from the data.
- If goal context is available, frame numbers relative to the target.
- Do NOT add investigation steps or investigation chain narration.
- Do NOT recommend actions unless the question asks "what should we do."
- Be direct and specific. This is a quick answer, not a report.`;

  const response = await callAnthropicAI({
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 500,
    temperature: 0.3,
  });
  
  return {
    text: extractText(response),
    tokens: response.usage?.total_tokens || 500,
  };
}

/**
 * Get the most recent completed skill run from cache.
 * "Fresh" = completed within the last hour.
 */
export async function getMostRecentSkillRun(
  workspaceId: string,
  skillId: string,
  maxAgeMinutes: number = 60
): Promise<any | null> {
  const result = await query(`
    SELECT id, skill_id, output_text, result, started_at
    FROM skill_runs
    WHERE workspace_id = $1 AND skill_id = $2 AND status = 'completed'
      AND started_at >= NOW() - INTERVAL '${maxAgeMinutes} minutes'
    ORDER BY started_at DESC
    LIMIT 1
  `, [workspaceId, skillId]);
  
  return result.rows[0] || null;
}
```

## Task 4: Update Investigation Planner to Accept Constraints

The `createInvestigationPlan()` function needs to respect the complexity gate's constraints:

Find `server/investigation/planner.ts` and update the options interface and planning logic:

```typescript
// Add to the options parameter of createInvestigationPlan:

interface PlanOptions {
  maxSteps?: number;          // Already exists
  goalIds?: string[];         // Already exists
  anchorFindings?: Finding[]; // Already exists
  
  // NEW from complexity gate:
  preferCache?: boolean;      // Tier 1-2: prefer cached skill runs
  primarySkill?: string;      // Gate already identified the best starting skill
}

// In the planning logic, if primarySkill is provided and maxSteps <= 2,
// skip the LLM planning call entirely (saves ~500-1000 tokens and ~1-2 seconds):

export async function createInvestigationPlan(
  workspaceId: string,
  question: string,
  options?: PlanOptions
): Promise<InvestigationPlan> {
  
  // FAST PATH: If complexity gate already chose a primary skill and max is 2,
  // skip the LLM planning call. Build the plan directly.
  if (options?.primarySkill && (options?.maxSteps || 5) <= 2) {
    return {
      id: randomUUID(),
      workspace_id: workspaceId,
      question,
      goal_context: [],  // Loaded during execution if needed
      steps: [{
        index: 0,
        operator_name: mapSkillToOperator(options.primarySkill),
        skill_id: options.primarySkill,
        trigger: 'initial',
        status: 'pending',
        used_cache: false,
      }],
      current_step: 0,
      status: 'planning',
      max_steps: options?.maxSteps || 2,
      prefer_cache: options?.preferCache ?? true,
      total_tokens: 0,
    };
  }
  
  // FULL PATH: Use LLM to plan investigation (existing logic)
  // ... keep existing planning code for Tier 3
}
```

## Task 5: Update Executor for Cache Preference

In `server/investigation/executor.ts`, update the cache logic to respect `plan.prefer_cache`:

```typescript
// Find the section where cached vs fresh skill runs are decided.
// Currently it probably checks for a 30-minute cache window.
// Update to:

const cacheWindow = plan.prefer_cache ? '2 hours' : '30 minutes';

const cached = await query(`
  SELECT id, output_text, result FROM skill_runs
  WHERE workspace_id = $1 AND skill_id = $2 AND status = 'completed'
    AND started_at >= NOW() - INTERVAL '${cacheWindow}'
  ORDER BY started_at DESC LIMIT 1
`, [plan.workspace_id, step.skill_id]);

// For Tier 1-2 (prefer_cache = true): Use anything from last 2 hours
// For Tier 3 (prefer_cache = false): Only use runs from last 30 minutes, otherwise run fresh
```

## Task 6: Progressive Streaming

Find the SSE endpoint that streams to the Ask Pandora UI. Ensure that findings stream incrementally as each skill completes — NOT batched at the end.

The callbacks in `executeInvestigation()` should already support this, but verify the SSE writer sends events immediately:

```typescript
// In the SSE conversation handler, verify these callbacks send immediately:

const callbacks = {
  onStepStart: (step) => {
    // This should fire IMMEDIATELY when a skill starts executing
    res.write(`data: ${JSON.stringify({
      type: 'agent_thinking',
      agent_id: step.skill_id,
      agent_name: step.operator_name,
      skill_name: step.skill_id,
    })}\n\n`);
    
    // CRITICAL: Flush the response so the client receives it NOW
    if (res.flush) res.flush();
  },
  
  onStepComplete: (step, findings) => {
    // This should fire IMMEDIATELY when a skill finishes
    res.write(`data: ${JSON.stringify({
      type: 'agent_found',
      agent_id: step.skill_id,
      agent_name: step.operator_name,
      finding_preview: step.result_summary,
    })}\n\n`);
    
    res.write(`data: ${JSON.stringify({
      type: 'agent_done',
      agent_id: step.skill_id,
    })}\n\n`);
    
    // CRITICAL: Flush again
    if (res.flush) res.flush();
  },
  
  onFollowUpDecided: (fromStep, newStep) => {
    // NEW operator recruited mid-investigation — send immediately
    res.write(`data: ${JSON.stringify({
      type: 'recruiting',
      agent_id: newStep.skill_id,
      agent_name: newStep.operator_name,
      task: newStep.triggered_by?.reasoning || 'Following up...',
    })}\n\n`);
    
    if (res.flush) res.flush();
  },
  
  onSynthesisChunk: (text) => {
    // Stream synthesis text character-by-character or in small chunks
    res.write(`data: ${JSON.stringify({
      type: 'synthesis_chunk',
      text,
    })}\n\n`);
    
    // Flush every chunk for real-time feel
    if (res.flush) res.flush();
  },
};
```

**Key check:** If the Express response isn't being flushed, all events queue up and arrive at once when synthesis completes. This is the most likely cause of the "long wait then wall of text" feel. The `res.flush()` calls are critical.

Also check if there's any compression middleware (like `compression()`) on this route — compression can buffer SSE events. If so, disable it for the SSE endpoint:

```typescript
// In your Express app setup, BEFORE the SSE route:
app.get('/api/conversation-stream', (req, res, next) => {
  // Disable compression for SSE
  req.headers['accept-encoding'] = 'identity';
  next();
});
```

## Task 7: Fix duration_ms Tracking

Find where skill_runs are INSERT'd or UPDATE'd after execution. The `duration_ms` column exists but isn't being written.

Look in `server/skills/runtime.ts` or wherever `executeSkill()` completes:

```typescript
// Capture start time BEFORE skill execution:
const startTime = Date.now();

// ... skill executes ...

// Write duration on completion:
const durationMs = Date.now() - startTime;

await query(`
  UPDATE skill_runs SET 
    duration_ms = $2,
    status = 'completed',
    completed_at = NOW()
  WHERE id = $1
`, [skillRunId, durationMs]);
```

Search the codebase for any place that writes `status = 'completed'` to `skill_runs` and ensure `duration_ms` is written alongside it.

## Task 8: Add Logging for Gate Decisions

For debugging and tuning the gate over time, log every classification:

```typescript
// After classifyComplexity returns, log to a lightweight table or just console:
console.log(JSON.stringify({
  event: 'investigation_gate',
  workspace_id: workspaceId,
  message: message.substring(0, 100),
  tier: complexity.tier,
  primary_skill: complexity.primary_skill,
  max_skills: complexity.max_skills,
  reasoning: complexity.reasoning,
  timestamp: new Date().toISOString(),
}));
```

This lets you review gate decisions and tune the patterns. If "forecast update" is hitting Tier 3 instead of Tier 2, you adjust the patterns.

---

## Validation Checklist

1. **"Show me Sarah's deals"** → complexity gate returns `lookup`, 1 skill runs, response in <5 seconds
2. **"Forecast update"** → gate returns `focused`, 1-2 skills max, response in <10 seconds  
3. **"Are we going to hit the number?"** → gate returns `investigation`, 3-5 skills, full chain
4. **"Why did pipeline drop?"** → gate returns `investigation` (starts with "why")
5. **"What's our close rate?"** → gate returns `lookup`, single metric from forecast-rollup cache
6. **Token usage for Tier 1** → under 3K tokens total (synthesis prompt + response)
7. **Token usage for Tier 2** → under 10K tokens total
8. **Progressive streaming** — agent findings appear in UI one-by-one as skills complete, not all at once
9. **res.flush()** — verify SSE events aren't buffered by compression middleware
10. **duration_ms** — after any skill run, `skill_runs.duration_ms` is populated (not NULL)
11. **Gate logging** — console shows tier decision for every question asked
12. **Cache window** — Tier 1-2 use 2-hour cache, Tier 3 uses 30-minute cache
13. **Skip LLM planning** — Tier 1-2 don't make a planning LLM call (saves 1-2 seconds + 500-1000 tokens)

## What NOT to Build

- **Dynamic tier adjustment based on user role** — future enhancement, not now
- **Token budget enforcement** — the gate reduces usage but doesn't hard-cap. Hard caps come later.
- **Custom tier thresholds per workspace** — use the defaults for now, tune from logs
- **Streaming synthesis for Tier 1** — Tier 1 responses are short enough to return as a single block
