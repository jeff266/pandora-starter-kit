## Internal Filter + CWD Implementation Summary

Implementation of internal meeting filter and Conversations Without Deals (CWD) detection for conversation intelligence.

**Spec:** `PANDORA_INTERNAL_FILTER_AND_CWD_SPEC.md`
**Status:** Core infrastructure complete, ready for linker integration and skill wiring

---

## What Was Implemented

### Part 1: Internal Meeting Filter

**Files Created:**
1. `server/analysis/conversation-internal-filter.ts` (350 lines)
2. `migrations/013_internal_filter.sql`

**Features:**
- ✅ Dual-layer detection (participant domain + title heuristics)
- ✅ Workspace domain resolution (3-strategy hierarchy)
- ✅ Batch classification for performance
- ✅ Decision matrix for classification
- ✅ Statistics and reporting functions

**Integration Points:**
- ✅ `conversation-features.ts` - Excludes internal meetings from:
  - Direct linking queries
  - Fuzzy account linking queries
  - Fuzzy contact linking queries
  - Coverage tier calculation

### Part 2: Conversations Without Deals (CWD)

**Files Created:**
3. `server/analysis/conversation-without-deals.ts` (450 lines)

**Features:**
- ✅ CWD detection with account enrichment
- ✅ Severity classification (high/medium/low)
- ✅ Likely cause inference
- ✅ Rep-level aggregation
- ✅ Report formatting utilities

---

## Architecture

### Internal Filter Decision Matrix

| All Participants Internal? | Title Matches Pattern? | Classification | Reason |
|---|---|---|---|
| Yes | Yes | `internal_meeting` | `all_internal_with_title_match` |
| Yes | No | `internal_meeting` | `all_participants_internal` |
| No | Yes | `external_call` | External participant overrides |
| No | No | `external_call` | Normal |

### Workspace Domain Resolution Strategy

```
1. Check workspace.settings.internal_domains
2. Infer from most common contact email domain (exclude gmail.com, yahoo.com, etc.)
3. If no domain resolved → skip internal filtering for this workspace
```

### CWD Severity Classification

**HIGH:**
- Demo/intro call with no deal created within 7+ days
- Multiple calls at account with zero deals
- Long call (>10 min) with 2+ participants

**MEDIUM:**
- Recent call (<7 days) - deal may still be getting created
- Account has other deals (call might relate to existing one)

**LOW:**
- Old call, short duration, or single participant
- Quick check-ins that don't warrant deals

---

## Database Changes

### Schema (Migration 013)

```sql
ALTER TABLE conversations ADD COLUMN is_internal BOOLEAN DEFAULT FALSE;
ALTER TABLE conversations ADD COLUMN internal_classification_reason TEXT;

CREATE INDEX idx_conversations_internal
  ON conversations(workspace_id, is_internal)
  WHERE is_internal = FALSE;
```

**Values for `internal_classification_reason`:**
- `'all_participants_internal'` - All participants have workspace domain
- `'all_internal_with_title_match'` - All internal + title pattern match
- `NULL` - Not internal

---

## Integration Guide

### For Linker (Replit)

**Phase 1: Add Internal Filter to Linker**

```typescript
import { classifyInternalMeeting, updateConversationInternalStatus } from './analysis/conversation-internal-filter';

// In linker, BEFORE Tier 3 (deal inference):
for (const conversation of conversations) {
  const classification = await classifyInternalMeeting(
    workspaceId,
    conversation.title,
    conversation.participants
  );

  // Update conversation table
  await updateConversationInternalStatus(conversation.id, classification);

  // Skip deal inference if internal
  if (classification.is_internal) {
    // Still set account_id if email match found (for CWD reporting)
    // Set link_method = 'internal_meeting'
    continue;
  }

  // Proceed to deal inference...
}
```

**Phase 2: Add CWD Detection Endpoint**

```typescript
import { findConversationsWithoutDeals } from './analysis/conversation-without-deals';

// GET /api/workspaces/:id/conversations/without-deals
router.get('/:workspaceId/conversations/without-deals', async (req, res) => {
  const { workspaceId } = req.params;
  const daysBack = parseInt(req.query.daysBack as string) || 90;

  const result = await findConversationsWithoutDeals(workspaceId, daysBack);

  res.json(result);
});
```

### For Skills (Claude Code)

**Data Quality Audit - Add Step 2.5:**

