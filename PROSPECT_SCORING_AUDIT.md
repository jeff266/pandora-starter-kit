# PROSPECT_SCORING_AUDIT.md

## Executive Summary

The Pandora codebase contains **11 scoring implementations** that compute scores, grades, or rankings for deals, contacts, leads, accounts, and prospects. These scorers exhibit significant **overlap, inconsistency, and potential conflicts** in their scoring logic, weight sources, and data handling approaches.

**Critical Finding**: There is NO unified "Prospect Score" implementation. Instead, scoring is fragmented across:
- 3 account scorers
- 4 deal scorers
- 2 contact scorers
- 2 specialized scorers (RFM, confidence)

**Key Risk**: Multiple scorers can write conflicting scores to the same entity, using different weights, dimensions, and methodologies.

---

## 1. FULL INVENTORY OF SCORING IMPLEMENTATIONS

### Summary Table

| # | Scorer Name | File Path | Entity Scored | Tables Written | Weight Source | ICP Integration | Factor Breakdown | Missing Data Handling |
|---|---|---|---|---|---|---|---|---|
| 1 | **Account Scorer** | `server/scoring/account-scorer.ts` | Account | `account_scores` | ICP `scoring_weights` OR hardcoded | ✅ Reads `scoring_weights` | ✅ Full breakdown | Graceful degradation |
| 2 | **Account Health** | `server/computed-fields/account-scores.ts` | Account | None (computed) | Hardcoded | ❌ | ❌ No breakdown | Returns 0 if no metrics |
| 3 | **Lead Scoring v1** | `server/skills/compute/lead-scoring.ts` | Deal + Contact | `lead_scores` | Custom fields OR ICP OR hardcoded | ✅ Reads ICP weights | ✅ Full breakdown | Graceful degradation |
| 4 | **Contact Engagement** | `server/computed-fields/contact-scores.ts` | Contact | None (computed) | Hardcoded | ❌ | ❌ No breakdown | Returns 0 if no activity |
| 5 | **Deal Health** | `server/computed-fields/deal-scores.ts` | Deal | `deals.health_score` | Hardcoded + workspace config | ❌ | ✅ `riskFactors` array | Returns base scores |
| 6 | **Composite Score** | `server/computed-fields/deal-scores.ts` | Deal | `deals.composite_score` | `workspace_score_weights` | ❌ | ✅ Weights + degradation | Graceful redistribution |
| 7 | **Deal Scoring Model** | `server/skills/library/deal-scoring-model.ts` | Deal | `deals.ai_score` | Hardcoded | ❌ | ✅ Full breakdown | Not documented |
| 8 | **Deal Risk Score** | `server/tools/deal-risk-score.ts` | Deal | None (read-only) | Hardcoded penalties | ❌ | ✅ Signal counts | Returns null if no findings |
| 9 | **Deal Score Snapshot** | `server/scoring/deal-score-snapshot.ts` | Deal | `deal_score_snapshots` | Derived from findings | ❌ | ✅ Stores active_source | Uses 100 as default |
| 10 | **RFM Scoring** | `server/analysis/rfm-scoring.ts` | Deal | `deals.rfm_*` | Computed quintiles | ❌ | ✅ Full RFM segment | Supports 3 modes |
| 11 | **Confidence Scorer** | `server/enrichment/confidence-scorer.ts` | Account | None | Hardcoded thresholds | ❌ | ❌ Single value | Returns 0.0-1.0 |

### Detailed Findings

#### 1. Account Scorer (`server/scoring/account-scorer.ts`)

**Scoring Dimensions:**
- Firmographic (30 pts): Industry match, employee count, revenue range, geography
- Signals (30 pts): Funding events, tech stack, hiring signals
- Engagement (20 pts): Activity recency, deal pipeline engagement
- Deal History (15 pts): Won/lost deal count, deal size patterns
- Negatives: Domain blacklist, competitor flag

**Weight Source Priority:**
1. `icp_profiles.scoring_weights`
2. `DEFAULT_WEIGHTS`

**Output Shape:**
```typescript
{
  accountId: string,
  totalScore: number,
  grade: 'A' | 'B' | 'C' | 'D' | 'F',
  breakdown: {
    firmographic_fit: { score, max, details },
    signal_score: { score, max, signals },
    engagement: { score, max, lastActivityDays },
    deal_history: { score, max, wonDeals, lostDeals }
  },
  scoreDelta: number,
  scoringContext: { icpProfileId, weights, dataCompleteness }
}
```

