# Claude Code Prompt: Goal-Aware Synthesis

## Context

Agents now have three new fields from the Ask-to-Agent migration:
- `goal` — the business outcome the Agent is working toward (string, ≤ 200 chars)
- `standing_questions` — specific questions to answer on every run (string[], ≤ 5)
- `created_from` — 'manual' | 'conversation'

Today the synthesis step in `runtime.ts` produces a **findings dump** — a summary
of what the skills found, organized by severity. That format is fine for Agents
without a goal.

When an Agent HAS a goal and standing questions, the output should instead be:

  1. **STATUS AGAINST GOAL** — a direct verdict on whether the Agent's mandate is
     being met, with the primary evidence in 2–3 sentences.
  2. **STANDING QUESTIONS** — each question answered with specific names, amounts,
     and deal-level evidence from the skills.
  3. **THIS WEEK'S ACTIONS** — 3–5 specific, named actions that directly address
     the goal. Not generic findings — named deals, named reps, specific asks.

This is a **surgical change to one function** in `runtime.ts`. Everything else —
skill execution, evidence accumulation, caching, delivery, scheduling — is
completely unchanged.

---

## Before You Start

Read these files carefully before writing any code:

1. **`server/agents/runtime.ts`** — Find the synthesis step. It likely contains:
   - A function named `buildSynthesisPrompt()`, `synthesizeEvidence()`, or similar
   - A Claude call that receives accumulated skill evidence
   - A `prompt_template` field on the agent that may already be used
   Identify: the exact function name, its inputs, and where in `executeAgent()`
   it is called.

2. **`server/agents/types.ts`** — Confirm `goal`, `standing_questions`, and
   `created_from` exist on the Agent interface. If they don't (migration pending),
   add a TODO comment but write the code as if they do.

3. **`server/agents/seed-agents.ts`** — Look at what `synthesis.prompt_template`
   contains today for the 6 system agents. Understand the current prompt style so
   the new template is consistent in voice.

4. **`server/skills/types.ts`** — Understand `SkillEvidence`, `Claim`, and
   `AgentOutput`. The synthesis function receives evidence from multiple skills —
   confirm the exact shape it receives.

5. **`server/llm-client.ts`** (or equivalent) — Confirm the calling convention
   for Claude synthesis calls. Use the exact same pattern.

**The existing pipeline execution flow in `executeAgent()` MUST NOT CHANGE.**
You are modifying the synthesis prompt construction only. Skill execution, evidence
accumulation, staleness checks, delivery, and scheduling are untouched.

---

## Task 1: Add the Goal-Aware Branch in buildSynthesisPrompt()

Find the function that builds the synthesis prompt (whatever it's called in your
codebase). Add a branch at the top:

```typescript
function buildSynthesisPrompt(
  agent: Agent,
  evidence: AgentOutput,         // or whatever type the function currently receives
  context: BusinessContext,      // or whatever context object exists
): string {

  // ── NEW: Goal-aware path ──────────────────────────────────────────────────
  // If the agent has a goal AND at least one standing question,
  // use the structured Q&A template instead of the findings dump.
  if (agent.goal && agent.standing_questions?.length > 0) {
    return buildGoalAwareSynthesisPrompt(agent, evidence, context);
  }

  // ── EXISTING: Default findings dump (unchanged) ───────────────────────────
  // Everything below this line stays exactly as it is today.
  // ... existing code ...
}
```

That's the only change to the existing function — one guard clause at the top.

---

## Task 2: New Function — buildGoalAwareSynthesisPrompt()

Add this function to `runtime.ts` (or a new file `server/agents/synthesis.ts`
if runtime.ts is already large — your judgment based on file size).

```typescript
/**
 * Builds a goal-aware synthesis prompt for agents that have a defined mandate
 * and standing questions. Produces structured output: Status → Q&A → Actions.
 *
 * This is Claude's prompt — it must be specific, evidence-grounded, and
 * unambiguous about what format to produce. Do not write vague instructions.
 */
function buildGoalAwareSynthesisPrompt(
  agent: Agent,
  evidence: AgentOutput,
  context: BusinessContext,
): string {

  // ── Compress claims for injection ─────────────────────────────────────────
  // We're sending this to Claude. Follow the compute-first principle:
  // never send raw arrays. Compress to a structured summary.
  const claimsBySkill = compressEvidenceForSynthesis(evidence);

  // ── Build standing questions block ────────────────────────────────────────
  const questionsBlock = agent.standing_questions
    .map((q, i) => `Q${i + 1}: ${q}`)
    .join('\n');

  // ── Build the prompt ──────────────────────────────────────────────────────
  return `You are a VP of Revenue Operations delivering a recurring briefing to your leadership team.

