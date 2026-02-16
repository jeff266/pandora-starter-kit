# End-to-End Test: Feedback & Learning System

## Context

The Feedback & Learning System was just built. Before moving on, run this automated test that validates the full chain: chat correction → workspace annotation → dossier integration → skill synthesis. Use real workspace data if available, or create minimal test fixtures.

**Build and run a test script** (`server/tests/e2e-feedback-learning.ts` or `.js`) that exercises every integration point. The script should be runnable via `npx ts-node server/tests/e2e-feedback-learning.ts` or a test route `GET /api/test/feedback-e2e` (protected, non-production).

Print results as a clear pass/fail summary at the end.

---

## Setup

Before running tests, ensure you have a workspace with:
- At least one deal (use existing Frontera data, or insert a test deal)
- At least one finding in the findings table for that deal
- The chat endpoint functional

If no real data exists, create test fixtures at the start of the script and clean them up at the end.

```typescript
// Test fixtures (create if needed, clean up after)
const TEST_PREFIX = 'E2E_TEST_';
let testWorkspaceId: string; // Use existing workspace
let testDealId: string;
let testDealName: string;
let testAccountId: string;
let testFindingId: string;
```

---

## Test Chain 1: Correction → Annotation → Dossier

### Test 1.1: Record a correction via API
```
POST /api/workspaces/:id/annotations
{
  entityType: "deal",
  entityId: testDealId,
  entityName: testDealName,
  annotationType: "correction",
  content: "E2E_TEST: Deal is paused for board approval — expect 3 week delay",
  source: "chat",
  sourceThreadId: "e2e-test-thread-001"
}

ASSERT:
- Response status 200/201
- Response has id and expiresAt
- expiresAt is ~90 days from now (±1 day)
```

### Test 1.2: Verify annotation persisted
```
GET /api/workspaces/:id/annotations?entityType=deal&entityId={testDealId}

ASSERT:
- Response includes the annotation from 1.1
- annotation_type = "correction"
- content matches
- resolved_at is NULL
```

### Test 1.3: Verify annotation appears in deal dossier
```
GET /api/workspaces/:id/deals/{testDealId}/dossier

ASSERT:
- Response has an "annotations" or "teamNotes" field
- That field contains the correction from 1.1
- hasUserContext = true (or equivalent flag)
```

### Test 1.4: Verify annotation appears in account dossier (if deal has account)
```
GET /api/workspaces/:id/accounts/{testAccountId}/dossier

ASSERT:
- Response includes deal-level annotations for deals belonging to this account
  OR the annotation appears under the account's annotation section
```

---

## Test Chain 2: Feedback Signals (Thumbs Up/Down)

### Test 2.1: Record thumbs up
```
POST /api/workspaces/:id/feedback
{
  targetType: "chat_response",
  targetId: "e2e-test-response-001",
  signalType: "thumbs_up",
  metadata: {}
}

ASSERT:
- Response status 200/201
- Response has id and recorded: true
```

### Test 2.2: Replace with thumbs down (upsert behavior)
```
POST /api/workspaces/:id/feedback
{
  targetType: "chat_response",
  targetId: "e2e-test-response-001",
  signalType: "thumbs_down",
  metadata: { reason: "too verbose" }
}

ASSERT:
- Response status 200/201

Then verify:
SELECT COUNT(*) FROM feedback_signals 
WHERE target_id = 'e2e-test-response-001'

ASSERT: count = 1 (upsert replaced, not duplicated)
ASSERT: signal_type = 'thumbs_down' (updated, not 'thumbs_up')
```

### Test 2.3: Record finding confirmation
```
POST /api/workspaces/:id/feedback
{
  targetType: "finding",
  targetId: testFindingId,
  signalType: "confirm",
  metadata: {}
}

ASSERT:
- Response status 200/201
```

### Test 2.4: Record finding dismissal
```
POST /api/workspaces/:id/feedback
{
  targetType: "finding",
  targetId: testFindingId,
  signalType: "dismiss",
  metadata: { severity: "warning", category: "stale_deal" }
}

ASSERT:
- Response status 200/201
```