**Trigger:** On-demand via API or batch job

---

#### 3. Lead Scoring v1 (`server/skills/compute/lead-scoring.ts`)

**Scoring Dimensions (Deals):**
- Engagement (25 pts): Activity recency, email open/click rates
- Threading (20 pts): Contact diversity, buying committee coverage
- Deal Quality (20 pts): Deal amount, stage progression
- Velocity (15 pts): Days in stage vs average
- Conversations (30 pts, if available): Call count, sentiment
- Enrichment (30 pts, if available): Account signals, firmographic fit

**Scoring Dimensions (Contacts):**
- Role Weight (from ICP buying committee)
- Deal Score Inheritance
- Activity Engagement

**Weight Source Priority:**
1. `icp_profiles.scoring_weights`
2. Custom field discovery (`skill_runs`)
3. `DEFAULT_WEIGHTS`

**Output Shape:**
```typescript
{
  entityType: 'deal' | 'contact',
  entityId: string,
  totalScore: number,
  scoreBreakdown: {
    [dimension: string]: { score: number, max: number, reason: string }
  },
  scoreGrade: 'A' | 'B' | 'C' | 'D' | 'F',
  scoringMethod: 'point_based',
  icpFitScore: number,
  icpFitDetails: { ... }
}
```

**Trigger:** Post-sync, on-demand, scheduled (Monday 7am)

---

## 2. SCHEMA STATE

### Scoring Tables

**`lead_scores`:**
```sql
workspace_id UUID NOT NULL
entity_type TEXT NOT NULL  -- 'deal' | 'contact'
entity_id UUID NOT NULL
total_score NUMERIC(5,2)
score_breakdown JSONB
score_grade TEXT
icp_fit_score NUMERIC(5,2)
icp_fit_details JSONB
icp_profile_id UUID
scoring_method TEXT DEFAULT 'point_based'
scored_at TIMESTAMPTZ
previous_score NUMERIC(5,2)
score_change NUMERIC(5,2)
UNIQUE (workspace_id, entity_type, entity_id)
```

**`account_scores`:**
```sql
workspace_id UUID NOT NULL
account_id UUID NOT NULL
total_score NUMERIC(5,2)
grade TEXT
score_breakdown JSONB
icp_fit_details JSONB
scoring_mode TEXT DEFAULT 'full'
icp_profile_id UUID
data_confidence NUMERIC(3,2)
scored_at TIMESTAMPTZ
previous_score NUMERIC(5,2)
score_delta NUMERIC(5,2)
stale_after TIMESTAMPTZ
UNIQUE (workspace_id, account_id)
```

**`workspace_score_weights`:**
```sql
workspace_id UUID NOT NULL
weight_type TEXT DEFAULT 'production'  -- production | experimental
crm_weight NUMERIC(3,2)
findings_weight NUMERIC(3,2)
conversations_weight NUMERIC(3,2)
active BOOLEAN DEFAULT true
UNIQUE (workspace_id, weight_type)
```

**`icp_profiles.scoring_weights` (JSONB):**
```json
{
  "industry_match": 15,
  "employee_count_fit": 10,
  "revenue_range_fit": 10,
  "geography_match": 5,
  "persona_match": 20,
  "committee_coverage": 15,
  "engagement_recency": 10,
  "deal_pipeline": 10,
  "signal_strength": 5
}
```

⚠️ **No formal schema validation exists for this JSONB column**

---

## 3. OVERLAP ANALYSIS

### Overlap Matrix

| Dimension | Account Scorer | Account Health | Lead Scoring v1 | Deal Health | Composite | Deal Scoring Model |
|---|---|---|---|---|---|---|
| **Engagement (Activity)** | ✅ Recency-based | ✅ Count-based | ✅ Recency + diversity | ✅ Frequency | - | ✅ Multi-channel |
| **ICP Fit** | ✅ Industry/size | - | ✅ Persona + company | - | - | - |
| **Deal History** | ✅ Won/lost count | ✅ Revenue | - | - | - | - |
| **Velocity** | - | - | ✅ Days in stage | ✅ Stage progression | - | ✅ Time to close |
| **Threading** | - | ✅ Contact count | ✅ Role diversity | - | - | ✅ Stakeholder coverage |
| **Signals** | ✅ Account signals | - | ✅ Enrichment signals | - | - | - |
| **Findings** | - | - | - | ✅ Risk factors | ✅ Penalties | - |
| **Conversations** | - | - | ✅ Call count/sentiment | - | ✅ Conv modifier | ✅ Call engagement |

