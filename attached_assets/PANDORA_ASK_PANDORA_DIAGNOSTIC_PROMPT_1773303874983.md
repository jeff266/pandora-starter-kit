# Pandora — Diagnostic: Three Items from Ask Pandora Testing

## Item 1: `calculate` Tool Date Arithmetic Errors

During testing, the `calculate` tool throws errors on date expressions like:
```
expression: Math.floor((new Date('2026-03-12') - new Date('2026-02-05')) / 86400000)
description: Days since last activity
```

**Step 1 — Find the calculate tool implementation**

In `server/chat/data-tools.ts`, find the `case 'calculate':` handler. Report:
- How does it evaluate the expression? (`eval()`, `Function()`, a math library, something else?)
- What JavaScript context does the expression run in? Does it have access to `Date`, `Math`, etc.?
- What does the error message say exactly when it fails?

**Step 2 — Fix the date arithmetic**

The most likely cause: the expression evaluator doesn't have access to `Date` constructor, or the result of `new Date() - new Date()` returns NaN in the evaluation context.

Fix options in priority order:

**Option A (preferred):** If using `eval()` or `Function()`, ensure `Date` is available:
```typescript
// Replace bare eval with a sandboxed function that has Date in scope:
const fn = new Function('Date', 'Math', `return ${expression}`);
const result = fn(Date, Math);
```

**Option B:** Pre-process date expressions before evaluation. Detect patterns like `new Date('...')` and substitute millisecond timestamps before passing to the evaluator:
```typescript
// Replace new Date('2026-03-12') with its ms value before eval
const processed = expression.replace(
  /new Date\('(\d{4}-\d{2}-\d{2})'\)/g,
  (_, dateStr) => new Date(dateStr).getTime().toString()
);
```

**Option C:** Add a `date_diff_days` helper that Claude can call explicitly:
```typescript
// If expression contains 'date_diff', route to a helper:
if (expression.includes('date_diff')) {
  // parse and compute directly
}
```

After fixing, verify these expressions work:
```javascript
Math.floor((new Date('2026-03-12') - new Date('2026-02-05')) / 86400000)  // → 35
new Date('2026-04-01') - new Date('2026-03-12')  // → ms value
Math.round(1421560 / 1980481 * 100)  // → 71 (pure math, should already work)
```

---

## Item 2: "Save as Recurring Agent?" Prompt

At the bottom of the Q2 pipeline review response, a prompt appeared:
> "💡 Looks like a recurring workflow — Save this as a recurring Agent?"

**Step 1 — Find where this is generated**

Search for "recurring" or "Save this as a recurring Agent" in the codebase. Report:
- Which file generates this prompt?
- What logic triggers it (how does it detect "recurring workflow")?
- Is the "Save" action wired to anything, or is it a placeholder?

**Step 2 — Wire it if it's a placeholder**

If clicking "Save" doesn't do anything, wire it to create an agent via the existing Agent Builder:

```typescript
// On "Save as Agent" click:
POST /agents {
  name: "Q2 Pipeline Review",          // derived from conversation topic
  description: "Weekly Q2 pipeline analysis — coverage, rep performance, stale deals, stage bottlenecks",
  skill_ids: [...],                     // extract from tools used in this conversation
  goal: "Analyze Q2 pipeline health and surface execution risks",
  is_active: true
}
// On success: navigate to Agent Builder with the new agent pre-loaded
// Or: show toast "Agent created → [View in Agent Builder]"
```

The tool calls from the conversation (stored in the chain of thought) provide the skill list automatically — `query_deals`, `compute_metric`, `compute_metric_segmented`, `compute_stage_benchmarks`, etc. map to existing skill IDs.

If wiring the full agent creation is complex, a simpler path: clicking "Save" opens the Agent Builder with the conversation transcript pre-loaded as the seed conversation, and the user completes the setup manually.

**Step 3 — Improve the trigger logic**

Report what currently triggers the "recurring workflow" detection. If it's too aggressive (fires on every response) or too passive (never fires), adjust the threshold:

Suggested trigger conditions (ALL must be true):
- Response used 8+ tool calls
- Response contains at least one of: pipeline, forecast, review, weekly, Q1/Q2/Q3/Q4
- User has not already saved this conversation as an agent

---

## Item 3: "Export as Document" Button

The "Export as Document" button appears below complex responses (ABS Kids analysis, Q2 pipeline review).

**Step 1 — Find the implementation**

Search for "Export as Document" in the client codebase. Report:
- Which component renders this button?
- What happens when it's clicked? Is it wired to an endpoint, or a placeholder?
- If wired: what format does it produce and where does the file go?

**Step 2 — Wire it if it's a placeholder**

If not wired, connect it to the document assembler that already exists:

```typescript
// On "Export as Document" click:
POST /documents/generate {
  type: 'conversation_export',
  title: "ABS Kids Deal Analysis — March 12",   // derived from conversation topic + date
  content: {
    question: conversationTurn.userMessage,
    answer: conversationTurn.assistantMessage,
    tool_calls: conversationTurn.toolProgress,   // the chain of thought
    generated_at: new Date().toISOString()
  },
  format: 'docx'
}
// Returns: { download_url: string }
// On success: trigger download or open in new tab
```

If the document assembler doesn't support `conversation_export` type, add a simple template:
- Title: user's question
- Body: Pandora's answer (formatted prose)
- Appendix: Chain of thought (tool calls + results, collapsed by default)
- Footer: Generated by Pandora · [timestamp]

If DOCX generation is complex to add, a simpler fallback: format the conversation as HTML and trigger a browser print-to-PDF. This requires no new backend code.

**Step 3 — Add format options**

Once wired, add a small dropdown on the button:
```
[Export as Document ▼]
  → Word Document (.docx)
  → PDF
  → Copy as Markdown
```

"Copy as Markdown" is the easiest to implement — just copy the response text to clipboard with markdown formatting preserved.

---

## Exit Criteria

- `calculate` tool handles date expressions without errors — `Math.floor((new Date('2026-03-12') - new Date('2026-02-05')) / 86400000)` returns `35`
- "Save as recurring Agent?" button creates an agent or opens Agent Builder with conversation pre-loaded
- "Export as Document" button produces a downloadable file (DOCX, PDF, or triggers print dialog)
- All three changes committed and working in Frontera workspace