YOUR MANDATE:
${agent.goal}

BUSINESS CONTEXT:
${formatBusinessContext(context)}

SKILL FINDINGS:
${claimsBySkill}

---

Produce a briefing with exactly this structure. Do not add sections, do not
reorder sections, do not combine sections.

## STATUS AGAINST GOAL
2–3 sentences. Answer directly: are we on track to achieve "${agent.goal}"?
- Start with a verdict: "On track.", "At risk.", or "Behind."
- Follow with the single most important piece of supporting evidence.
- End with one sentence on what changed since the last run. If no prior run
  data exists, omit this sentence entirely — do not mention that it's missing.

## STANDING QUESTIONS
Answer each question below using evidence from the skill findings.
Use specific deal names, rep names, and dollar amounts. Do not generalize.
If the evidence is insufficient to answer a specific question, write one
sentence saying what data would be needed — do not speculate.

${questionsBlock}

Format: bold the question, then answer in 2–4 sentences directly below it.

## THIS WEEK'S ACTIONS
List 3–5 actions. Each action must:
- Name the specific person, deal, or system involved
- State the exact action to take (not "review" or "consider" — "close", "call",
  "require", "configure")
- Connect directly to the goal: "${agent.goal}"

Format: numbered list. No sub-bullets.

---

RULES:
- Every claim must be traceable to the skill findings above. No invented data.
- Dollar amounts and percentages must come directly from the evidence.
- If a standing question cannot be answered from the evidence, say so plainly.
  Do not hedge with "it appears" or "it seems" — either you have the data or you don't.
- Actions must be specific enough that a RevOps analyst could execute them
  tomorrow without asking a follow-up question.
- Total word count: ${computeWordBudget(evidence)} words maximum.`;
}
```

---

## Task 3: compressEvidenceForSynthesis()

This function converts `AgentOutput` (which may contain large evidence objects)
into a compact string Claude can reason over. Follow the compute-first principle
strictly — Claude never sees raw arrays.

```typescript
/**
 * Compress multi-skill evidence into a structured summary for the synthesis prompt.
 *
 * Output format (per skill):
 *   ### Pipeline Hygiene
 *   - 14 deals missing next steps ($1.2M affected)
 *   - 3 deals stale 30+ days (Jordan: 2, Maria: 1)
 *   - Critical: Acme Corp ($340K) — no activity 47 days, in commit
 *   ...
 *
 * Rules:
 * - Maximum 5 claims per skill
 * - Prioritize: critical severity first, then warning, then info
 * - Include dollar amounts and rep names where present in the claim
 * - Hard cap: 3,000 chars total across all skills
 *   If over cap, truncate lower-severity claims (never truncate critical)
 */
function compressEvidenceForSynthesis(evidence: AgentOutput): string {
  const sections: string[] = [];

  for (const [skillId, skillEvidence] of Object.entries(evidence.skill_evidence)) {
    const skillName = formatSkillName(skillId);  // 'pipeline-hygiene' → 'Pipeline Hygiene'
    const claims = skillEvidence.claims ?? [];

    if (claims.length === 0) continue;

    // Sort: critical → warning → info
    const sorted = [...claims].sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 };
      return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
    });

    // Take top 5
    const topClaims = sorted.slice(0, 5);

    const claimLines = topClaims.map(c => {
      const prefix = c.severity === 'critical' ? '⚠' : c.severity === 'warning' ? '•' : '–';
      return `${prefix} ${c.message}`;
    });

    sections.push(`### ${skillName}\n${claimLines.join('\n')}`);
  }

  let result = sections.join('\n\n');

  // Hard cap at 3,000 chars — truncate from end, never mid-section
  if (result.length > 3000) {
    result = result.slice(0, 3000) + '\n... [additional findings truncated]';
  }

  return result || '(No findings from skill runs)';
}
```

---

## Task 4: computeWordBudget()

Dynamic word budget based on number of standing questions and delivery format.
More questions = more words allowed. Slack delivery = tighter budget.

```typescript
function computeWordBudget(evidence: AgentOutput): number {
  // Base: 400 words
  // +80 words per standing question (to allow real answers, not one-liners)
  // Adjust for delivery format if available
  const questionCount = Object.keys(evidence).length;  // adapt to actual shape
  return 400 + (questionCount * 80);
}

