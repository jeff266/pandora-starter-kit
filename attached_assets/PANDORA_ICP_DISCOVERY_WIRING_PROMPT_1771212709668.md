# Pandora ICP Discovery — Wire Skills to Enrichment Pipeline

## For: Replit
## Depends on: Existing enrichment pipeline (deal_contacts, account_signals tables with real data)
## Effort estimate: ~45 minutes across 5 tasks

---

## Context

The enrichment pipeline is live and producing real data for Frontera Health's workspace:

- **deal_contacts table:** Buying committee data with roles and Apollo enrichment. Catalight - AB deal ($100K closed-won) has 8 contacts with 6 roles resolved. 14 contacts have Apollo data with verified seniority, department, and company info.
- **account_signals table:** Serper search results classified by DeepSeek. Catalight has 5 signals (product launch, partnership, WEF participation, award, telehealth expansion) with signal_score 0.75.
- **icp_profiles table:** Migrated but EMPTY — ICP Discovery hasn't written to it yet.
- **lead_scores table:** Migrated but EMPTY — Lead Scoring hasn't persisted scores yet.
- **deals, contacts, accounts:** Populated from HubSpot sync
- **conversations:** 66 calls from Gong sync
- **deal_insights:** From DeepSeek extraction
- **deal_stage_history, activities, quotas:** Populated

Your job: update ICP Discovery, Lead Scoring, and Contact Role Resolution to READ from the enrichment tables and WRITE to icp_profiles and lead_scores. These are surgical edits to existing skills, not new builds.

---

## Before Starting — Read These Files

1. The existing **ICP Discovery skill** — find its steps, especially `buildFeatureMatrix()`
2. The existing **Lead Scoring skill** — find its steps, especially `DEFAULT_WEIGHTS` and scoring logic
3. The existing **Contact Role Resolution skill**
4. The **deal_contacts** table schema (check the migration)
5. The **account_signals** table schema
6. The **icp_profiles** table schema
7. The **lead_scores** table schema
8. `server/enrichment/` directory — see what exists (resolve-contact-roles.ts, apollo.ts, serper.ts, classify-signals.ts, closed-deal-enrichment.ts)

---

## Task 1: ICP Discovery — Consume Enriched Data

### 1a. Expand the Feature Matrix (Step 2)

Find the step that builds the feature matrix for closed deals. It currently pulls from deals, contacts, accounts, and conversations. Add enrichment columns.

For each closed deal in the analysis set, LEFT JOIN enrichment data:

```sql
-- Buying committee metrics per deal
SELECT 
  dc.deal_id,
  COUNT(dc.id) as buying_committee_size,
  COUNT(dc.id) FILTER (WHERE dc.buying_role IS NOT NULL AND dc.buying_role != 'unknown') as roles_identified,
  COUNT(dc.id) FILTER (WHERE dc.buying_role = 'decision_maker') as decision_maker_count,
  COUNT(dc.id) FILTER (WHERE dc.buying_role = 'champion') as champion_count,
  COUNT(dc.id) FILTER (WHERE dc.buying_role = 'economic_buyer') as economic_buyer_count,
  COUNT(dc.id) FILTER (WHERE dc.buying_role = 'technical_evaluator') as tech_eval_count,
  COUNT(dc.id) FILTER (WHERE dc.enrichment_status = 'enriched') as contacts_enriched,
  
  -- Seniority distribution (from Apollo)
  COUNT(dc.id) FILTER (WHERE dc.seniority_verified = 'c_level') as c_level_count,
  COUNT(dc.id) FILTER (WHERE dc.seniority_verified = 'vp') as vp_count,
  COUNT(dc.id) FILTER (WHERE dc.seniority_verified = 'director') as director_count,
  COUNT(dc.id) FILTER (WHERE dc.seniority_verified = 'manager') as manager_count,
  
  -- Department distribution
  MODE() WITHIN GROUP (ORDER BY dc.department_verified) as primary_department
  
FROM deal_contacts dc
WHERE dc.workspace_id = $1
GROUP BY dc.deal_id
```