---

## Test Chain 3: Dismiss Velocity → ConfigSuggestion

### Test 3.1: Bulk dismiss findings to trigger velocity detection
```
// Create 12 dismiss signals to cross the threshold
for (let i = 0; i < 12; i++) {
  POST /api/workspaces/:id/feedback
  {
    targetType: "finding",
    targetId: `e2e-test-finding-${i}`,
    signalType: "dismiss",
    metadata: { severity: "info", category: "stale_deal" }
  }
}

// Now trigger the velocity check
// Either call the dismiss velocity function directly,
// or hit whatever endpoint/function runs after dismissals accumulate

ASSERT:
- A ConfigSuggestion was created (or already existed)
- Check: GET /api/workspaces/:id/config/suggestions?status=pending
- At least one suggestion should reference 'feedback-system' as source_skill
  OR reference dismiss patterns in its message
```

### Test 3.2: Accept the ConfigSuggestion
```
// Get the suggestion ID from 3.1
GET /api/workspaces/:id/config/suggestions?status=pending

// Accept it
POST /api/workspaces/:id/config/suggestions/{suggestionId}/accept

ASSERT:
- Response status 200
- Suggestion status is now 'accepted'
- Re-fetch: GET /api/workspaces/:id/config/suggestions?status=pending
  → The accepted suggestion should no longer appear in pending list
```

---

## Test Chain 4: Chat Integration (Implicit Feedback Detection)

### Test 4.1: Send a question, then a confirmation
```
// Turn 1: Ask a question
POST /api/workspaces/:id/chat  (or whatever the chat endpoint is)
{
  message: "How many stale deals do we have?",
  threadId: "e2e-test-thread-002"
}

ASSERT:
- Response has responseId
- Response has feedbackEnabled (true for LLM, may be false for heuristic)

// Turn 2: Confirm the response
POST /api/workspaces/:id/chat
{
  message: "That's right, thanks",
  threadId: "e2e-test-thread-002"
}

ASSERT:
- System detected this as a confirmation
- Check feedback_signals table: should have a 'confirm' signal
  WHERE source_thread_id = 'e2e-test-thread-002' 
  OR target_id references the previous responseId
```

### Test 4.2: Send a correction in chat
```
// Turn 1: Ask about a deal
POST /api/workspaces/:id/chat
{
  message: "What's happening with {testDealName}?",
  threadId: "e2e-test-thread-003"
}

// Turn 2: Correct the response
POST /api/workspaces/:id/chat
{
  message: "Actually, that deal is on hold because their CEO left the company last week",
  threadId: "e2e-test-thread-003"
}

ASSERT:
- System detected this as a correction (check response or logs)
- Check workspace_annotations table:
  SELECT * FROM workspace_annotations
  WHERE workspace_id = testWorkspaceId
    AND source_thread_id = 'e2e-test-thread-003'
    AND annotation_type = 'correction'
  
  Should have at least one row
  Content should reference the CEO departure context
```

---

## Test Chain 5: Annotation → Skill Synthesis (The Money Test)

This is the most important test. Does a correction actually change skill output?

### Test 5.1: Verify annotation is available for skill context
```
// The annotation from Test 1.1 should be queryable:
GET /api/workspaces/:id/annotations/entity/deal/{testDealId}

ASSERT:
- Returns the "paused for board approval" annotation
- resolved_at is NULL
- expires_at is in the future
```

### Test 5.2: Call the scoped analysis endpoint about the annotated deal
```
POST /api/workspaces/:id/analyze  (or POST /api/workspaces/:id/chat)
{
  question: "What's the status of {testDealName}?",
  scope: { type: "deal", entity_id: testDealId }
}

ASSERT:
- Response mentions "board approval" or "paused" — 
  the annotation context should appear in the AI's response
- This proves annotations flow into the Claude synthesis prompt

NOTE: This test requires an actual LLM call. If running in a test
environment without LLM access, instead verify that the context
assembly step INCLUDES the annotation in its prompt. Check logs or
add a debug flag that returns the assembled prompt without calling Claude.
```

