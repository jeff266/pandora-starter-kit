# Frontera Health — Onboarding Validation Report
**Workspace:** `4160191d-73bc-414b-97dd-5a1853190378`  
**Date:** February 13, 2026  
**Validation Type:** Comprehensive (Data + Skills + Enrichment)

---

## 1. Data Foundation

### Connector Status
| Connector | Status | Last Sync |
|-----------|--------|-----------|
| HubSpot | healthy | 2026-02-11 21:03:29 |
| Gong | healthy | 2026-02-11 07:36:28 |
| Enrichment Config | connected | — |

### Entity Counts
| Entity | Count |
|--------|-------|
| Deals | 386 |
| Contacts | 3,990 |
| Accounts | 1,690 |
| Activities | 0 |
| Conversations | 22 |
| Calls | 0 |
| Deal Contacts | 1,080 |

### Deal Stage Distribution
| Stage | Count |
|-------|-------|
| closed_lost | 208 |
| closed_won | 67 |
| evaluation | 61 |
| negotiation | 28 |
| awareness | 13 |
| decision | 6 |
| qualification | 3 |

### Computed Fields Coverage
| Field | Populated | Total |
|-------|-----------|-------|
| velocity_score | 386 | 386 |
| deal_risk | 386 | 386 |
| health_score | 386 | 386 |
| days_in_stage | 0 | 386 |

### Contact Roles (Buying Roles)
| Role | Count |
|------|-------|
| (empty) | 334 |
| decision_maker | 329 |
| influencer | 327 |
| unknown | 39 |
| champion | 34 |
| economic_buyer | 6 |
| technical_evaluator | 6 |
| end_user | 5 |

### Issues Found
1. **days_in_stage = 0 for all 386 deals** — Stage duration is not being computed. The `refresh-computed-fields` endpoint does not update this field.
2. **Activities = 0** — No activity records synced from HubSpot. This may affect engagement scoring and deal risk calculations.
3. **Calls = 0** — No call records (Gong conversations are present but not mapped to `calls` entity).
4. **Custom Fields = 0 discovered** — Only `hs_object_id` present in HubSpot custom fields. No business-relevant fields (MEDDPIC, BANT, etc.) found.

---

## 2. Custom Field Discovery

| Metric | Value |
|--------|-------|
| Duration | 322ms |
| Fields Scanned | 3 |
| Passed Filters | 0 |
| Scored Above 50 | 0 |
| Framework Detected | None |

No qualification framework fields found. HubSpot instance has minimal custom field usage.

---

## 3. Tier 1 Skills Results

### Summary Table

| # | Skill | Status | Duration | Claude Tokens | DeepSeek Tokens | Key Finding |
|---|-------|--------|----------|---------------|-----------------|-------------|
| 1 | pipeline-hygiene | completed | 36.8s | 3,780 | 703 | Pipeline deteriorated: 79% stale ($8.5M), coverage 2.1x vs 3.0x target |
| 2 | deal-risk-review | completed | 5.4s | 1,473 | 278 | Data serialization issue — `[object Object]` in context. Report generated with limited data |
| 3 | weekly-recap | completed | 65.8s | 189,723 | 667 | Full weekly summary generated. Wins: Kozak Consulting $1,080, Be Yourself ABA $2,700 |
| 4 | single-thread-alert | completed | 60.8s | 1,614 | 497 | Data serialization issue — `[object Object]` in context |
| 5 | data-quality-audit | completed | 34.3s | 3,633 | 1,216 | Grade: C+ (74% overall, 92% critical). 9 conversations without deals, 36 past-due close dates |
| 6 | pipeline-coverage | completed | 30.9s | 2,050 | 916 | Critical: $1.44M pipeline vs $2.8M quota = 0.5x coverage (need 3x). Short $6.86M |
| 7 | forecast-rollup | completed | 76.5s | 5,540 | 793 | Tracking to $429K-$457K (15-16% of $2.8M quota). $2.3M+ shortfall |
| 8 | pipeline-waterfall | completed | 27.6s | 2,449 | 411 | Zero velocity: 74 new deals but none moved stages. Static snapshot, not actual flow |
| 9 | rep-scorecard | completed | 35.5s | 2,510 | 719 | $4.58M open pipeline, only $34.5K closed. Strong prospecting, weak conversion |