```sql
-- Account signals per deal
SELECT 
  asig.deal_id,
  asig.signal_score,
  asig.signals,
  (asig.signals::jsonb @> '[{"type":"funding"}]')::boolean as has_funding_signal,
  (asig.signals::jsonb @> '[{"type":"hiring"}]')::boolean as has_hiring_signal,
  (asig.signals::jsonb @> '[{"type":"expansion"}]')::boolean as has_expansion_signal,
  jsonb_array_length(asig.signals) as signal_count
FROM account_signals asig
WHERE asig.workspace_id = $1
```

Merge these into the feature matrix. Each deal row gets:
- `buying_committee_size` (number)
- `roles_identified` (number)
- `has_champion` (boolean)
- `has_economic_buyer` (boolean)
- `has_decision_maker` (boolean)
- `has_tech_evaluator` (boolean)
- `seniority_max` (c_level > vp > director > manager > ic)
- `contacts_enriched` (number)
- `signal_score` (number, -1 to 1)
- `has_funding_signal` (boolean)
- `has_hiring_signal` (boolean)
- `has_expansion_signal` (boolean)
- `signal_count` (number)
- `has_enrichment_data` (boolean — true if deal_contacts exist for this deal)

**Graceful degradation:** If a deal has no deal_contacts rows (not yet enriched), all enrichment columns = NULL. The feature matrix must still work without them.

### 1b. Enhance Persona Patterns

Find the step that discovers persona patterns (clusters contacts by title/role). When deal_contacts with Apollo data exist, PREFER Apollo-verified fields:

```typescript
// Before: persona derived from contact.title (CRM field, often messy)
// After: prefer deal_contacts.seniority_verified and department_verified

for (const contact of dealContacts) {
  const seniority = contact.seniority_verified   // Apollo
    || parseSeniorityFromTitle(contact.title);     // CRM fallback
  const department = contact.department_verified   // Apollo
    || parseDepartmentFromTitle(contact.title);    // CRM fallback
  // Use these for clustering
}
```

Add to persona pattern output:
- `verified_seniority_distribution`: { c_level: 15%, vp: 30%, director: 40%, manager: 15% } (only when enrichment coverage > 30% of deals)
- `avg_buying_committee_size`: for won vs lost deals
- `winning_committee_composition`: most common role combination in won deals

### 1c. Enhance Company Patterns

Add signal-based patterns:

```typescript
// Group deals by signal presence
const fundingDeals = deals.filter(d => d.has_funding_signal);
const noFundingDeals = deals.filter(d => d.has_enrichment_data && !d.has_funding_signal);

const fundingWinRate = fundingDeals.filter(d => d.outcome === 'won').length / fundingDeals.length;
const noFundingWinRate = noFundingDeals.filter(d => d.outcome === 'won').length / noFundingDeals.length;
const fundingLift = fundingWinRate / overallWinRate;

// Same for hiring, expansion signals
// Same for signal_score buckets (positive >0.5, neutral 0-0.5, negative <0)
```

Add to company pattern output:
- `signal_impact`: { funding_lift: 1.8, hiring_lift: 1.3, expansion_lift: 1.5 } (only when enrichment coverage > 30% of deals)
- `optimal_signal_profile`: "Companies with recent funding and active hiring win at 2.1x"

### 1d. Persist to icp_profiles Table (Final Step)

After synthesis, write the profile:

```typescript
// Deactivate previous active profile
await db.query(`
  UPDATE icp_profiles SET is_active = false 
  WHERE workspace_id = $1 AND is_active = true
`, [workspaceId]);

// Insert new profile
await db.query(`
  INSERT INTO icp_profiles (
    workspace_id, version, is_active, mode,
    company_profile, persona_patterns, scoring_weights,
    model_accuracy, sample_size, generated_at
  ) VALUES ($1, 
    (SELECT COALESCE(MAX(version), 0) + 1 FROM icp_profiles WHERE workspace_id = $1),
    true, $2, $3, $4, $5, $6, $7, NOW()
  )
`, [workspaceId, mode, companyProfile, personaPatterns, scoringWeights, accuracy, sampleSize]);
```

The `scoring_weights` JSONB should contain computed weights that Lead Scoring can consume directly:

