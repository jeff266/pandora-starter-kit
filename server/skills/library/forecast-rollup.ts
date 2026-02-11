/**
 * Forecast Roll-up Skill
 *
 * Aggregates deals by forecast_category into bear/base/bull scenarios,
 * breaks down by rep, compares week-over-week, and synthesizes narrative.
 */

import type { SkillDefinition } from '../types.js';

export const forecastRollupSkill: SkillDefinition = {
  id: 'forecast-rollup',
  name: 'Forecast Roll-up',
  description: 'Aggregates pipeline by forecast category with bear/base/bull scenarios, rep-level breakdowns, and week-over-week comparison',
  version: '1.0.0',
  category: 'pipeline',
  tier: 'sonnet',

  requiredTools: ['deal-query'],
  optionalTools: [],

  requiredContext: ['goals_and_targets'],

  steps: [
    {
      name: 'gather-forecast-data',
      agent: 'deepseek',
      description: 'Query deals by forecast_category and aggregate totals',
      tools: ['deal-query'],
      contextSections: [],
      prompt: `You are gathering forecast data for a sales roll-up.

**Task:** Query all open deals and aggregate by forecast_category.

**Required queries:**
1. Get ALL open deals (stage_normalized NOT IN ('closed_lost'))
2. Calculate totals by forecast_category:
   - closedWon: SUM(amount) WHERE forecast_category = 'closed'
   - commit: SUM(amount) WHERE forecast_category = 'commit'
   - bestCase: SUM(amount) WHERE forecast_category = 'best_case'
   - pipeline: SUM(amount) WHERE forecast_category = 'pipeline'
   - notForecasted: SUM(amount) WHERE forecast_category = 'not_forecasted'

3. Calculate scenarios:
   - bearCase: closedWon + commit
   - baseCase: closedWon + commit + bestCase
   - bullCase: closedWon + commit + bestCase + pipeline
   - weighted: closedWon + SUM(amount * probability) for all pipeline deals

4. Break down by owner (rep-level):
   - For each owner, calculate closedWon, commit, bestCase, pipeline totals
   - Include deal counts per category

5. Get quota data if available:
   - Query quota_periods table for active period (start_date <= NOW() <= end_date)
   - Query rep_quotas table for per-rep quotas
   - Calculate attainment: (closedWon + commit) / quota
   - Assign status based on attainment:
     - crushing: >= 120%
     - on_track: 90-119%
     - at_risk: 70-89%
     - behind: 50-69%
     - off_track: < 50%

**Output format (JSON):**
\`\`\`json
{
  "team": {
    "closedWon": 500000,
    "commit": 100000,
    "bestCase": 200000,
    "pipeline": 300000,
    "notForecasted": 150000,
    "weighted": 650000,
    "bearCase": 600000,
    "baseCase": 800000,
    "bullCase": 1100000,
    "teamQuota": 1000000,
    "attainment": 0.60
  },
  "byRep": [
    {
      "name": "John Doe",
      "closedWon": 100000,
      "commit": 20000,
      "bestCase": 40000,
      "pipeline": 60000,
      "quota": 150000,
      "attainment": 0.80,
      "status": "at_risk"
    }
  ],
  "dealCount": {
    "closedWon": 25,
    "commit": 5,
    "bestCase": 10,
    "pipeline": 30,
    "notForecasted": 50
  }
}
\`\`\``,
      outputKey: 'forecast_data',
    },

    {
      name: 'compare-week-over-week',
      agent: 'deepseek',
      description: 'Compare current forecast to previous week',
      tools: [],
      contextSections: [],
      prompt: `You are comparing this week's forecast to last week's.

**Task:** Query the skill_runs table for the previous forecast-rollup run.

**Query:**
\`\`\`sql
SELECT result, created_at
FROM skill_runs
WHERE workspace_id = '<workspace_id>'
  AND skill_id = 'forecast-rollup'
  AND status = 'completed'
  AND created_at < NOW() - INTERVAL '6 days'
ORDER BY created_at DESC
LIMIT 1;
\`\`\`

**Calculate deltas:**
For each category (closedWon, commit, bestCase, pipeline):
- delta = current - previous
- deltaPercent = (delta / previous) * 100

**Output format (JSON):**
\`\`\`json
{
  "available": true,
  "previousRunDate": "2026-02-04T14:00:00Z",
  "changes": {
    "closedWon": { "from": 480000, "to": 500000, "delta": 20000, "deltaPercent": 4.2 },
    "commit": { "from": 90000, "to": 100000, "delta": 10000, "deltaPercent": 11.1 },
    "bestCase": { "from": 190000, "to": 200000, "delta": 10000, "deltaPercent": 5.3 },
    "pipeline": { "from": 290000, "to": 300000, "delta": 10000, "deltaPercent": 3.4 }
  }
}
\`\`\`

If no previous run exists:
\`\`\`json
{
  "available": false,
  "previousRunDate": null,
  "changes": null
}
\`\`\``,
      outputKey: 'week_over_week',
    },

    {
      name: 'synthesize-narrative',
      agent: 'sonnet',
      description: 'Generate executive summary with insights and recommendations',
      tools: [],
      contextSections: ['goals_and_targets'],
      prompt: `You are a sales operations analyst providing a weekly forecast roll-up to sales leadership.

**Context:**
You have the forecast data from Step 1 and week-over-week comparison from Step 2.

**Task:** Write a concise executive summary (300-400 words) that:

1. **Opens with team status** - Are we on track to hit quota? What's the weighted forecast vs quota?
2. **Highlights key risks/opportunities** - Which reps need attention? Are there concentration risks?
3. **Provides week-over-week context** - How did the pipeline change? Moving in the right direction?
4. **Gives 2-3 actionable recommendations** - What should leadership focus on this week?

**Tone:** Direct, data-driven, actionable. Avoid generic phrases like "pipeline looks healthy" - be specific about numbers, names, and next steps.

**Format:** Use markdown with clear sections:
- ## Team Status
- ## Key Risks & Opportunities
- ## Week-over-Week
- ## Recommendations

**Guidelines:**
- Use specific dollar amounts and percentages
- Name specific reps who need attention
- Highlight deals at risk or ready to close
- If quota data missing, acknowledge it and focus on absolute numbers
- If WoW data unavailable (first run), note it and focus on current state

**Scenario interpretation:**
- Bear case: Only commit deals close (conservative)
- Base case: Commit + best case close (realistic)
- Bull case: Everything closes (optimistic)
- Spread between bear and bull indicates pipeline volatility`,
      outputKey: 'narrative',
    },
  ],

  schedule: {
    cron: '0 8 * * 1', // Monday 8am
    trigger: 'on_demand',
  },

  outputFormat: 'slack',
  slackTemplate: 'forecast-rollup',

  estimatedDuration: '30s',
};