// NOTE: If `agent` is accessible in this scope, use agent.standing_questions.length
// instead of inferring from evidence. Adjust the signature if needed.
// Target ranges:
//   3 questions → ~640 words
//   5 questions → ~800 words
//   0 questions → 400 words (shouldn't reach this function but safe default)
```

---

## Task 5: formatBusinessContext()

If a `formatBusinessContext()` helper already exists in `runtime.ts`, use it.
If not, write a minimal one that extracts the fields Claude needs most:

```typescript
function formatBusinessContext(context: BusinessContext): string {
  const lines: string[] = [];

  // These field names are illustrative — adapt to the actual BusinessContext shape
  if (context.quota)           lines.push(`Team quota: ${formatCurrency(context.quota)}`);
  if (context.closed_won)      lines.push(`Closed-won to date: ${formatCurrency(context.closed_won)}`);
  if (context.days_remaining)  lines.push(`Days remaining in quarter: ${context.days_remaining}`);
  if (context.coverage_target) lines.push(`Coverage target: ${context.coverage_target}x`);
  if (context.team_size)       lines.push(`Team size: ${context.team_size} reps`);

  return lines.length > 0
    ? lines.join('\n')
    : '(Business context not configured for this workspace)';
}
```

---

## Task 6: Store Synthesis Output on AgentRun

The detail page diff view (future) requires the synthesis output to be stored
per run. Confirm whether `agent_runs` table has a `synthesis_output` column.

Check the `agent_runs` migration. If `synthesis_output TEXT` does not exist:

```sql
-- Add to the next migration (or create a new one):
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS synthesis_output TEXT;

-- Also add a column to track which synthesis path was used:
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS synthesis_mode TEXT
  DEFAULT 'findings_dump'
  CHECK (synthesis_mode IN ('findings_dump', 'goal_aware'));
```

After the synthesis call returns, store the output:

```typescript
// In executeAgent(), after the synthesis Claude call:
await db
  .update(agentRuns)
  .set({
    synthesis_output: synthesisResult.content,
    synthesis_mode: (agent.goal && agent.standing_questions?.length > 0)
      ? 'goal_aware'
      : 'findings_dump',
  })
  .where(eq(agentRuns.id, runId));
```

If the table or column doesn't exist yet, add a TODO comment and skip the
persistence — don't block the synthesis from running.

---

## Task 7: Seed Agent Updates

The 6 system agents in `seed-agents.ts` currently have no `goal` or
`standing_questions`. They should. Update each with domain-appropriate values.

**Important:** Do NOT remove or change any existing fields. Only ADD the new fields.

```typescript
// Agent 1: Monday Pipeline Operator
goal: 'Ensure every deal in the active pipeline has a credible close date, ' +
      'an assigned next step, and adequate multi-threading before each week begins.',
standing_questions: [
  'Which deals advanced or regressed in stage this week?',
  'Which reps have pipeline below 3x coverage?',
  'Which deals in commit have had no activity in 14+ days?',
],

// Agent 2: Forecast Call Prep
goal: 'Deliver an accurate, risk-adjusted forecast snapshot before the ' +
      'leadership call so every number can be defended with evidence.',
standing_questions: [
  'What is the current base case, bear case, and bull case for the quarter?',
  'Which deals changed forecast category since the last run?',
  'Which commit deals have risk signals that could cause them to slip?',
],

// Agent 3: Weekly Forecast (Friday)
goal: 'Summarize the week\'s pipeline movement and give the team a clear ' +
      'picture of where the quarter stands heading into the weekend.',
