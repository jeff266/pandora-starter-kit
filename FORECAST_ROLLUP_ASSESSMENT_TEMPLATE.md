# Forecast Roll-up Skill Assessment

**Date:** February 11, 2026
**Workspace:** Frontera Health (HubSpot)
**Status:** Assessment In Progress

---

## Instructions

Run the assessment queries on Replit and paste results below:

### Option 1: Run Shell Script
```bash
chmod +x scripts/assess-forecast-rollup.sh
./scripts/assess-forecast-rollup.sh > FORECAST_ROLLUP_ASSESSMENT.md
```

### Option 2: Run SQL Queries Manually
```bash
psql $DATABASE_URL -f scripts/assess-forecast-rollup.sql
```

Then paste the results into the sections below.

---

## 1. Category Distribution

### Open Deals Only (Stage != Closed Won/Lost)

```
[PASTE RESULTS HERE]

Expected format:
forecast_category | source  | deal_count | total_value | avg_probability | min_probability | max_probability
------------------|---------|------------|-------------|-----------------|-----------------|----------------
best_case         | derived | ?          | ?           | ?               | ?               | ?
commit            | derived | ?          | ?           | ?               | ?               | ?
pipeline          | derived | ?          | ?           | ?               | ?               | ?
not_forecasted    | derived | ?          | ?           | ?               | ?               | ?
```

### Analysis

**Distribution Assessment:**
- [ ] Are deals spread across commit/best_case/pipeline or lumped into one category?
- [ ] Is the not_forecasted count reasonable (closed-lost + stale)?
- [ ] Do average probabilities match expected ranges?
  - commit: should be ~0.90-0.99
  - best_case: should be ~0.60-0.89
  - pipeline: should be ~0.10-0.59
  - not_forecasted: should be ~0.00-0.10

**Red Flags:**
- If 90%+ of deals are in ONE category → thresholds need adjustment
- If commit has 0 deals but best_case has many → commit threshold too high (lower from 90% to 85%)
- If not_forecasted has 70%+ of deals → many stale/dead deals need cleanup

---

## 2. Quota Status

### Quota Periods

```
[PASTE RESULTS HERE]

Expected format:
id   | name      | period_type | start_date | end_date   | team_quota
-----|-----------|-------------|------------|------------|------------
?    | Q1 2026   | quarterly   | 2026-01-01 | 2026-03-31 | 1000000
```

### Rep Quotas

```
[PASTE RESULTS HERE]

Expected format:
period_name | rep_name  | quota_amount
------------|-----------|-------------
Q1 2026     | John Doe  | 100000
Q1 2026     | Jane Smith| 150000
```

### Analysis

**Quota Mode:**
- [ ] Quotas exist → Skill runs in "with quotas" mode (attainment % shown)
- [ ] No quotas → Skill runs in degraded mode (absolute $ only, no attainment %)

**Impact:**
- If no quotas: Skill output will say "Setup needed" and lack attainment context
- If quotas exist: Skill will show "John is at 85% of $100K quota" style insights

---

## 3. Forecast Roll-up Skill Runs

### Recent Runs

```
[PASTE RESULTS HERE]

Expected format:
id   | skill_id       | status    | created_at          | completed_at        | duration_seconds
-----|----------------|-----------|---------------------|---------------------|------------------
?    | forecast-rollup| completed | 2026-02-11 14:00:00 | 2026-02-11 14:00:05 | 5
```

### Latest Run ID

```
Latest Run ID: [PASTE ID HERE]
```

---

## 4. Scenario Spread (Step 2: gather-forecast-data)

### Team-Level Numbers

```
[PASTE result JSON HERE - look for these fields in the result column]

Expected format:
{
  "closedWon": 500000,
  "commit": 100000,
  "bestCase": 200000,
  "pipeline": 300000,
  "weighted": 650000,
  "bearCase": 600000,
  "baseCase": 700000,
  "bullCase": 800000
}
```

### Analysis

**Scenario Spread Calculation:**
```
Bear-Bull Spread: (bullCase - bearCase) / quota * 100
Example: ($800K - $600K) / $1M * 100 = 20%
```

**Assessment:**
- [ ] Spread >= 20%: Scenarios provide meaningful range (GOOD)
- [ ] Spread 10-20%: Moderate spread (ACCEPTABLE)
- [ ] Spread < 10%: Scenarios too homogeneous (BAD - thresholds need tuning)

**Red Flags:**
- If bear ≈ bull: Category buckets are too similar in value
- If weighted ≈ baseCase: Probability weighting not adding value
- If closedWon > commit + bestCase + pipeline: Pipeline is thin (normal for mature deals)

---

## 5. By-Rep Breakdown

### Rep-Level Data

```
[PASTE byRep array from result JSON]

Expected format:
[
  {
    "name": "John Doe",
    "closedWon": 50000,
    "commit": 10000,
    "bestCase": 20000,
    "pipeline": 30000,
    "status": "on_track"
  },
  {
    "name": "Jane Smith",
    "closedWon": 75000,
    "commit": 15000,
    "bestCase": 25000,
    "pipeline": 40000,
    "status": "at_risk"
  }
]
```

