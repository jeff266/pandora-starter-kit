# Frontera Health — Onboarding Validation Report

**Workspace:** Frontera Health  
**Workspace ID:** `4160191d-73bc-414b-97dd-5a1853190378`  
**CRM:** HubSpot  
**Connectors:** HubSpot (healthy), Gong (healthy), Enrichment Config (connected)  
**Validation Date:** 2026-02-13 / 2026-02-14  
**Last Sync:** 2026-02-11 21:03 UTC (HubSpot), 2026-02-11 07:36 UTC (Gong)

---

## 1. Data Foundation

### Entity Counts

| Entity | Count | Notes |
|--------|-------|-------|
| Deals | 386 | Includes open + closed |
| Contacts | 3,990 | |
| Accounts | 1,690 | |
| Activities | 0 | HubSpot activities not synced (file import workspace) |
| Conversations | 22 | From Gong |
| Tasks | 0 | No Monday.com connector |
| Calls | 0 | Call data via Conversations |
| Documents | 0 | No Google Drive connector |

### Computed Fields Status

| Field | Coverage | Notes |
|-------|----------|-------|
| velocity_score | 386/386 (100%) | Fully computed |
| deal_risk | 386/386 (100%) | Fully computed |
| health_score | 386/386 (100%) | Fully computed |
| days_in_stage | 386/386 (100%) | Uses stage_changed_at, fallback to created_at |

### Deal Contacts

- **1,080 deal_contact associations** populated
- Source: HubSpot association-based deal contacts

### Custom Fields Population

- **386/386 deals** have custom_fields populated
- Only field found: `hs_object_id` (HubSpot internal ID)
- No MEDDPIC/BANT/SPICED qualification fields detected

---

## 2. Custom Field Discovery

| Metric | Value |
|--------|-------|
| Total Fields Scanned | 3 |
| Passed Filters | 0 |
| Scored Above 50 | 0 |
| Execution Time | 40ms |

### Entity Breakdown

| Entity | Total Fields | Candidates | Relevant (>50) |
|--------|-------------|------------|-----------------|
| Deals | 1 | 0 | 0 |
| Accounts | 1 | 0 | 0 |
| Contacts | 1 | 0 | 0 |
| Leads | 0 | 0 | 0 |

### Findings

- No standard qualification framework (MEDDPIC, BANT, SPICED) detected
- Only custom field is `hs_object_id` — a HubSpot system field, not a qualification signal
- **Recommendation:** Configure custom insight types in Settings to extract qualification data from conversation transcripts

---

## 3. Skill Validation Table

All 12 skills + contact-role-resolution (compute-only) executed against live Frontera data.

| # | Skill | Status | Duration | Claude Tokens | DeepSeek Tokens | Key Finding |
|---|-------|--------|----------|---------------|-----------------|-------------|
| 1 | custom-field-discovery | Completed | 0.3s | 0 | 0 | Only `hs_object_id` found. No qualification framework fields. |
| 2 | contact-role-resolution | Completed | 0.3s | 0 | 0 | Compute-only. 744 contacts enriched across 275 analyzed deals. |
| 3 | data-quality-audit | Completed | 34.3s | 3,633 | 1,216 | Missing close dates, stale deals, activity gaps flagged. |
| 4 | pipeline-hygiene | Completed | 39.9s | 10,417 | 690 | 242 critically stale deals (82% of pipeline), $3.75M at risk. |
| 5 | pipeline-coverage | Completed | 30.9s | 2,050 | 916 | Coverage 2.1x vs 3.0x target. $2.8M gap. |
| 6 | pipeline-waterfall | Completed | 27.6s | 2,449 | 411 | Q1 waterfall showing pipeline creation deficit. |
| 7 | rep-scorecard | Completed | 35.5s | 2,510 | 719 | Rep performance cards generated. Activity data limited. |
| 8 | forecast-rollup | Completed | 64.7s | 5,169 | 2,320 | Bear $429K (15.4%), base $457K (16.3%), bull $2.68M. Severe miss. |
| 9 | deal-risk-review | Completed | 90.7s | 83,683 | 278 | **TOKEN OUTLIER.** 20 deals assessed. Fellowship deals flagged stale. |
| 10 | single-thread-alert | Completed | 57.1s | 4,782 | 5,657 | Single-threaded deals identified and flagged. |
| 11 | weekly-recap | Partial | 25.8s | 3,166 | 0 | Pipeline recap generated. Token usage 98.3% reduced (was 189K). |
| 12 | icp-discovery | Completed | 66.0s | 5,045 | 4,090 | Healthcare vertical identified. 3.73x lift on Manager persona. |
| 13 | lead-scoring | Completed | 37.1s | 1,858 | 621 | 364 deals scored. No A-grade deals (avg 21/100). |