standing_questions: [
  'What is the gap to quota and is the current run rate sufficient?',
  'Which reps are on track vs. at risk of missing quarter?',
  'What are the top 3 deals that will determine whether we hit the number?',
],

// Agent 4: Daily Lead Alert
goal: 'Surface A-grade prospects every morning so the team contacts them ' +
      'while intent signals are still active.',
standing_questions: [
  'Which new A-grade leads appeared since yesterday?',
  'Which high-fit accounts have gone cold and need re-engagement?',
],

// Agent 5: GTM Blueprint
goal: 'Produce a complete, evidence-backed analysis of ICP fit, pipeline ' +
      'health, and data quality so the team can make informed GTM decisions.',
standing_questions: [
  'Who are our highest-fit prospects and what patterns define them?',
  'Where are the biggest data quality gaps affecting our ability to forecast?',
  'What does the pipeline look like for each ICP segment?',
],

// Agent 6: Instant Audit (on connect)
goal: 'Surface the most critical pipeline and data quality issues within ' +
      'the first hour of CRM connection so the team can start acting immediately.',
standing_questions: [
  'What are the top 5 most urgent pipeline hygiene issues?',
  'What percentage of deals are missing required fields?',
  'Which deals are most at risk of being lost due to neglect?',
],
```

---

## Task 8: Unit Test

Add to `server/agents/__tests__/runtime.test.ts`
(or create the file if it doesn't exist).

Mock the Claude call — do not make real API calls in tests.

```typescript
describe('buildGoalAwareSynthesisPrompt', () => {

  const mockAgent = {
    id: 'test-agent',
    name: 'Weekly Pipeline Review',
    goal: 'Ensure pipeline is healthy and on track to hit Q1 quota of $2.1M.',
    standing_questions: [
      'Which deals moved out of commit since last week?',
      'Which reps are below 3x coverage?',
      'What is the gap to quota and is the run rate sufficient?',
    ],
    // ... other required agent fields with sensible defaults
  };

  const mockEvidence = {
    skill_evidence: {
      'pipeline-hygiene': {
        claims: [
          { severity: 'critical', message: 'Acme Corp ($340K) — no activity 47 days' },
          { severity: 'warning',  message: '14 deals missing next steps' },
        ],
      },
      'forecast-rollup': {
        claims: [
          { severity: 'warning', message: 'Base case $1.85M — $250K below quota' },
          { severity: 'info',    message: 'Run rate $143K/wk vs required $187K/wk' },
        ],
      },
    },
    all_claims: [],
  };

  const mockContext = {
    quota: 2100000,
    closed_won: 1350000,
    days_remaining: 28,
    coverage_target: 3.0,
  };

  it('includes the goal in the prompt', () => {
    const prompt = buildGoalAwareSynthesisPrompt(mockAgent as any, mockEvidence as any, mockContext as any);
    expect(prompt).toContain(mockAgent.goal);
  });

  it('includes all standing questions', () => {
    const prompt = buildGoalAwareSynthesisPrompt(mockAgent as any, mockEvidence as any, mockContext as any);
    for (const q of mockAgent.standing_questions) {
      expect(prompt).toContain(q);
    }
  });

  it('includes STATUS AGAINST GOAL section header', () => {
    const prompt = buildGoalAwareSynthesisPrompt(mockAgent as any, mockEvidence as any, mockContext as any);
    expect(prompt).toContain('STATUS AGAINST GOAL');
  });

  it('includes THIS WEEK\'S ACTIONS section header', () => {
    const prompt = buildGoalAwareSynthesisPrompt(mockAgent as any, mockEvidence as any, mockContext as any);
    expect(prompt).toContain('THIS WEEK\'S ACTIONS');
  });

  it('includes compressed evidence from both skills', () => {
    const prompt = buildGoalAwareSynthesisPrompt(mockAgent as any, mockEvidence as any, mockContext as any);
    expect(prompt).toContain('Pipeline Hygiene');
    expect(prompt).toContain('Forecast Rollup');
    expect(prompt).toContain('Acme Corp');
  });

  it('stays within 3,000 char evidence cap', () => {
    // Build evidence with 50 claims per skill to stress-test compression
    const largeEvidence = {
      skill_evidence: {
        'pipeline-hygiene': {
          claims: Array.from({ length: 50 }, (_, i) => ({
            severity: 'warning',
            message: `Deal ${i} — missing next step — value $${i * 10000}`,
          })),
        },
      },
      all_claims: [],
    };
    const compressed = compressEvidenceForSynthesis(largeEvidence as any);
    expect(compressed.length).toBeLessThanOrEqual(3100); // small buffer for truncation message
  });

});