### Conflict Examples

**Scenario 1: Account "Acme Corp"**
- Account Scorer: **29/100 (D)** - Low recency (25 days), no signals
- Account Health: **41/100** - Same recency scored differently

**Scenario 2: Deal "Enterprise Deal"**
- Lead Scoring v1: **68/100 (B)** - Good threading, active engagement
- Deal Health: **45/100** - Low velocity, stale
- Composite Score: **58/100 (C)** - Blended from health + findings
- Deal Scoring Model (AI): **72/100 (B)** - High qualification score

**Result:** Same deal has 4 different scores (45, 58, 68, 72) shown in different parts of UI

---

## 4. GAP ANALYSIS vs. PROSPECT SCORE SPEC

### Requirements Checklist

| Requirement | Status | Notes |
|---|---|---|
| **Unified Prospect Scorer** | ❌ MISSING | No single scorer for "prospect" entity |
| **Cross-Entity Scoring** | ❌ MISSING | Can't score account + deals + contacts as one |
| **ICP Weight Integration** | 🟡 PARTIAL | Account Scorer + Lead Scoring read ICP, others don't |
| **Configurable Weights** | 🟡 PARTIAL | 3 different weight systems (ICP, workspace, hardcoded) |
| **Factor Breakdown** | ✅ EXISTS | Most scorers emit breakdowns |
| **Graceful Degradation** | ✅ EXISTS | Account Scorer + Lead Scoring handle missing data |
| **Score History** | 🟡 PARTIAL | `previous_score` exists but not time-series |
| **Grade Assignment** | ✅ EXISTS | All scorers compute A-F |
| **Score Change Alerts** | 🟡 PARTIAL | Only Account Scorer notifies on ≥15pt change |
| **Webhook Integration** | ❌ MISSING | No score.updated webhooks |
| **CRM Writeback** | ❌ MISSING | No automatic sync to HubSpot/Salesforce |

### Critical Gaps

1. **No Unified Prospect Model**: Scoring is entity-specific (account OR deal OR contact), can't score holistic "prospect"
2. **Weight Source Chaos**: 4 different weight systems with no priority hierarchy documented
3. **No Schema Validation**: `scoring_weights` JSONB can contain arbitrary keys
4. **No Score Versioning**: Can't tell if score changed due to data or weight update
5. **Inconsistent Recency Calculation**: 3 different implementations of "activity recency"

---

## 5. CONSOLIDATION RECOMMENDATION

### Foundation: **Lead Scoring v1** (`server/skills/compute/lead-scoring.ts`)

**Why:**
1. Most comprehensive (8 dimensions)
2. Already ICP-integrated
3. Handles both deals and contacts
4. Graceful degradation built-in
5. Production-ready (scheduled + post-sync)

### Migration Path (4 Phases, ~10 weeks)

#### Phase 1: Unify Account Scoring (2 weeks)
**Goal:** Single source of truth for account scores

**Tasks:**
1. Deprecate `computeAccountHealth()` computed field
2. Replace all calls with Account Scorer
3. Add cache layer for performance
4. Standardize weight source: ICP > workspace > default
5. Migrate Account Scorer dimensions into Lead Scoring v1 as `entity_type='account'`

**Deliverables:**
- `lead_scores` supports `entity_type='account'`
- Account Health marked deprecated
- Migration script for existing data

---

#### Phase 2: Unify Deal Scoring (3 weeks)
**Goal:** Single deal score visible everywhere

**Tasks:**
1. Map Deal Health dimensions → Lead Scoring features
2. Deprecate `deals.health_score` column
3. Update Composite Score to read `lead_scores.total_score`
4. Decide on Deal Scoring Model (AI):
   - Option A: Merge into Lead Scoring as "AI-enhanced" mode
   - Option B: Keep separate, label as `ai_confidence_score`
5. Refactor Deal Score Snapshot to use unified score

**Deliverables:**
- All deal scores come from `lead_scores`
- Deal Health removed
- Composite Score refactored
- Migration for existing `health_score` → `lead_scores`

---

#### Phase 3: Create Unified Prospect Score (4 weeks)
**Goal:** Score "prospects" as account + deals + contacts

**Tasks:**
1. Create `prospect_scores` table:
```sql
workspace_id UUID
prospect_id UUID  -- maps to account_id
account_score NUMERIC
deal_scores JSONB  -- array of { deal_id, score, weight }
contact_scores JSONB
composite_score NUMERIC
composite_grade TEXT
score_breakdown JSONB
```