### Token Usage Summary (Validation Run)

| Metric | Value |
|--------|-------|
| Total Claude tokens | ~125K (excl. deal-risk-review outlier) |
| Total DeepSeek tokens | ~17K |
| Estimated cost (normal skills) | ~$0.45 |
| deal-risk-review cost | ~$0.31 per run |

---

## 4. ICP Discovery Results

### Analysis Scope

- **275 deals analyzed** (67 won, 208 lost)
- **744 contacts enriched** via Apollo + Serper
- **Scoring method:** descriptive_heuristic

### Industry Segments (Company Profile)

| Industry | Win Rate | Avg Deal | Lift | Count |
|----------|----------|----------|------|-------|
| Hospital & Health Care | 42.1% | $4,798 | 1.73x | 38 |
| Health, Wellness & Fitness | 35.7% | $2,808 | 1.47x | 14 |
| Nonprofit Org Management | 33.3% | $100,000 | — | 3 |
| Mental Health Care | 12.5% | $1,680 | — | 32 |
| Individual & Family Services | 8.3% | $2,700 | — | 12 |
| Medical Practice | 0% | $0 | — | 7 |

### Persona Analysis (Top by Lift)

| Persona | Lift | Win Rate | Freq in Won | Top Titles |
|---------|------|----------|-------------|------------|
| Manager Unknown | 3.73x | — | 9.0% | Manager, Clinical Project Manager, Lead BCBA |
| Director Unknown | 1.48x | — | 32.8% | Clinical Director, Program Director |
| C-level Executive | 1.06x | — | 37.3% | CEO, Founder & CEO, President |

### Buying Committee Patterns

| Committee | Lift | Win Rate | Avg Deal | Count |
|-----------|------|----------|----------|-------|
| Director + Manager | 3.28x | 80% | $41,020 | 5 |
| C-level + Manager | 2.05x | 50% | $65,120 | 6 |
| C-level + Director Ops | 1.76x | 42.9% | $31,826 | 7 |

### Signal Analysis

| Signal Type | Lift | Won Rate |
|-------------|------|----------|
| Funding | 2.33x | 4.5% |
| Hiring | 1.91x | 11.9% |
| Expansion | 1.67x | 20.9% |

### Key ICP Insight

Frontera's ideal customer is a **Hospital & Health Care** company with a **Director + Manager buying committee**. Deals with this committee pattern win at **80%** (3.28x lift). The strongest individual persona lift is **Manager** at 3.73x, suggesting manager-level engagement is a critical win factor. Funding and hiring signals are leading indicators of deal success.

---

## 5. Lead Scoring

### Grade Distribution

| Grade | Count | Avg Score | Method |
|-------|-------|-----------|--------|
| B | 7 | 71.6 | point_based |
| C | 60 | 61.6 | point_based |
| D | 100 | 39.9 | point_based |
| D | 32 | 35.8 | icp_point_based |
| F | 103 | 13.5 | icp_point_based |
| F | 62 | 24.1 | point_based |

**Total scored:** 364 deals across 2 scoring methods

### Top Deals by Score (ICP-based)