```typescript
{
  company: {
    industry_weights: { 'healthcare': 0.85, 'education': 0.60 },
    size_weights: { '51-200': 0.90, '201-500': 0.75 },
    signal_weights: { funding: 0.80, hiring: 0.65, expansion: 0.70 }
  },
  persona: {
    seniority_weights: { c_level: 0.90, vp: 0.85, director: 0.70 },
    role_weights: { champion: 0.95, economic_buyer: 0.85, decision_maker: 0.80 },
    committee_size_optimal: 3
  },
  deal: {
    amount_sweet_spot: { min: 50000, max: 200000 },
    cycle_optimal_days: { min: 30, max: 90 }
  }
}
```

### 1e. Mode Selection (Already Spec'd, Verify It Works)

The skill should check deal count at start and set the mode:

```typescript
// < 30 closed deals with enriched contacts: ABORT
// 30-99: DESCRIPTIVE mode (patterns only, no model)
// 100-199: POINT_BASED mode (patterns + heuristic weights)
// 200+: REGRESSION mode (logistic regression + validated weights)
```

Frontera currently has ~30 deals — this should trigger DESCRIPTIVE mode. The patterns and persona discovery work, but no regression. Scoring weights will be heuristic (derived from win/loss ratios, not statistical model).

---

## Task 2: Lead Scoring — Consume ICP Weights + Persist Scores

### 2a. Load ICP-Derived Weights When Available

Find where DEFAULT_WEIGHTS are loaded. Add ICP weight loading:

```typescript
async function loadScoringWeights(workspaceId: string) {
  // Check for active ICP profile with scoring weights
  const icpProfile = await db.query(`
    SELECT id, scoring_weights, mode, model_accuracy, sample_size
    FROM icp_profiles 
    WHERE workspace_id = $1 AND is_active = true
    LIMIT 1
  `, [workspaceId]);
  
  if (icpProfile.rows.length > 0 && icpProfile.rows[0].scoring_weights) {
    const icpWeights = icpProfile.rows[0].scoring_weights;
    return {
      weights: mergeWeights(DEFAULT_WEIGHTS, icpWeights),
      source: 'icp_profile',
      profileId: icpProfile.rows[0].id,
      mode: icpProfile.rows[0].mode,
      accuracy: icpProfile.rows[0].model_accuracy
    };
  }
  
  return {
    weights: DEFAULT_WEIGHTS,
    source: 'default',
    profileId: null,
    mode: 'point_based',
    accuracy: null
  };
}
```

`mergeWeights` overlays ICP weights onto DEFAULT_WEIGHTS:
- If ICP has a weight for a feature, use it
- If ICP doesn't (sparse data), keep the default
- Never remove a default weight entirely

### 2b. Add Enrichment-Based Scoring Features

In the scoring step, add features from enrichment data:

```typescript
// Enrichment features (only scored when data exists)
const ENRICHMENT_WEIGHTS = {
  has_champion: 15,              // Champion identified in buying committee
  has_economic_buyer: 10,        // Economic buyer identified
  has_decision_maker: 8,         // Decision maker identified
  buying_committee_complete: 12, // 3+ roles identified
  signal_score_positive: 8,      // Account has positive market signals
  seniority_match: 5,            // Contact seniority matches ICP persona
};

// For each deal being scored:
// LEFT JOIN deal_contacts to get buying committee metrics
// LEFT JOIN account_signals to get signal_score
// If no enrichment data exists, skip enrichment features (don't penalize)
```

### 2c. Persist Scores to lead_scores Table

After scoring, write results:

```typescript
// Upsert scores (one row per entity)
for (const scored of scoredDeals) {
  await db.query(`
    INSERT INTO lead_scores (
      workspace_id, contact_id, deal_id, account_id,
      score_type, total_score, grade, breakdown,
      scoring_mode, icp_profile_id, scored_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
    ON CONFLICT (workspace_id, score_type, 
      COALESCE(contact_id, '00000000-0000-0000-0000-000000000000'),
      COALESCE(deal_id, '00000000-0000-0000-0000-000000000000'))
    DO UPDATE SET
      total_score = EXCLUDED.total_score,
      grade = EXCLUDED.grade,
      breakdown = EXCLUDED.breakdown,
      scoring_mode = EXCLUDED.scoring_mode,
      icp_profile_id = EXCLUDED.icp_profile_id,
      scored_at = NOW()
  `, [workspaceId, contactId, dealId, accountId,
      scoreType, totalScore, grade, breakdown, 
      scoringMode, icpProfileId]);
}
```

Note: The lead_scores table has `UNIQUE(workspace_id, entity_type, entity_id)` — check the actual schema and adjust the upsert constraint to match what was migrated.

Grade mapping:
- A: 80-100
- B: 60-79
- C: 40-59
- D: 20-39
- F: 0-19

### 2d. Add Conversation Signal Weights (If Gong/Fireflies Connected)

```typescript
const CONVERSATION_WEIGHTS = {
  call_engagement: 8,           // 2+ calls with transcript on this deal
  recent_call: 5,               // call in last 7 days
  champion_detected: 3,         // champion language in recent calls
  next_steps_explicit: 2,       // latest call had clear next steps
  
  // Negative signals
  sentiment_declining: -8,      // sentiment trending down
  no_calls_advanced_stage: -5,  // deal past demo stage with zero recorded calls
  competitor_heavy: -3,         // 3+ competitor mentions
  long_gap_since_call: -5,      // >14 days since last call on active deal
};

// Only active when workspace has conversation connector
// If no connector, zero out conversation weights automatically
// If deal has no conversations, only apply no_calls_advanced_stage if stage > demo
```

---

## Task 3: Contact Role Resolution — Use Apollo Data

### 3a. Prefer Apollo-Verified Data

In the contact role resolution logic, when apollo_data exists on a deal_contact:

```typescript
// Seniority resolution priority:
// 1. Apollo seniority_verified (highest confidence)
// 2. LinkedIn data (if scraped)
// 3. CRM title parse (fallback)
const seniority = contact.seniority_verified  // From Apollo
  || contact.linkedin_data?.seniority
  || parseSeniorityFromTitle(contact.title);

// Department resolution priority:
// 1. Apollo department_verified
// 2. LinkedIn data
// 3. CRM title parse
const department = contact.department_verified
  || contact.linkedin_data?.department
  || parseDepartmentFromTitle(contact.title);
```

### 3b. Upgrade Role Confidence When Apollo Confirms

```typescript
// If Apollo data confirms a role inference, boost confidence
if (contact.enrichment_status === 'enriched') {
  // Title from Apollo matches role inference from CRM
  if (apolloConfirmsRole(contact.apollo_data, contact.buying_role)) {
    contact.role_confidence = Math.min(contact.role_confidence + 0.2, 1.0);
    contact.role_source = 'apollo_confirmed';
  }
}
```

### 3c. Conversation Participant Match

Add a new resolution source — contacts who appeared on calls but aren't in the deal's CRM associations:

```typescript
// Check conversations linked to this deal
// If a participant email matches a contact in the CRM
// but that contact isn't in deal_contacts, add them
// Confidence: 0.65 (they were actually present on the call)
// role_source: 'conversation_participant'
// buying_role: 'unknown' (classify later via DeepSeek or ICP Discovery)
```

---

## Task 4: Pipeline Hygiene — ICP-Aware Risk Signals

### 4a. Add ICP Grade to Pipeline Hygiene Compute

In the step that gathers pipeline data, join lead_scores:

```typescript
const dealScores = await db.query(`
  SELECT deal_id, total_score, grade
  FROM lead_scores
  WHERE workspace_id = $1 AND score_type = 'deal'
`, [workspaceId]);

for (const deal of pipelineDeals) {
  const score = dealScores.find(s => s.deal_id === deal.id);
  deal.icp_grade = score?.grade || null;
  deal.icp_score = score?.total_score || null;
}
```

### 4b. Add ICP-Aware Risk Signals

```typescript
// Stale deal that's A-grade ICP fit = high priority recovery
if (deal.days_stale > staleDealThreshold && deal.icp_grade === 'A') {
  riskSignals.push({
    type: 'high_fit_stale',
    severity: 'high',
    message: `${deal.name} is stale but A-grade ICP fit ($${deal.amount}) — high priority recovery`
  });
}

// Low-fit deal consuming rep time
if (deal.icp_grade === 'F' && deal.days_in_stage < 14) {
  riskSignals.push({
    type: 'low_fit_active',
    severity: 'medium',
    message: `${deal.name} is F-grade ICP fit — consider deprioritizing`
  });
}
```

### 4c. Add to Claude Synthesis

Include in the synthesis prompt when ICP scores exist:

```
{{#if hasIcpScores}}
ICP-Fit Analysis:
- {{aGradeCount}} deals are A-grade ICP fit ({{aGradeValue}} pipeline value)
- {{fGradeCount}} deals are F-grade ICP fit — consider deprioritizing
- {{staleAGradeCount}} stale deals are A-grade — highest priority for recovery
{{/if}}
```

---

## Task 5: Forecast Roll-up — ICP-Adjusted Forecast

Lower priority. Only if Tasks 1-4 are complete.

Add to forecast synthesis:

```
{{#if hasIcpScores}}
ICP-Adjusted Forecast:
- Commit pipeline: ${{commitTotal}} total, ${{commitIcpAB}} in A/B-grade ICP fit
- Best case pipeline: ${{bestCaseTotal}} total, ${{bestCaseIcpAB}} in A/B-grade ICP fit
- Historical: A/B-grade deals close at {{abCloseRate}}%, C/D/F at {{cdfCloseRate}}%
{{/if}}
```

---

## Validation

After implementing all tasks, test against Frontera's workspace:

### Test 1: ICP Discovery
```
1. Run ICP Discovery skill
2. Verify feature matrix includes enrichment columns:
   - buying_committee_size, signal_score for deals with enrichment data
   - NULL values for deals without enrichment (graceful degradation)
3. Verify persona patterns use Apollo-verified seniority where available
4. Verify company patterns include signal-based analysis (funding lift, etc.)
5. Verify new icp_profiles row is created with:
   - is_active = true (previous deactivated)
   - version incremented
   - scoring_weights populated
   - mode = 'descriptive' (Frontera has ~30 deals)
6. Log: profile version, mode, sample size, enrichment coverage %
```

### Test 2: Lead Scoring
```
1. Run Lead Scoring skill
2. Verify it loads ICP weights from icp_profiles (from Test 1)
3. Verify enrichment features are evaluated:
   - has_champion, has_economic_buyer for deals with deal_contacts
   - signal_score for deals with account_signals
   - Skipped for deals without enrichment (no penalty)
4. Verify scores are persisted to lead_scores table
5. Verify grades assigned correctly (A/B/C/D/F)
6. Log: scoring source (icp_profile vs default), top 5 scored deals with grades
```

### Test 3: Contact Role Resolution
```
1. Run Contact Role Resolution on a deal with deal_contacts
2. Verify Apollo seniority is preferred over CRM title
3. Verify role confidence boosted when Apollo confirms
4. Log: roles found, sources, confidence levels
```

### Test 4: Pipeline Hygiene
```
1. Run Pipeline Hygiene after Lead Scoring has populated lead_scores
2. Verify ICP grade appears in pipeline analysis
3. Verify "high_fit_stale" and "low_fit_active" risk signals appear where applicable
4. Verify Claude synthesis mentions ICP-fit analysis
```

### Test 5: Forecast Roll-up
```
1. Run Forecast Roll-up after Lead Scoring
2. Verify ICP-adjusted forecast section appears
3. Verify A/B-grade pipeline value is calculated correctly
```

---

## DO NOT

- Modify the enrichment pipeline (apollo.ts, serper.ts, etc.) — that's already working
- Modify the deal_contacts or account_signals table schemas
- Build regression mode for ICP Discovery — Frontera doesn't have enough deals yet
- Add LinkedIn enrichment — stubbed but not yet implemented
- Create new skills — you're enhancing 3-5 existing ones
- Run enrichment during ICP Discovery — it reads pre-existing enrichment data only
- Penalize deals without enrichment data in Lead Scoring — absence of data ≠ negative signal
- Auto-activate ICP profiles — write as is_active = true for now (draft review flow comes later)
