# Forecast Roll-up v3.0 Enhancements

## Overview
Enhanced the existing forecast-rollup skill from 5 steps to 10 steps, adding concentration risk analysis, behavioral risk detection via DeepSeek, and dynamic output budgeting.

## Implementation Summary

### New Compute Functions (tool-definitions.ts)

#### 1. `gatherPreviousForecast`
**Location**: server/skills/tool-definitions.ts:2292-2344

**Purpose**: Retrieves the most recent previous forecast run for historical comparison

**Output**:
```typescript
{
  available: boolean,
  reason?: string,
  runDate?: Date,
  team?: {
    closedWon, commit, bestCase, pipeline,
    bearCase, baseCase, bullCase,
    weightedForecast, teamQuota, attainment
  },
  byRep?: RepForecast[],
  dealCount?: DealCounts
}
```

**Key Features**:
- Queries `skill_runs` table for previous completed forecast-rollup runs
- Excludes current run to get true historical comparison
- Gracefully handles first-run scenario (no previous data)
- Provides full team and rep-level breakdown from previous run

---

#### 2. `gatherDealConcentrationRisk`
**Location**: server/skills/tool-definitions.ts:2346-2430

**Purpose**: Analyzes deal concentration risk to identify pipeline fragility

**Output**:
```typescript
{
  // Top 3 Deals
  top3Deals: Deal[],  // name, amount, probability, weighted, category, owner, closeDate
  top3Total: number,
  top3Concentration: number,  // % of base case

  // Whale Deals (>20% of team quota)
  whaleDealCount: number,
  whaleDeals: Deal[],  // includes percentOfQuota field
  whaleThreshold: number,
  whaleTotal: number,
  whaleConcentration: number,  // % of base case

  // Risk Assessment
  hasQuotaConfig: boolean,
  riskLevel: 'high' | 'medium' | 'low'
}
```

**Risk Thresholds**:
- **High**: Top 3 >50% OR whale >40%
- **Medium**: Top 3 >30% OR whale >25%
- **Low**: Below medium thresholds

**Whale Deal Definition**: Any deal >20% of team quota

---

### Enhanced Skill Definition (forecast-rollup.ts)

**Version**: 3.0.0 (was 2.0.0)

#### New Step Sequence (10 steps total)

1. **check-quota-config** (existing)
   - Tier: compute
   - Function: `checkQuotaConfig`

2. **resolve-time-windows** (NEW)
   - Tier: compute
   - Function: `resolveTimeWindows`
   - Purpose: Proper Q1/Q2 context instead of hardcoded assumptions

3. **gather-forecast-data** (existing)
   - Tier: compute
   - Function: `forecastRollup`

4. **gather-previous-forecast** (NEW)
   - Tier: compute
   - Function: `gatherPreviousForecast`
   - Purpose: Full historical forecast for trend analysis

5. **gather-wow-delta** (existing, enhanced)
   - Tier: compute
   - Function: `forecastWoWDelta`
   - Now depends on: `gather-forecast-data` + `gather-previous-forecast`

6. **gather-deal-concentration-risk** (NEW)
   - Tier: compute
   - Function: `gatherDealConcentrationRisk`
   - Purpose: Identify whale deals and top 3 concentration

7. **prepare-summary** (existing, enhanced)
   - Tier: compute
   - Function: `prepareForecastSummary`
   - Now depends on: all gather steps + concentration risk

8. **classify-forecast-risks** (NEW)
   - Tier: deepseek
   - Purpose: AI-powered behavioral risk detection

9. **calculate-output-budget** (NEW)
   - Tier: compute
   - Function: `calculateOutputBudget`
   - Purpose: Dynamic word budget based on complexity

10. **synthesize-narrative** (existing, MAJOR ENHANCEMENT)
    - Tier: claude
    - Enhanced with comprehensive executive summary template

---

### DeepSeek Risk Classification (Step 8)

**Behavioral Risk Types**:
1. **Sandbagging**: Consistent under-forecasting, beats by >20%, pipeline heavy but commit light
2. **Over-forecasting**: Commit grew but deals slipping, high commit with low probability
3. **Whale dependency**: Single deal >30% of rep quota in commit
4. **Category gaming**: Unusual shifts between categories without deal progression
5. **None**: No red flags detected

**Output Format**:
```json
[
  {
    "rep_name": "string",
    "risk_type": "sandbagging" | "over_forecasting" | "whale_dependency" | "category_gaming" | "none",
    "severity": "high" | "medium" | "low",
    "evidence": "1-2 sentence explanation with specific numbers",
    "suggested_action": "Specific action to take this week"
  }
]
```

**Detection Rules**:
- Only flag HIGH severity if pattern is clear and current
- Provide specific dollar amounts and percentages
- Suggested actions must be executable this week
- Maximum 5 risk entries (prioritize highest severity)

---

### Enhanced Claude Synthesis Prompt (Step 10)

**Major Template Additions**:

1. **Executive Summary** (new)
   - One-sentence verdict
   - Bear/Base/Bull scenarios with dollar amounts

2. **Forecast Position vs Quota** (enhanced)
   - Bear/Base/Bull with attainment percentages
   - Weighted forecast
   - **Risk-Adjusted Landing Zone** (new) — Bear to Base range with explanation

3. **Category Breakdown & Confidence** (enhanced)
   - Commit/Best Case ratio
   - Spread analysis with volatility thresholds
   - High volatility: >30% quota
   - Medium: 15-30%
   - Low: <15%

