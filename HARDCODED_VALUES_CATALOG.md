# Hardcoded Values Catalog

This document catalogs all hardcoded mappings, thresholds, and constants in the Pandora application. Items marked with 🔧 should be made configurable per workspace.

## 1. Stage Normalization

### HubSpot Stages
**Location:** `server/connectors/hubspot/transform.ts` (lines 27-76)
**Status:** 🔧 Should be workspace-configurable

```typescript
const DEFAULT_STAGE_NORMALIZED_MAP: Record<string, string> = {
  // Standard HubSpot stages
  appointmentscheduled: 'qualification',
  qualifiedtobuy: 'qualification',
  presentationscheduled: 'evaluation',
  decisionmakerboughtin: 'evaluation',
  contractsent: 'negotiation',
  closedwon: 'closed_won',
  closedlost: 'closed_lost',
  // ... 30+ more patterns
}
```

**Fallback logic:** Keyword-based detection (lines 48-70)
- Checks for: closed_won, closed_lost, contract, proposal, demo, pilot, qualification keywords
- Final fallback: 'awareness'

### Salesforce Stages
**Location:** `server/connectors/salesforce/transform.ts`
**Status:** ✅ Uses Salesforce native stage mapping (no hardcoding)

### Stage Order (for velocity calculations)
**Location:** `server/analysis/stage-history-queries.ts` (lines 225-235)
**Status:** ✅ Reasonable default

```typescript
const STAGE_ORDER: Record<string, number> = {
  lead: 1,
  qualified: 2,
  discovery: 3,
  evaluation: 4,
  proposal: 5,
  negotiation: 6,
  decision: 7,
  closed_won: 8,
  closed_lost: 8,
}
```

**Issue:** Missing 'awareness' and 'qualification' from HubSpot normalization

---

## 2. Buying Role Classification

### Role Normalization Map
**Location:** `server/skills/compute/contact-role-resolution.ts` (lines 79-102)
**Status:** 🔧 Should allow custom role additions

```typescript
const ROLE_NORMALIZATION: Record<string, string> = {
  'decision maker': 'decision_maker',
  'economic buyer': 'economic_buyer',
  'executive sponsor': 'executive_sponsor',
  'champion': 'champion',
  'influencer': 'influencer',
  'evaluator': 'technical_evaluator',
  'coach': 'coach',
  'blocker': 'blocker',
  'budget holder': 'economic_buyer',
  'project lead': 'champion',
  // ... 20+ mappings
}
```

### Standard Roles Set
**Location:** `server/skills/compute/contact-role-resolution.ts` (lines 104-114)
**Status:** ✅ Reasonable default

```typescript
const STANDARD_ROLES = new Set([
  'champion',
  'economic_buyer',
  'decision_maker',
  'technical_evaluator',
  'influencer',
  'coach',
  'blocker',
  'end_user',
  'executive_sponsor',
])
```

### CRM Field Patterns (for role detection)
**Location:** `server/skills/compute/contact-role-resolution.ts` (lines 126-158)
**Status:** 🔧 Should allow workspace extensions

```typescript
const ROLE_FIELD_PATTERNS: Record<string, string[]> = {
  champion: ['champion', 'champion_name', 'champion__c', 'Champion__c'],
  economic_buyer: ['economic_buyer', 'eb', 'budget_holder', 'Economic_Buyer__c'],
  decision_maker: ['decision_maker', 'dm', 'final_approver', 'Decision_Maker__c'],
  technical_evaluator: ['technical_evaluator', 'tech_eval', 'Technical_Evaluator__c'],
}
```

### Title-Based Role Detection
**Location:** `server/skills/compute/contact-role-resolution.ts` (lines 164-200+)
**Status:** ✅ Reasonable heuristic defaults