### Token Usage Summary
- **Total Claude tokens:** 213,049
- **Total DeepSeek tokens:** 6,200
- **Total execution time:** 373.6s (~6.2 minutes)

### Issues Identified
1. **deal-risk-review**: DeepSeek classification returned error object instead of array — data serialization issue with `[object Object]` in template context.
2. **single-thread-alert**: Same `[object Object]` data serialization issue.
3. **weekly-recap**: Unusually high Claude token usage (189,723) due to 5 tool calls during synthesis step. Consider capping tool call budget.
4. **pipeline-waterfall**: Reports zero velocity — all deals appear static. This is a data initialization artifact since deals were bulk-synced.
5. **Handlebars template parse error**: `data-quality-audit` and `forecast-rollup` templates have `=== 'file_import'` in Handlebars conditionals which is invalid syntax. Falls back to simple replacement but loses template logic.
6. **Conversation features SQL error**: ICP Discovery step 2.5 failed with "could not determine data type of parameter $2" — non-fatal, degrades to Tier 0.

---

## 4. ICP Discovery

| Metric | Value |
|--------|-------|
| Duration | 66.0s |
| Claude Tokens | 5,045 |
| DeepSeek Tokens | 4,090 |
| Status | completed |

### Key Findings
- **Primary ICP:** Healthcare delivery organizations
  - Hospital & Health Care: 42.1% win rate, $4,798 avg deal
  - Health, Wellness & Fitness: 35.7% win rate, $2,808 avg deal
- **Winning Buying Committee:**
  - Director-level + Manager-level personas
  - Directors in 32.8% of won deals
  - Managers show strongest lift at 3.73x
- **Top Personas by Lift:**
  1. Manager Unknown — 3.73x lift, $15,283 avg deal
  2. Director Unknown — 1.48x lift, $12,718 avg deal
  3. C-level Executive — 1.06x lift
- **Signal-Based Lift Analysis:**
  - Funding signals: 2.33x lift
  - Hiring signals: 1.91x lift
  - Expansion signals: 1.67x lift
- **ICP Profile Persisted:** `12195d64-719f-4078-83d4-3d919cf45b1d`
- **Mode:** Point-based (275 closed deals, 67 won, 208 lost)

---

## 5. Lead Scoring

| Metric | Value |
|--------|-------|
| Duration | 37.1s |
| Claude Tokens | 1,858 |
| DeepSeek Tokens | 621 |
| Status | completed |

### Key Findings
- **Average Deal Score: 21/100 (F grade)**
- **Zero A or B grade opportunities** out of 111 deals
- **Grade Distribution:** A=0, B=0, C=0, D=32, F=79
- **79 deals (71%) are failing**
- **Top deal: 48/100** (Easterseals Northern California)
- Top 3 deals: Easterseals (48), ACES ABA (45), ABS Kids (42)
- Five Fellowship deals all scoring 8/100
- Scored 111 deals and 336 contacts using ICP profile

---

## 6. Overall Assessment

### Health Score: C+
The data foundation is solid with good entity counts and healthy connectors. However, several issues limit the platform's effectiveness:

### Critical Issues (Must Fix)
1. **Data Serialization Bug** — deal-risk-review and single-thread-alert skills receive `[object Object]` instead of actual data in LLM context. This means two important skills produce limited value.
2. **days_in_stage not computed** — All 386 deals show 0, affecting pipeline velocity and stale deal analysis.
3. **Zero activities synced** — Activities entity is empty, which limits engagement scoring accuracy.

### Moderate Issues (Should Fix)
4. **weekly-recap token budget** — 189,723 Claude tokens for a single run is excessive. The 5 tool calls during synthesis should be reduced.
5. **Pipeline Waterfall shows zero velocity** — Artifact of bulk sync. Needs historical stage change data to be meaningful.
6. **No custom fields / qualification framework** — HubSpot instance lacks MEDDPIC/BANT fields, limiting scoring precision.

### Working Well
- All 12 skills completed successfully (no crashes)
- ICP Discovery produced actionable insights with clear vertical identification
- Pipeline coverage, forecast, and rep scorecard all generated useful output
- Data quality audit correctly identified key gaps
- Enrichment pipeline (Apollo + Serper) is functional
- Contact role resolution produced 7 unique buying roles with 746 classified contacts