```typescript
// Step 2.5: audit-conversation-deal-coverage (COMPUTE)
import { findConversationsWithoutDeals, getTopCWDConversations } from './analysis/conversation-without-deals';

const cwdResult = await findConversationsWithoutDeals(workspaceId, 90);
const topExamples = getTopCWDConversations(cwdResult.conversations, 5);

// Add to skill output:
conversationCoverageGaps: {
  total: cwdResult.summary.total_cwd,
  high_severity: cwdResult.summary.by_severity.high,
  by_rep: cwdResult.summary.by_rep,
  examples: topExamples,
  estimated_pipeline_gap: cwdResult.summary.estimated_pipeline_gap
}
```

**Pipeline Coverage by Rep - Add Shadow Pipeline Metric:**

```typescript
import { getCWDByRep } from './analysis/conversation-without-deals';

// In Step 3 (gather-coverage-data):
const cwdResult = await findConversationsWithoutDeals(workspaceId, 90);
const cwdByRep = getCWDByRep(cwdResult.conversations);

// For each rep:
const repCWD = cwdByRep.get(rep.email);
rep.conversations_without_deals_count = repCWD?.cwd_count || 0;
rep.shadow_pipeline_estimate = repCWD?.high_severity_count || 0;
```

---

## API Functions

### Internal Filter

```typescript
// Classify single conversation
const classification = await classifyInternalMeeting(
  workspaceId: string,
  conversationTitle: string | null,
  participants: Participant[]
): Promise<InternalClassificationResult>

// Batch classify conversations
const results = await batchClassifyInternalMeetings(
  workspaceId: string,
  conversations: Array<{
    id: string;
    title: string | null;
    participants: Participant[];
  }>
): Promise<Map<string, InternalClassificationResult>>

// Get statistics
const stats = await getInternalMeetingStats(
  workspaceId: string
): Promise<{
  total_conversations: number;
  internal_meetings: number;
  external_calls: number;
  internal_percentage: number;
  by_classification_reason: Record<string, number>;
}>
```

### CWD Detection

```typescript
// Find all CWD
const result = await findConversationsWithoutDeals(
  workspaceId: string,
  daysBack?: number // default: 90
): Promise<CWDResult>

// Get top examples
const top = getTopCWDConversations(
  conversations: ConversationWithoutDeal[],
  limit?: number // default: 5
): ConversationWithoutDeal[]

// Get by rep
const byRep = getCWDByRep(
  conversations: ConversationWithoutDeal[]
): Map<string, RepCWDData>

// Format for reporting
const formatted = formatCWDForReport(
  cwd: ConversationWithoutDeal
): string
```

---

## Validation with Frontera Data

**Expected Results After Implementation:**

| Conversation | Current State | Expected After Filter |
|---|---|---|
| Frontera Fellowship | Unlinked | `is_internal = true`, reason: `all_internal_with_title_match` |
| RevOps Weekly Alignment | Linked to Sequoia Solutions | `is_internal = true`, reason: `all_internal_with_title_match` |
| Precious Care ABA - Clinical Demo | Account linked, no deal | CWD: severity HIGH, cause: `deal_not_created` |
| Helping Hands Behavior - Introduction | Account linked, no deal | CWD: severity HIGH, cause: `deal_not_created` |
| Guidepost ABA - Intros + Product Demo | Account linked, no deal | CWD: severity HIGH, cause: `deal_not_created` |
| Be You Behavior Therapy - Intro + Demo | Linked to deal | Not CWD (has deal) |
| Stepping Stone ABA - Follow-Up Demo | Linked to deal | Not CWD (has deal) |

---

## Testing

### Unit Tests (TODO)

```typescript
// test/analysis/conversation-internal-filter.test.ts
describe('Internal Filter', () => {
  it('should classify all-internal meeting correctly', async () => {
    // Test all-internal classification
  });

  it('should not classify mixed participants as internal', async () => {
    // Test external participant override
  });

  it('should resolve workspace domains', async () => {
    // Test domain resolution strategies
  });

  it('should detect title patterns', () => {
    // Test internal title pattern matching
  });
});

// test/analysis/conversation-without-deals.test.ts
describe('CWD Detection', () => {
  it('should find conversations without deals', async () => {
    // Test CWD query
  });

  it('should classify severity correctly', () => {
    // Test HIGH/MEDIUM/LOW classification
  });

  it('should infer likely cause', () => {
    // Test cause inference logic
  });

  it('should aggregate by rep', () => {
    // Test rep aggregation
  });
});
```

### Integration Test Script