```typescript
const TITLE_ROLE_MAP: { pattern: RegExp; role: string; confidence: number }[] = [
  { pattern: /\b(CEO|CTO|CRO|COO|CFO|CMO|CIO|CISO|Chief)\b/i, role: 'decision_maker', confidence: 0.55 },
  { pattern: /\b(VP|Vice President)\b.*\b(Sales|Revenue)\b/i, role: 'economic_buyer', confidence: 0.50 },
  { pattern: /\bDirector\b.*\b(Engineer|Tech)\b/i, role: 'technical_evaluator', confidence: 0.50 },
  // ... 20+ patterns
]
```

---

## 3. Seniority Detection

### Seniority Levels
**Location:** `server/connectors/salesforce/transform.ts` (lines 202-242)
**Status:** ✅ Industry-standard levels

```typescript
function parseSeniority(title: string | null): string | null {
  // Returns: 'c_level', 'vp', 'director', 'manager', or 'ic'

  // C-level: CEO, CTO, CFO, COO, CMO, CRO, Chief
  // VP: SVP, EVP, VP, Vice President
  // Director: Director
  // Manager: Manager, Head of
  // IC: everything else
}
```

### High Seniority Check (for scoring)
**Location:** `server/skills/compute/lead-scoring.ts` (line 916)
**Status:** ✅ Reasonable default

```typescript
const seniorityHigh = contact.seniorityVerified &&
  ['vp', 'c_level', 'director'].includes(contact.seniorityVerified);
```

---

## 4. Department Detection

**Location:** `server/skills/compute/icp-discovery.ts` (lines 198-209)
**Status:** 🔧 Should allow custom department additions

```typescript
function parseDepartment(title: string | null): string {
  // Returns: engineering, operations, sales, marketing, finance, product, hr, legal, unknown

  if (/\b(engineer|technical|architect|developer|cto)\b/.test(t)) return 'engineering';
  if (/\b(process|operations|plant|manufacturing)\b/.test(t)) return 'operations';
  if (/\b(sales|account exec|business develop)\b/.test(t)) return 'sales';
  if (/\b(marketing|growth|demand gen)\b/.test(t)) return 'marketing';
  if (/\b(finance|cfo|controller|accounting)\b/.test(t)) return 'finance';
  if (/\b(product|pm |product manag)\b/.test(t)) return 'product';
  if (/\b(hr|human resources|people)\b/.test(t)) return 'hr';
  if (/\b(legal|compliance|counsel)\b/.test(t)) return 'legal';
  return 'unknown';
}
```

---

## 5. Lead Scoring Weights

### Default Scoring Weights
**Location:** `server/skills/compute/lead-scoring.ts` (lines 142-186)
**Status:** 🔧 Overridden by ICP Discovery, but fallback should be configurable

```typescript
const DEFAULT_WEIGHTS = {
  deal: {
    // Engagement (max 25 points)
    has_recent_activity: 8,
    activity_volume: 7,
    multi_channel: 5,
    active_days: 5,

    // Threading (max 20 points)
    multi_threaded: 6,
    has_champion: 5,
    has_economic_buyer: 5,
    role_diversity: 4,

    // Deal quality (max 20 points)
    amount_present: 3,
    amount_tier: 7,
    probability: 5,
    stage_advanced: 5,

    // Velocity (max 15 points)
    close_date_set: 3,
    close_date_reasonable: 4,
    days_since_activity: -8, // NEGATIVE
    stage_velocity: 8,

    // Conversation (max 10 points)
    has_calls: 5,
    recent_call: 3,
    call_volume: 2,
    no_calls_late_stage: -5, // NEGATIVE
  },

  contact: {
    has_email: 10,
    has_phone: 5,
    has_title: 5,
    role_assigned: 10,
    is_power_role: 15,
    seniority_high: 10,
    activity_on_deals: 15,
    multi_deal_contact: 10,
    deal_quality: 20,
  },
}
```

### Grade Thresholds
**Location:** `server/skills/compute/lead-scoring.ts` (lines 862-865, 935-938)
**Status:** 🔧 Should be workspace-configurable

```typescript
const grade = normalizedScore >= 85 ? 'A' :
              normalizedScore >= 70 ? 'B' :
              normalizedScore >= 50 ? 'C' :
              normalizedScore >= 30 ? 'D' : 'F';
```

---