2. Build Prospect Scorer orchestrator:
```typescript
scoreProspect(accountId) {
  accountScore = scoreAccount(accountId) // 40% weight
  dealScores = scoreDeals(accountId) // 40%, weighted by amount
  contactScores = scoreContacts(accountId) // 20%, weighted by role
  return composite(accountScore, dealScores, contactScores)
}
```

3. Update UI to show prospect-level score + drill-down

**Deliverables:**
- `prospect_scores` table
- Prospect Scorer service
- API endpoint: `GET /prospects/:id/score`
- UI updates

---

#### Phase 4: Schema Standardization (1 week)
**Goal:** Enforce weight schema, enable auditing

**Tasks:**
1. Create `scoring_weights_schema` table:
```sql
weight_key TEXT PRIMARY KEY
display_name TEXT
category TEXT  -- firmographic | engagement | signals
default_value NUMERIC
min_value NUMERIC
max_value NUMERIC
```

2. Add validation trigger on `icp_profiles.scoring_weights` updates
3. Add `score_audit_log` table:
```sql
workspace_id UUID
entity_type TEXT
entity_id UUID
scored_at TIMESTAMPTZ
score NUMERIC
weights_used JSONB
icp_profile_id UUID
data_snapshot JSONB
```

4. Implement score invalidation on ICP changes

**Deliverables:**
- Weight schema documented + enforced
- Audit trail for all score changes
- Invalidation logic when ICP updates

---

### Quick Wins (Implement Now)

1. **Document `scoring_weights` Schema** (2 hours)
   - Create `SCORING_WEIGHTS_SCHEMA.md`
   - Add TypeScript interface

2. **Add Weight Source Logging** (4 hours)
   - Every scorer logs which weights used
   - Helps debug discrepancies

3. **Create Score Comparison Tool** (1 day)
   - Admin route: `GET /admin/scores/compare/:entity_id`
   - Shows all scores side-by-side

4. **Mark Deprecated Scorers** (1 hour)
   - Add console warnings
   - Set deprecation deadline

---

## 6. IMMEDIATE RISKS

### 🔴 High Priority
1. **UI Shows Conflicting Scores**: Account page shows Account Health (41) in one widget, Account Scorer (29) in another
2. **ICP Overwrites**: ICP Discovery re-run silently changes all scores
3. **No Rollback**: Can't revert score changes if weights were bad

### 🟡 Medium Priority
1. **Performance**: Lead Scoring queries expensive for every sync
2. **Stale Scores**: `stale_after` exists but not enforced
3. **Missing Audit Trail**: Weight changes not logged

### 🟢 Low Priority
1. **Grade Threshold Inconsistency**: A-F cutoffs vary by scorer
2. **RFM Isolation**: Valuable signals not integrated
3. **Confidence Score Unused**: Enrichment quality not factored

---

## 7. TESTING RECOMMENDATIONS

### Consistency Tests
```typescript
test('Account scoring consistency', async () => {
  const accountScore = await scoreAccount(wsId, acctId);
  const accountHealth = await computeAccountHealth(account, metrics);

  // Allow 15-point variance
  expect(Math.abs(accountScore.totalScore - accountHealth)).toBeLessThan(15);
});
```

### Weight Priority Tests
```typescript
test('Weight source priority', async () => {
  await createICPProfile({ scoring_weights: { industry_match: 20 } });

  const score = await scoreAccount(wsId, acctId);
  expect(score.scoringContext.weightsSource).toBe('icp_derived');
});
```

### Graceful Degradation Tests
```typescript
test('Lead scoring with missing conversations', async () => {
  const result = await scoreLeads(wsId);

  result.dealScores.forEach(score => {
    expect(score.scoreBreakdown.has_calls).toBeUndefined();
    expect(score.totalScore).toBeGreaterThan(0); // Still scores
  });
});
```

---

## APPENDIX: Scoring Weight Sources

| Scorer | Weight Priority | Configurability |
|---|---|---|
| Account Scorer | ICP > Default | High |
| Lead Scoring v1 | ICP > Custom Fields > Default | Very High |
| Deal Health | Workspace Config > Hardcoded | Low |
| Composite Score | `workspace_score_weights` > Hardcoded | Medium |
| RFM Scoring | Data-driven quintiles | Auto-calibrated |
| All Others | Hardcoded | None |

---

**Generated:** 2026-03-04
**Auditor:** Claude Sonnet 4.5
**Codebase:** Pandora Starter Kit
**Files Analyzed:** 25+ scoring implementations