4. **Concentration Risk** (NEW SECTION)
   - Top 3 Deals: name, amount, category, owner, probability
   - Combined weighted value + % of base case
   - Risk thresholds:
     - CRITICAL: >50% concentration
     - ELEVATED: 30-50%
   - Whale Deals (>20% quota)
   - Single deal >30% of rep quota flagging

5. **Rep Performance Spotlight** (enhanced)
   - Top performers with specific amounts
   - At-risk reps below 70% attainment
   - Pattern detection: heavy pipeline but no commit

6. **Week-over-Week Movement** (enhanced)
   - Commit change direction analysis
   - Category shift interpretation (progression vs. slippage)
   - Compare this week's risks to last week

7. **Behavioral Risks (AI-Detected)** (NEW SECTION)
   - High severity risks from DeepSeek classification
   - Rep name + risk type + evidence + suggested action

8. **Top 3 Actions This Week** (enhanced)
   - Ranked by revenue impact
   - Format: Action — Owner: [Rep] — Impact: $X — Why: [reason]
   - Must be executable within 7 days
   - Tie to dollar amount or deal count
   - Address highest risk or opportunity

**Output Guidance**: Uses `calculateOutputBudget` to calibrate depth and word count

---

## File Changes

### Modified Files
1. **server/skills/tool-definitions.ts**
   - Added `gatherPreviousForecast` (lines 2292-2344)
   - Added `gatherDealConcentrationRisk` (lines 2346-2430)
   - Fixed typo: `d.category` → `d.forecast_category` (line 2390)
   - Added exports for both new functions (lines 3110-3111)

2. **server/skills/library/forecast-rollup.ts**
   - Complete rewrite with 10-step sequence
   - Updated version: 2.0.0 → 3.0.0
   - Updated description to include concentration risk and AI classification
   - Added `resolveTimeWindows` and `calculateOutputBudget` to requiredTools
   - Enhanced timeConfig with `trendComparison: 'previous_period'`
   - Added DeepSeek step for risk classification
   - Rewrote Claude synthesis prompt with comprehensive template
   - Updated estimatedDuration: 30s → 45s

---

## Key Improvements

### 1. Concentration Risk Detection
- **Problem**: Forecasts can be fragile if dependent on a few large deals
- **Solution**: Automatically detect whale deals (>20% quota) and analyze top 3 concentration
- **Value**: Quantify pipeline fragility with specific metrics

### 2. Behavioral Risk Classification
- **Problem**: Reps can game forecasts through sandbagging or over-optimism
- **Solution**: DeepSeek AI analyzes patterns to detect behavioral risks
- **Value**: Proactively identify forecast gaming before it impacts the quarter

### 3. Historical Trend Analysis
- **Problem**: WoW delta only shows movement, not full context
- **Solution**: Separate step to retrieve full previous forecast for deeper analysis
- **Value**: Better understanding of trends and pattern changes

### 4. Dynamic Output Budgeting
- **Problem**: Fixed word counts don't adapt to forecast complexity
- **Solution**: Automatically calculate appropriate depth based on issue count
- **Value**: Right-sized analysis for the situation

### 5. Risk-Adjusted Landing Zones
- **Problem**: Single forecast number doesn't capture uncertainty
- **Solution**: Bear to Base range with explanation of why
- **Value**: More realistic forecast communication to leadership

---

## Testing Recommendations

1. **Test with Frontera Health data**:
   - Run forecast-rollup on their HubSpot sync data
   - Verify quota configuration loads correctly
   - Check concentration risk calculations

2. **Validate DeepSeek classification**:
   - Ensure JSON output is properly parsed
   - Check for reasonable risk type assignments
   - Verify severity levels make sense

3. **Check output budget**:
   - Verify word count guidance adapts to complexity
   - Test with high-issue vs low-issue scenarios

4. **Test first-run scenario**:
   - Ensure graceful handling when no previous forecast exists
   - Verify messaging in narrative

5. **Test quota configurations**:
   - No quota config (absolute numbers only)
   - Team quota only (no rep quotas)
   - Full quota config (team + rep quotas)

---

## Migration Notes

- **Breaking Change**: None — v3.0 is backward compatible
- **New Dependencies**: Uses existing `resolveTimeWindows` and `calculateOutputBudget` functions
- **Database**: No schema changes required
- **Rollback**: Can revert to v2.0 by using previous forecast-rollup.ts file

---

## Next Steps

1. Deploy to staging environment
2. Test with Frontera Health data
3. Validate DeepSeek risk classification accuracy
4. Gather user feedback on enhanced narrative format
5. Consider adding configuration for concentration risk thresholds
6. Monitor execution time (estimated 45s, may need optimization)

---

## Alignment with Original Prompt

✅ **Step 1**: checkQuotaConfig — Implemented
✅ **Step 2**: resolveTimeWindows — Implemented (NEW)
✅ **Step 3**: forecastRollup — Implemented
✅ **Step 4**: gatherPreviousForecast — Implemented (NEW)
✅ **Step 5**: forecastWoWDelta — Enhanced with previous forecast dependency
✅ **Step 6**: gatherDealConcentrationRisk — Implemented (NEW)
✅ **Step 7**: prepareForecastSummary — Enhanced with concentration data
✅ **Step 8**: classify-forecast-risks (DeepSeek) — Implemented (NEW)
✅ **Step 9**: calculateOutputBudget — Implemented (NEW)
✅ **Step 10**: synthesize-narrative (Claude) — Major enhancement with full template

**Result**: 100% alignment with 8-step prompt specification (expanded to 10 steps for better separation of concerns)