### Analysis

**Status Distribution:**
- [ ] How many reps are "on_track"?
- [ ] How many reps are "at_risk"?
- [ ] How many reps are "off_track"?
- [ ] How many reps are "crushing"?

**Red Flags:**
- If ALL reps have same status → thresholds too loose/tight
- If 80%+ are "off_track" → thresholds too aggressive
- If 80%+ are "on_track" → thresholds too lenient
- Healthy distribution: Mix of statuses (30-40% on_track, 30-40% at_risk, rest split)

---

## 6. Week-over-Week Delta

### Previous Run (if exists)

```
[PASTE previous run result JSON]

Expected format:
{
  "id": "previous-run-id",
  "created_at": "2026-02-04 14:00:00",
  "result": {
    "closedWon": 480000,
    "commit": 90000,
    "bestCase": 190000,
    "pipeline": 290000
  }
}
```

### Delta Analysis

```
[IF NO PREVIOUS RUN EXISTS]
⚠️ No previous run found. Week-over-week comparison not testable yet.
Run the skill again next week to enable WoW delta detection.

[IF PREVIOUS RUN EXISTS]
Category Changes:
- closedWon: $480K → $500K (+$20K, +4.2%)
- commit: $90K → $100K (+$10K, +11.1%)
- bestCase: $190K → $200K (+$10K, +5.3%)
- pipeline: $290K → $300K (+$10K, +3.4%)

Deals that moved between categories: [COUNT]
```

### Analysis

**WoW Delta Assessment:**
- [ ] Are deltas meaningful (>5% change)?
- [ ] Is the skill detecting deal movement between categories?
- [ ] Do the changes make business sense?

**Red Flags:**
- If all categories have <2% change → pipeline is stagnant
- If commit decreased but closedWon didn't increase → deals slipping
- If pipeline increased but commit/bestCase didn't → deals not progressing

---

## 7. Synthesized Output (Claude Narrative)

### Final Output Text

```
[PASTE output_text column from skill_runs table]

Expected format:
# Forecast Roll-up: Week of Feb 11, 2026

## Team Status
You're at 65% of quota with $650K in weighted pipeline...

## By Rep
- **John Doe** (on track): Currently at 60% of $100K quota...
- **Jane Smith** (at risk): Currently at 55% of $150K quota...

## Week-over-Week
- Commit increased by $10K (+11%)...
- 3 deals moved from pipeline to best_case...

## Recommendations
1. Focus on advancing the 5 best_case deals to commit...
2. John Doe needs more pipeline coverage...
```

### Analysis

**Tone Assessment:**
- [ ] Is the narrative specific (names deals/reps) or generic?
- [ ] Does it provide actionable guidance or filler?
- [ ] Is the language appropriate for sales leaders?

**Content Assessment:**
- [ ] Does it explain what the numbers mean?
- [ ] Does it highlight risks/opportunities?
- [ ] Does it give concrete next steps?

**Red Flags:**
- Generic phrases like "pipeline looks healthy" without specifics
- No mention of individual reps or deals
- No actionable recommendations
- Reads like a summary of numbers without insights

---

## 8. Overall Assessment

### Production Readiness Checklist

**Data Quality:**
- [ ] All open deals have forecast_category populated
- [ ] Category distribution is reasonable (not 90% in one bucket)
- [ ] Probabilities align with forecast categories

**Skill Functionality:**
- [ ] Skill runs successfully (status = completed)
- [ ] Runtime is reasonable (<30 seconds)
- [ ] Result JSON has all expected fields

**Scenario Quality:**
- [ ] Bear-Bull spread is >= 10% (scenarios add value)
- [ ] Weighted forecast differs from baseCase (probability weighting works)
- [ ] Numbers align with actual pipeline state

**Rep Insights:**
- [ ] Multiple status values (not all same)
- [ ] Status makes sense based on attainment
- [ ] Rep breakdown provides useful granularity

**Narrative Quality:**
- [ ] Output is specific and actionable
- [ ] Highlights key risks/opportunities
- [ ] Appropriate tone for sales leaders

**WoW Comparison:**
- [ ] Previous run exists (or will after second run)
- [ ] Delta detection works correctly
- [ ] Movement tracking provides insights

### Final Verdict

**Status:** [TO BE DETERMINED AFTER ASSESSMENT]

- ✅ **Production Ready** - All checks pass, output is meaningful
- 🟡 **Needs Tuning** - Works but thresholds/buckets need adjustment
- 🔴 **Not Ready** - Significant issues found, needs fixes

### Recommended Next Steps

1. [TO BE FILLED BASED ON FINDINGS]
2. [...]
3. [...]

---

## Appendix: Raw Data

### Complete Skill Run Result JSON

```json
[PASTE FULL result COLUMN HERE FOR REFERENCE]
```

### Complete Skill Run Output Text

```
[PASTE FULL output_text COLUMN HERE FOR REFERENCE]
```

---

**Assessment completed by:** Claude Code
**Date:** February 11, 2026