### Test 5.3: (Optional, if pipeline-hygiene can run) Run skill and check output
```
// If you can trigger a skill run:
POST /api/workspaces/:id/skills/pipeline-hygiene/run

// Then check the output:
GET /api/workspaces/:id/skills/pipeline-hygiene/runs?limit=1

ASSERT:
- If testDeal is flagged as stale in the output,
  the synthesis should mention the user-provided context
- Look for "board approval" or "user note" in the result text

NOTE: This is the gold standard test but requires real skill execution.
Skip if skill runs are expensive or slow in the test environment.
```

---

## Test Chain 6: Learning Dashboard

### Test 6.1: Verify summary endpoint returns test data
```
GET /api/workspaces/:id/learning/summary
  (or GET /api/workspaces/:id/feedback/summary)

ASSERT:
- totalSignals > 0 (from our test signals above)
- byType.thumbs_down >= 1
- byType.confirm >= 1
- byType.dismiss >= 12
- activeAnnotations >= 1
- byWeek has at least one entry with count > 0
```

---

## Test Chain 7: Annotation Expiry

### Test 7.1: Create a pre-expired annotation and verify cleanup
```
// Insert an annotation with expires_at in the past
INSERT INTO workspace_annotations (
  workspace_id, entity_type, entity_id, entity_name,
  annotation_type, content, source, 
  created_at, expires_at
) VALUES (
  testWorkspaceId, 'deal', testDealId, 'E2E Expired Test',
  'context', 'E2E_TEST: This should be cleaned up', 'chat',
  NOW() - INTERVAL '100 days', NOW() - INTERVAL '1 day'
)
RETURNING id;

// Run the cleanup function (call it directly or trigger the cron handler)
// cleanupExpiredAnnotations() or equivalent

ASSERT:
- The annotation now has resolved_at set
- It no longer appears in: GET /api/workspaces/:id/annotations?active=true
```

---

## Cleanup

After all tests, remove test data:

```sql
DELETE FROM workspace_annotations WHERE content LIKE 'E2E_TEST:%';
DELETE FROM feedback_signals WHERE target_id LIKE 'e2e-test-%';
-- Remove any test ConfigSuggestions generated by dismiss velocity
-- Remove test chat threads if created
```

---

## Summary Report

Print a clear summary:

```
========================================
FEEDBACK & LEARNING SYSTEM — E2E RESULTS
========================================

Chain 1: Correction → Annotation → Dossier
  1.1 Record correction via API:        ✅/❌
  1.2 Annotation persisted:             ✅/❌
  1.3 Annotation in deal dossier:       ✅/❌
  1.4 Annotation in account dossier:    ✅/❌ (or SKIP if no account)

Chain 2: Feedback Signals
  2.1 Thumbs up recorded:               ✅/❌
  2.2 Upsert to thumbs down:            ✅/❌
  2.3 Finding confirmation:             ✅/❌
  2.4 Finding dismissal:                ✅/❌

Chain 3: Dismiss Velocity → ConfigSuggestion
  3.1 Bulk dismiss → suggestion created: ✅/❌
  3.2 Accept suggestion:                 ✅/❌

Chain 4: Chat Implicit Feedback
  4.1 Confirmation detection:            ✅/❌
  4.2 Correction → annotation:           ✅/❌

Chain 5: Annotation → Skill Synthesis
  5.1 Annotation available for skills:   ✅/❌
  5.2 Annotation appears in analysis:    ✅/❌ (or SKIP if no LLM)
  5.3 Annotation in skill output:        ✅/❌ (or SKIP if no skill run)

Chain 6: Learning Dashboard
  6.1 Summary endpoint populated:        ✅/❌

Chain 7: Annotation Expiry
  7.1 Expired annotation cleaned up:     ✅/❌

Cleanup: ✅/❌

TOTAL: X/Y passed
========================================
```

Run all tests, show me the results. Fix any failures and re-run until clean.
