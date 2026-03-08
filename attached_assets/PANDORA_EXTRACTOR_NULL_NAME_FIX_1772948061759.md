# Claude Code Prompt: Extraction Engine — Null Name on Low Confidence

## Context

`generateAgentName()` in `server/chat/conversation-extractor.ts` currently
always returns a string. When extraction confidence is low (goal empty, topic
unclear), it falls back to `"Weekly Business Review"` — a generic name that
gets shown in the banner as if Pandora detected something specific. That's
misleading.

The fix: return `null` when the name can't be meaningfully derived, and let
the banner show generic copy instead of a wrong guess.

---

## Changes Required

### 1. `generateAgentName()` — change return type to `string | null`

```typescript
// Before:
export function generateAgentName(
  goal: string,
  schedule: ScheduleSuggestion,
  messages: ChatMessage[]
): string

// After:
export function generateAgentName(
  goal: string,
  schedule: ScheduleSuggestion,
  messages: ChatMessage[]
): string | null
```

Change the fallback at the bottom of the function:

```typescript
// Before (always returns a string):
const fallback = cadence ? `${cadence} Business Review` : 'GTM Review';
return fallback.slice(0, 40);

// After (returns null when no meaningful topic detected):
return null;
```

The function should only return a non-null string when a `TOPIC_KEYWORDS`
pattern actually matched. If nothing matched, return `null`. The cadence +
"Business Review" fallback was the only case where nothing matched — remove
it entirely.

---

### 2. `extractAgentFromConversation()` — propagate null

```typescript
// The suggested_name field in ConversationExtractionResult:
// Before:
suggested_name: string;

// After:
suggested_name: string | null;
```

In the orchestrator function body:

```typescript
// Before:
const suggestedName = generateAgentName(extracted.goal, suggestedSchedule, messages);

// After:
const suggestedName = confidence === 'low'
  ? null
  : generateAgentName(extracted.goal, suggestedSchedule, messages);
// If confidence is low, skip name generation entirely — return null directly.
// If confidence is medium/high, generate the name but it may still be null
// if no topic keyword matched.
```

---

### 3. `ConversationExtractionResult` type

```typescript
// Update:
suggested_name: string | null;   // null when topic could not be determined
```

---

### 4. Update the two failing unit tests

`generateAgentName` tests that currently expect a string fallback need updating:

```typescript
// Find any test that asserts generateAgentName returns "Weekly Business Review"
// or any generic fallback string when no topic matches.
// Change the assertion to expect null instead.

it('returns null when no topic keyword matches', () => {
  const schedule = DEFAULT_SCHEDULE;
  const msgs = [{ role: 'user', content: 'just chatting' }];
  const name = generateAgentName('', schedule, msgs as any);
  expect(name).toBeNull();
});
```

---

## What NOT to Change

- The endpoint response shape — `suggested_name: null` is valid JSON and the
  frontend already handles it (the banner checks `suggestedName` before showing
  the specific copy).
- `inferSchedule`, `inferDelivery`, `detectInvokedSkills` — untouched.
- The confidence override logic in `computeFinalConfidence` — untouched.
- The DeepSeek extraction call — untouched.

---

## Validation

1. Call `generateAgentName('', DEFAULT_SCHEDULE, [])` → returns `null`.
2. Call `generateAgentName('ensure forecast accuracy', FRIDAY_SCHEDULE, [{role:'user', content:'forecast'}])` → returns `"Friday Forecast Brief"`.
3. Call `extractAgentFromConversation()` with a low-signal 2-message conversation
   → `suggested_name` is `null` in the response.
4. All 31 existing tests still pass (only the generic-fallback test changes).