```typescript
// test-internal-filter-frontera.ts
import { batchClassifyInternalMeetings } from './server/analysis/conversation-internal-filter';
import { findConversationsWithoutDeals } from './server/analysis/conversation-without-deals';
import { query } from './server/db';

const FRONTERA_WORKSPACE_ID = '<frontera-workspace-id>';

async function testFronteraClassification() {
  // Get all Frontera conversations
  const conversations = await query(
    `SELECT id, title, participants FROM conversations WHERE workspace_id = $1`,
    [FRONTERA_WORKSPACE_ID]
  );

  // Classify
  const results = await batchClassifyInternalMeetings(
    FRONTERA_WORKSPACE_ID,
    conversations.rows
  );

  console.log('Internal Meetings:');
  for (const [id, classification] of results) {
    if (classification.is_internal) {
      const conv = conversations.rows.find(c => c.id === id);
      console.log(`  ${conv.title}: ${classification.classification_reason}`);
    }
  }

  // Find CWD
  const cwdResult = await findConversationsWithoutDeals(FRONTERA_WORKSPACE_ID);

  console.log('\nConversations Without Deals:');
  console.log(`Total: ${cwdResult.summary.total_cwd}`);
  console.log(`High Severity: ${cwdResult.summary.by_severity.high}`);
  console.log('\nExamples:');
  for (const cwd of cwdResult.conversations.slice(0, 5)) {
    console.log(`  ${formatCWDForReport(cwd)}`);
  }
}

testFronteraClassification();
```

---

## Token Budget Impact

| Component | Additional Tokens | Notes |
|---|---|---|
| Internal filter (compute) | ~200 | One-time domain resolution + participant checks |
| CWD detection (compute) | ~500 | SQL query + enrichment joins |
| CWD in DeepSeek classification | ~400 | 3-5 high-severity items added to batch |
| CWD in Claude synthesis | ~600 | New section in Data Quality Audit |
| CWD in Pipeline Coverage | ~300 | Per-rep shadow pipeline metric |
| **Total per skill run** | **~2,000** | Negligible impact (~$0.002 per run) |

---

## Next Steps

### Immediate (Replit)

1. ✅ Run migration 013
   ```bash
   npm run migrate
   ```

2. ⏳ Wire internal filter into linker
   - Call `classifyInternalMeeting()` before Tier 3 (deal inference)
   - Update `conversations.is_internal` column
   - Skip deal linking if internal

3. ⏳ Add CWD API endpoint
   - `GET /api/workspaces/:id/conversations/without-deals`

4. ⏳ Update linker status endpoint
   - Add `internal_meetings` count to response

5. ⏳ Test with Frontera workspace
   - Verify "Frontera Fellowship" and "RevOps Weekly Alignment" flagged
   - Verify Precious Care ABA, Helping Hands, Guidepost ABA show as CWD

### After Linker Integration (Claude Code)

6. ⏳ Add Step 2.5 to Data Quality Audit skill
7. ⏳ Expand DeepSeek classification to include CWD items
8. ⏳ Expand Claude synthesis to include conversation coverage gaps
9. ⏳ Add shadow pipeline metric to Pipeline Coverage by Rep

---

## Files Created

```
server/analysis/
├── conversation-internal-filter.ts        # 350 lines - Internal meeting detection
├── conversation-without-deals.ts          # 450 lines - CWD detection & enrichment

migrations/
├── 013_internal_filter.sql                # Schema changes

INTERNAL_FILTER_CWD_IMPLEMENTATION.md      # This file
```

---

## Key Design Decisions

### Why Dual-Layer Filter?

**Domain check alone** is high-precision but misses edge cases (generic emails).
**Title patterns alone** produce false positives ("Weekly Demo with Acme").
**Together** they achieve high precision with good recall.

### Why Exclude Internal Meetings from ICP?

Internal meetings corrupt behavioral analysis:
- Inflate call counts
- Skew sentiment scores (internal meetings often neutral)
- Introduce noise in champion signal detection
- Waste DeepSeek classification tokens

Better to filter them out entirely and optionally analyze separately (Phase N: Rep Capacity Utilization).

### Why CWD is Valuable?

CWD detection surfaces **real pipeline gaps** that are invisible in CRM:
- Demos completed but not logged
- New opportunities at existing accounts
- Disqualified prospects not marked

Enriching with account context makes it **immediately actionable**:
- "Sara had a demo with Precious Care ABA (47 min, 3 participants) — no deal exists at this 12-contact account"
- → Clear action: Create deal or confirm disqualification

---

## Future Extensions (Phase N)

**Auto Deal Creation:**
- For workspaces that opt in, CWD findings could trigger automated deal creation in HubSpot/Salesforce
- Pre-populate: account, rep, stage = "qualification", close date = call date + default cycle length

**Internal Meeting Intelligence:**
- Track "time spent in internal meetings vs. customer calls"
- Rep capacity utilization metric for Rep Scorecard
- Tag and count, don't analyze content

**Multi-Account Conversations:**
- Support calls with participants from multiple accounts (joint demos)
- Surface as separate CWD entries for each unlinked account