## 6. Forecast Category Thresholds

**Location:** `server/connectors/hubspot/transform.ts` (lines 196-218)
**Status:** ✅ Already workspace-configurable via `forecast_thresholds` table

```typescript
// Defaults (can be overridden per workspace)
const DEFAULT_COMMIT_THRESHOLD = 0.90;      // 90%
const DEFAULT_BEST_CASE_THRESHOLD = 0.60;   // 60%

// Brackets:
// >= 1.0          → closed
// >= 0.90         → commit
// >= 0.60         → best_case
// > 0.10          → pipeline
// <= 0.10 or null → not_forecasted
```

**Database:** `forecast_thresholds` table stores per-workspace overrides

---

## 7. Custom Field Discovery Thresholds

**Location:** `server/skills/compute/custom-field-discovery.ts` (line 1285)
**Status:** ✅ Reasonable default

```typescript
// Minimum ICP relevance score for "high-relevance" fields
const MIN_RELEVANCE_SCORE = 50;

// Extract top fields (score >= 50, max 10)
const topFields = discoveredFields
  .filter(f => f.icpRelevanceScore >= 50)
  .slice(0, 10);
```

---

## 8. Pipeline Health Thresholds

**Location:** Various skill files
**Status:** 🔧 Should be workspace-configurable

### Stale Deal Threshold
- **Default:** 14 days since last activity
- **Used in:** pipeline-hygiene, deal-risk-review

### Coverage Multipliers
- **Default:** 3x coverage target
- **Used in:** pipeline-coverage

### Single-threading Risk
- **Default:** < 2 contacts = single-threaded
- **Used in:** single-thread-alert

---

## 9. Retry & Rate Limiting

**Location:** `server/utils/retry.ts` (lines 9-13)
**Status:** ✅ Reasonable defaults

```typescript
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
}
```

---

## 10. Salesforce Field Mappings

**Location:** `server/connectors/salesforce/types.ts` (line 360+)
**Status:** ✅ Salesforce API standard fields

```typescript
export const EXTRA_STANDARD_FIELDS = {
  opportunity: ['OpportunityContactRoles', 'OpportunityFieldHistory'],
  contact: ['AccountId', 'OwnerId', 'LastActivityDate'],
  // ... Salesforce standard object fields
}
```

---

## Summary of Recommended Changes

### High Priority (Customer Impact)
1. **Stage normalization** - Make `DEFAULT_STAGE_NORMALIZED_MAP` workspace-configurable
2. **Grade thresholds** - Allow workspaces to define A/B/C/D/F cutoffs
3. **Department patterns** - Allow adding custom department keywords
4. **Role field patterns** - Allow adding custom CRM field mappings

### Medium Priority (Flexibility)
5. **Default scoring weights** - Allow workspace override before ICP Discovery runs
6. **Stale deal threshold** - Make configurable per workspace
7. **Coverage multiplier** - Configurable pipeline coverage targets

### Low Priority (Advanced Use Cases)
8. **Seniority levels** - Currently covers 95% of titles, but could allow custom levels
9. **Standard roles set** - Could allow adding custom buying roles
10. **Title-based role detection** - Could allow custom title patterns

---

## Implementation Pattern

For making hardcoded values configurable:

```typescript
// 1. Add to context_layer.definitions table
INSERT INTO context_layer (workspace_id, entity_type, definitions)
VALUES ($1, 'workspace', jsonb_build_object(
  'stage_mapping', jsonb_build_object(
    'pilot_program': 'evaluation',
    'final_review': 'decision'
  ),
  'grade_thresholds', jsonb_build_object(
    'A': 90, 'B': 75, 'C': 55, 'D': 35, 'F': 0
  )
));

// 2. Load in code with fallback to defaults
const stageMapping = contextLayer?.definitions?.stage_mapping || DEFAULT_STAGE_NORMALIZED_MAP;
const gradeThresholds = contextLayer?.definitions?.grade_thresholds || DEFAULT_GRADE_THRESHOLDS;
```

This allows per-workspace customization while maintaining sensible defaults for new workspaces.