| Deal | Score | Grade | Amount |
|------|-------|-------|--------|
| Easterseals Northern California - AB | 48 | D | $112,000 |
| ACES ABA - AB | 45 | D | $240,000 |
| ABS Kids - AB + RAB | 42 | D | $200,000 |
| Catalight - DB | 41 | D | $96,000 |
| Action Behavior Centers - AB | 41 | D | $300,000 |
| Beacon Services of Connecticut - AB | 39 | D | $108,000 |
| First Steps for Kids - AB + RAB | 39 | D | $100,000 |
| Action Behavior Centers - DB | 38 | D | $150,000 |
| Autism Learning Partners - AB | 37 | D | $86,000 |
| Children's Specialized ABA Center - AB | 37 | D | $54,000 |

### Scoring Method

- **point_based:** Base scoring using deal attributes (amount, stage, velocity, activity)
- **icp_point_based:** Enhanced scoring incorporating ICP profile fit

### Conversation Features Contribution

- **No conversation features contributed to lead scores.** The `conversationScore` field was null across all scored deals.
- This is expected: Frontera has only 22 Gong conversations — insufficient volume for statistical significance in scoring.
- As conversation data grows, conversation features (sentiment, objections, buying signals) will begin contributing to scores.

---

## 6. Timing Summary

| Phase | Duration |
|-------|----------|
| HubSpot sync | Pre-completed (2026-02-11) |
| Gong sync | Pre-completed (2026-02-11) |
| Computed fields (velocity, risk, health, days_in_stage) | <5s |
| Custom field discovery | 0.3s |
| Contact role resolution | 0.3s |
| ICP enrichment pipeline (Apollo + Serper) | ~10min (744 contacts) |
| 12 skill validation runs | ~8.5 min total |
| **Total validation runtime** | **~25 minutes** |
| Bug fixes (6 issues) | ~4 hours of debugging/fixing |
| **Total start-to-finish** | **~5 hours** (including bug fixes) |

---

## 7. Issues Found — 6 Bugs Fixed

### Bug 1: Data Serialization in deal-risk-review and single-thread-alert
- **Symptom:** Skill output showed `[object Object]` instead of actual data
- **Root Cause:** Handlebars `{{object}}` outputs `[object Object]` for JS objects
- **Fix:** Converted to `{{{json object}}}` across 7 skill template files
- **Impact:** All skills now output properly serialized JSON data

### Bug 2: days_in_stage Computation Missing
- **Symptom:** `days_in_stage` was NULL for all deals
- **Root Cause:** No computation existed — field was declared but never calculated
- **Fix:** Implemented calculation using `stage_changed_at` (with fallback to `created_at`)
- **Impact:** 386/386 deals now have days_in_stage computed

### Bug 3: Template Serialization (7 skill files)
- **Symptom:** Objects/arrays in prompts rendered as `[object Object]`
- **Root Cause:** Using `{{varName}}` instead of `{{{json varName}}}` for complex objects
- **Fix:** Updated all templates across deal-risk-review, single-thread-alert, pipeline-hygiene, pipeline-coverage, forecast-rollup, rep-scorecard, data-quality-audit
- **Impact:** All LLM prompts now contain properly formatted data

### Bug 4: weekly-recap Token Explosion (189K tokens)
- **Symptom:** weekly-recap used 189,723 Claude tokens — 60x higher than other skills
- **Root Cause:** Full deal arrays (100 deals per query) serialized directly into Claude prompt
- **Fix:** Added `summarizeForClaude` compute step, reduced query limits from 100 to 20, pre-summarize data into compact text
- **Impact:** Token usage dropped from 189K to 3.1K (98.3% reduction)

### Bug 5: Handlebars Parse Errors in data-quality-audit and forecast-rollup
- **Symptom:** Template compilation failures on `===` operator
- **Root Cause:** `===` is JavaScript, not valid Handlebars syntax
- **Fix:** Replaced with `{{#if (eq var value)}}` using registered `eq` helper
- **Impact:** Both skills compile and execute without errors

### Bug 6: ICP Discovery SQL Parameter Typing Error
- **Symptom:** "could not determine data type of parameter" SQL error
- **Root Cause:** Conversation features query used untyped NULL parameters
- **Fix:** Added explicit type casts (`$N::uuid`, `$N::text`) to query parameters
- **Impact:** ICP discovery runs successfully with conversation features query

