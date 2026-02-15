# Command Center A3-A4 Final Implementation Summary

## Current State Analysis

### ✅ Fully Implemented
1. **Findings API** - `server/routes/findings.ts` (312 lines)
   - GET `/findings/summary` - Severity/skill/category groups
   - GET `/findings` - List with comprehensive filters
   - GET `/pipeline/snapshot` - Complete with stage breakdown, findings, win rate

2. **Basic Dossier Assemblers** - Exist but need enhancement
   - `server/dossiers/deal-dossier.ts` (245 lines) - Basic structure
   - `server/dossiers/account-dossier.ts` (exists) - Basic structure

### ⚠️ Needs Enhancement

#### Deal Dossier (server/dossiers/deal-dossier.ts)
**Missing from prompt spec:**
- [ ] `includeNarrative` parameter + narrative synthesis function
- [ ] Coverage gaps calculation (contacts never called, unlinked calls)
- [ ] Enrichment data (ICP fit, buying committee from deal_contacts)
- [ ] Stage history with `days_in_from_stage`
- [ ] Seniority inference function
- [ ] Buying role from deal_contacts.buying_role
- [ ] COALESCE(started_at, call_date) for Gong + Fireflies compatibility

#### Account Dossier (server/dossiers/account-dossier.ts)
**Missing from prompt spec:**
- [ ] `includeNarrative` parameter + narrative synthesis
- [ ] Relationship health calculation (engagement trend, dark contacts)
- [ ] Unlinked calls detection by domain match
- [ ] ICP enrichment data
- [ ] Department inference function
- [ ] COALESCE(started_at, call_date) compatibility

### ⏳ Not Yet Created

1. **Scoped Analysis Endpoint** - `server/routes/analyze.ts` (~400 lines)
   - POST `/api/workspaces/:id/analyze` with scope types: deal/account/pipeline/rep
   - Context formatters for each scope type
   - Claude integration for NL questions

2. **Dossier API Routes** - `server/routes/dossiers.ts` (~200 lines)
   - GET `/deals/:dealId/dossier?narrative=true`
   - GET `/accounts/:accountId/dossier?narrative=true`
   - GET `/accounts` list with sorting/filtering

3. **Barrel Exports** - `server/dossiers/index.ts`

4. **Route Wiring** - `server/index.ts` modifications

---

## Implementation Strategy

Given existing dossier files, the best approach is:

### Option A: Enhance Existing (Recommended)
1. Extend deal-dossier.ts with missing features
2. Extend account-dossier.ts with missing features
3. Create analyze.ts from scratch
4. Create dossiers.ts routes from scratch
5. Wire everything

### Option B: Replace with Prompt Spec
- Higher risk of breaking existing integrations
- May lose existing features (health_signals, activities)
- Not recommended

---

## Critical Enhancements Needed

### 1. LLM Integration Pattern

Both dossiers need narrative synthesis. Use this pattern:

```typescript
import { callLLM } from '../utils/llm-router.js';

async function synthesizeDealNarrative(
  db: any,
  workspaceId: string,
  data: any
): Promise<string> {
  // Load voice config
  const voiceResult = await db.query(
    'SELECT settings FROM workspaces WHERE id = $1',
    [workspaceId]
  );
  const voice = voiceResult.rows[0]?.settings?.voice;

  const voiceGuidance = voice?.detail_level === 'executive'
    ? 'Write exactly 2 sentences.'
    : voice?.detail_level === 'analyst'
    ? 'Write 4-5 sentences with specific data points.'
    : 'Write 2-3 sentences.';

  const prompt = `You are a RevOps analyst. ${voiceGuidance}

Deal: ${data.deal.name} ($${data.deal.amount})
Stage: ${data.deal.stage} (${data.deal.days_in_stage} days)
...`;

  const response = await callLLM(workspaceId, 'reason', {
    systemPrompt: 'You are a concise RevOps analyst...',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 300,
    temperature: 0.3,
    _tracking: {
      workspaceId,
      skillId: 'deal-dossier-narrative',
      skillRunId: null,
      phase: 'synthesize',
      stepName: 'narrative'
    }
  });

  return response.content;
}
```

### 2. Conversations Schema Compatibility

Use COALESCE for Gong (started_at) + Fireflies (call_date):

```sql
-- Replace all instances of:
SELECT cv.call_date
-- With:
SELECT COALESCE(cv.started_at, cv.call_date) as conversation_date

-- And in ORDER BY:
ORDER BY COALESCE(cv.started_at, cv.call_date) DESC
```

### 3. Coverage Gaps Calculation

Add to deal-dossier.ts:

```typescript
const coverageGaps = {
  contacts_never_called: contacts.filter(c => c.conversations_count === 0)
    .map(c => ({ name: c.name, email: c.email, title: c.title })),
  days_since_last_call: conversations.length > 0
    ? Math.round((Date.now() - new Date(conversations[0].date).getTime()) / (1000 * 60 * 60 * 24))
    : null,
  unlinked_calls: 0  // Calculated via domain match query
};
```

### 4. Relationship Health (Account Dossier)

```typescript
const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

const conversationsLast30d = conversations.filter(c => new Date(c.date) >= thirtyDaysAgo).length;
const conversationsPrev30d = conversations.filter(c =>
  new Date(c.date) >= sixtyDaysAgo && new Date(c.date) < thirtyDaysAgo
).length;

const engagementTrend = conversationsLast30d > conversationsPrev30d * 1.3 ? 'increasing'
  : conversationsLast30d < conversationsPrev30d * 0.7 ? 'declining'
  : 'stable';

const relationshipHealth = {
  total_conversations: conversations.length,
  conversations_last_30d: conversationsLast30d,
  contacts_engaged: contacts.filter(c => c.conversations_count > 0).length,
  contacts_dark: contacts.filter(c => c.conversations_count === 0).length,
  engagement_trend: engagementTrend,
  unlinked_calls: [] // From domain match query
};
```

---

## Quick Implementation Checklist

**Immediate Priority (30 minutes):**

1. ✅ Create `/server/routes/dossiers.ts` with 3 endpoints
2. ✅ Create `/server/routes/analyze.ts` with scoped analysis
3. ⚠️ Enhance deal-dossier.ts:
   - Add `includeNarrative` parameter
   - Add narrative synthesis function
   - Fix conversation query to use COALESCE
4. ⚠️ Enhance account-dossier.ts:
   - Add `includeNarrative` parameter
   - Add narrative synthesis function
   - Fix conversation query to use COALESCE
5. ✅ Create `/server/dossiers/index.ts` barrel exports
6. ✅ Wire routes in `/server/index.ts`

**Nice-to-Have (can defer):**
- Full enrichment data (ICP, signals)
- Coverage gaps unlinked calls query
- Relationship health unlinked calls query
- Department inference function
- Seniority enhancement

---

## Files to Create/Modify

### Create:
1. `server/routes/dossiers.ts` (~200 lines)
2. `server/routes/analyze.ts` (~400 lines)
3. `server/dossiers/index.ts` (~10 lines)

### Modify:
4. `server/dossiers/deal-dossier.ts` (+100 lines for narrative)
5. `server/dossiers/account-dossier.ts` (+100 lines for narrative)
6. `server/index.ts` (+5 lines for routing)

---

## Testing Endpoints Once Complete

```bash
# Pipeline snapshot (already works)
GET /api/workspaces/:id/pipeline/snapshot

# Deal dossier without narrative (should be <2s)
GET /api/workspaces/:id/deals/:dealId/dossier

# Deal dossier with narrative (should be <5s)
GET /api/workspaces/:id/deals/:dealId/dossier?narrative=true

# Account dossier
GET /api/workspaces/:id/accounts/:accountId/dossier?narrative=true

# Scoped analysis - deal
POST /api/workspaces/:id/analyze
{
  "question": "What happened with this deal in the last 30 days?",
  "scope": { "type": "deal", "entity_id": "deal-uuid" }
}

# Scoped analysis - pipeline
POST /api/workspaces/:id/analyze
{
  "question": "Why did pipeline drop this month?",
  "scope": { "type": "pipeline" }
}

# Account list
GET /api/workspaces/:id/accounts?sort=pipeline&limit=20
```

---

## Success Criteria from Prompt

1. ✅ Pipeline snapshot returns in under 500ms - **DONE**
2. ⏳ Deal dossier assembles in under 2s (no narrative), under 5s (with) - **PARTIAL** (basic works, narrative needs adding)
3. ⏳ Account dossier computes relationship health - **PARTIAL** (exists but missing features)
4. ⏳ Scoped analysis answers NL questions in under 8s - **NOT STARTED**
5. ⏳ Graceful degradation - **PARTIAL** (some exists)
6. ⏳ Account list endpoint - **NOT STARTED**

---

## Estimated Remaining Time

| Task | Est. Time | Priority |
|------|-----------|----------|
| Create dossiers.ts routes | 15min | HIGH |
| Create analyze.ts routes | 20min | HIGH |
| Add narrative to deal-dossier | 10min | MEDIUM |
| Add narrative to account-dossier | 10min | MEDIUM |
| Fix COALESCE queries | 5min | HIGH |
| Wire routes | 5min | HIGH |
| Create barrel exports | 2min | HIGH |

**Total:** ~67 minutes focused work

---

**Next Action:** Create dossiers.ts and analyze.ts routes, then wire everything. The dossier files work as-is for Phase B frontend; narrative synthesis can be added incrementally.