describe('synthesis path selection', () => {

  it('uses goal-aware path when agent has goal + questions', () => {
    const agent = { goal: 'Hit quota', standing_questions: ['Q1?', 'Q2?'] };
    // buildSynthesisPrompt should call buildGoalAwareSynthesisPrompt
    // Test by checking the output contains STATUS AGAINST GOAL
    const prompt = buildSynthesisPrompt(agent as any, {} as any, {} as any);
    expect(prompt).toContain('STATUS AGAINST GOAL');
  });

  it('uses findings-dump path when agent has no goal', () => {
    const agent = { goal: undefined, standing_questions: [] };
    const prompt = buildSynthesisPrompt(agent as any, {} as any, {} as any);
    expect(prompt).not.toContain('STATUS AGAINST GOAL');
  });

  it('uses findings-dump path when agent has goal but no questions', () => {
    const agent = { goal: 'Hit quota', standing_questions: [] };
    const prompt = buildSynthesisPrompt(agent as any, {} as any, {} as any);
    expect(prompt).not.toContain('STATUS AGAINST GOAL');
  });

});
```

---

## Validation Checklist

After building, verify:

1. **Existing agent runs unchanged** — run the Monday Pipeline Operator (no goal
   set yet) and confirm output format is identical to before this change.

2. **Goal-aware path triggers** — add `goal` and `standing_questions` to the
   Pipeline State agent manually, run it, confirm output has STATUS / Q&A /
   ACTIONS sections.

3. **Evidence compression** — log the compressed evidence block before the Claude
   call. Confirm it's under 3,000 chars and contains claims from all skills.

4. **Word budget enforced** — the prompt contains a `words maximum` instruction
   and the number is dynamic (not hardcoded to a single value).

5. **Insufficient evidence handled** — if a standing question can't be answered
   from the evidence, Claude should say so plainly. Verify by running with a skill
   that produces no claims for the relevant question topic.

6. **synthesis_output stored** — after a goal-aware run, query `agent_runs` table
   and confirm `synthesis_output` is populated and `synthesis_mode = 'goal_aware'`.

7. **Unit tests pass** without hitting the Claude API.

8. **Seed agent updates** — after reseeding, confirm all 6 agents have `goal` and
   `standing_questions` populated in the DB.

---

## What NOT to Change

- `executeAgent()` orchestration flow
- Skill execution and evidence accumulation
- Evidence freshness / staleness checks
- Delivery (Slack, email, PDF)
- Scheduling / cron
- The 6 existing synthesis prompt templates (they become the fallback for agents
  without a goal — do not delete them)
- Any renderer (Slack blocks, workbook, PDF)
- Token tracking or LLM routing

---

## Token Budget

| Step | Who | Tokens |
|------|-----|--------|
| Evidence compression | none (pure JS) | 0 |
| Goal-aware synthesis prompt | Claude (reason) | ~2,500 in / ~800 out |
| Findings-dump synthesis (existing) | Claude (reason) | unchanged |
| **Delta per goal-aware run vs existing** | | ~+300 tokens |

The only meaningful token delta is the additional prompt structure (~300 tokens).
The evidence input is actually smaller than the existing approach because
`compressEvidenceForSynthesis()` is more aggressive than whatever compression
exists today.

---

## File Summary

| File | Action |
|------|--------|
| `server/agents/runtime.ts` | MODIFY — add goal-aware branch, add 3 new helper functions |
| `server/agents/synthesis.ts` | CREATE (optional) — if runtime.ts is large, extract helpers here |
| `server/agents/seed-agents.ts` | MODIFY — add goal + standing_questions to all 6 agents |
| `server/agents/__tests__/runtime.test.ts` | CREATE/MODIFY — add 8 unit tests |
| Next migration file | MODIFY — add synthesis_output + synthesis_mode to agent_runs |