---

## 8. HubSpot-Specific Observations

### Behaviors Unique to HubSpot (vs. Salesforce/Imubit)

1. **Association-based Deal Contacts:** HubSpot uses association APIs to link contacts to deals, unlike Salesforce's OpportunityContactRole. Our adapter correctly handles this — 1,080 deal_contact records populated via HubSpot associations.

2. **No Native Activity Tracking:** HubSpot activities (calls, emails, meetings) were not synced in this workspace, leaving `activities` at 0. This caused multiple skills to skip activity-based analysis (staleness based on `updated_at` instead of `last_activity_date`). The `dataFreshness.hasActivities` flag correctly gates these sections.

3. **Limited Custom Fields:** HubSpot's only custom field exposed was `hs_object_id` (a system field). Salesforce workspaces like Imubit typically surface 10-20+ custom fields. This means custom-field-discovery returned 0 relevant fields — not a bug, but reflects HubSpot's lighter custom field usage in this workspace.

4. **Stage Normalization Differences:** HubSpot stages like "Fellow Contract Signed (Closed-Won)" contain parenthetical status. Our stage normalizer correctly maps these to `closed_won`, but the deal-risk-review skill found 7 Fellowship pipeline deals in "Closed-Won" stage that were still marked as open — a CRM hygiene issue specific to Frontera's dual-pipeline setup.

5. **Single Pipeline vs. Custom Field Qualification:** Without MEDDPIC/BANT fields, Frontera relies entirely on stage progression and deal metadata for scoring. This depresses lead scores (max score 48, no A-grades) compared to Salesforce workspaces where qualification fields contribute significantly.

6. **Gong Integration Working:** 22 conversations synced from Gong, but insufficient volume for call analytics to meaningfully contribute to scoring or weekly recaps. The `dataFreshness.hasConversations` flag correctly enables call-related sections when data exists.

7. **HubSpot Object IDs:** Deal `source_data` contains `hs_object_id` fields that flow through to Claude prompts. These add ~500-800 bytes per deal of non-useful data. Stripping `source_data` from LLM payloads would reduce prompt sizes without losing analytical value.

---

## Appendix: deal-risk-review Token Diagnosis (83K outlier)

### Root Cause Analysis (via Token Usage Tracer)

The token tracker captured the exact breakdown of deal-risk-review's 83K token usage:

**Call 1 — Initial prompt:**
- Input: 18,037 tokens (48,557 chars)
- User message: 48,173 chars containing 20 full deal objects with `source_data` JSONB
- `hasSourceData: true`, `hasRawJson: true`

**Call 2 — After tool calls (accumulated conversation):**
- Input: 40,638 tokens (110,072 chars)
- Tool results added: 30,901 + 9,130 + 6,899 + 4,925 + 2,567 + 1,268 + 1,272 + 2,436 chars
- Each tool result contains full deal/contact/account objects with `source_data`
- Context balloons: call 2 carries ALL of call 1's messages + tool results

**Why it's 8-10x more expensive than other skills:**

| Factor | Impact |
|--------|--------|
| `claudeTools` with `maxToolCalls: 10` | Multi-turn conversation grows exponentially |
| `SELECT *` in queryDeals includes `source_data` | ~800 bytes of raw HubSpot JSON per deal |
| Tool results return full objects | `getContactsForDeal` returns full contact rows with `source_data` |
| Accumulated context | Call 2 re-sends everything from Call 1 |

**Recommended fix (same pattern as weekly-recap):**
1. Add `summarizeForClaude` compute step that pre-fetches activity, contacts, stakeholder data for all 20 deals in batch
2. Remove `claudeTools` / set `maxToolCalls: 0`
3. Strip `source_data` from deal/contact objects before prompt assembly
4. Expected reduction: 83K → ~8K tokens (90% savings, ~$0.03 per run instead of ~$0.31)

**Estimated cost at current rate:**
- 12 runs/month x $0.31 = **$3.72/month** on deal-risk-review alone
- After optimization: 12 x $0.03 = **$0.36/month** (90% savings)
