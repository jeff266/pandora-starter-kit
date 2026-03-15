import type { SkillDefinition } from '../types.js';

export const pipelineProgressionSkill: SkillDefinition = {
  id: 'pipeline-progression',
  name: 'Pipeline Progression',
  description: 'Tracks Q0/Q+1/Q+2 pipeline coverage over time — creating an early warning system that gives 6–9 months of notice instead of 6–9 weeks. Benchmarks against 3.0x starting coverage target.',
  version: '1.0.0',
  category: 'pipeline',
  tier: 'mixed',

  requiredTools: [
    'resolveTimeWindows',
    'checkQuotaConfig',
    'resolveQuarters',
    'snapshotCurrentPipeline',
    'loadHistoricalSnapshots',
    'detectEarlyWarnings',
    'prepareProgressionSummary',
    'calculateOutputBudget',
    'summarizeForClaude',
  ],

  requiredContext: ['goals_and_targets', 'business_model'],
  outputFormat: 'slack',
  estimatedDuration: '60s',

  schedule: {
    cron: '0 8 * * 1',
    trigger: 'on_demand',
  },

  timeConfig: {
    analysisWindow: 'current_quarter',
    changeWindow: 'last_7d',
    trendComparison: 'previous_period',
  },

  steps: [
    {
      id: 'resolve-time-windows',
      name: 'Resolve Time Windows',
      tier: 'compute',
      computeFn: 'resolveTimeWindows',
      computeArgs: { analysisWindow: 'current_quarter' },
      outputKey: 'time_windows',
    },
    {
      id: 'check-quota-config',
      name: 'Check Quota Configuration',
      tier: 'compute',
      computeFn: 'checkQuotaConfig',
      computeArgs: {},
      outputKey: 'quota_config',
    },
    {
      id: 'resolve-quarters',
      name: 'Resolve Q0/Q+1/Q+2 Bounds',
      tier: 'compute',
      dependsOn: ['resolve-time-windows', 'check-quota-config'],
      computeFn: 'resolveQuarters',
      computeArgs: {},
      outputKey: 'quarters',
    },
    {
      id: 'snapshot-current-pipeline',
      name: 'Snapshot Current Pipeline (3 Quarters)',
      tier: 'compute',
      dependsOn: ['resolve-quarters'],
      computeFn: 'snapshotCurrentPipeline',
      computeArgs: {},
      outputKey: 'snapshot',
    },
    {
      id: 'load-historical-snapshots',
      name: 'Load Historical Snapshots (12 Weeks)',
      tier: 'compute',
      dependsOn: ['snapshot-current-pipeline'],
      computeFn: 'loadHistoricalSnapshots',
      computeArgs: { weeksBack: 12 },
      outputKey: 'history',
    },
    {
      id: 'detect-early-warnings',
      name: 'Detect Early Warnings',
      tier: 'compute',
      dependsOn: ['load-historical-snapshots'],
      computeFn: 'detectEarlyWarnings',
      computeArgs: {},
      outputKey: 'early_warnings',
    },
    {
      id: 'classify-quarter-health',
      name: 'Classify Quarter Health',
      tier: 'deepseek',
      dependsOn: ['snapshot-current-pipeline', 'load-historical-snapshots', 'detect-early-warnings'],
      deepseekPrompt: `You are classifying pipeline health for Q+1 and Q+2 for a B2B SaaS company.

CURRENT SNAPSHOT:
{{snapshot}}

HISTORICAL TREND (12 weeks):
{{history}}

EARLY WARNINGS:
{{early_warnings}}

Respond with JSON only:
{
  "quarterClassifications": [
    {
      "quarter": "Q+1 label",
      "health": "healthy" | "at_risk" | "critical",
      "cause": "insufficient_pipeline" | "trend_declining" | "early_slippage" | "below_target",
      "urgency": "high" | "medium" | "low",
      "weeksToAct": number
    }
  ],
  "overall": "healthy" | "monitoring" | "alert",
  "headline": "one sentence overall assessment"
}`,
      outputKey: 'classification',
    },
    {
      id: 'prepare-progression-summary',
      name: 'Prepare Progression Summary',
      tier: 'compute',
      dependsOn: ['snapshot-current-pipeline', 'history', 'detect-early-warnings', 'classify-quarter-health'],
      computeFn: 'prepareProgressionSummary',
      computeArgs: {},
      outputKey: 'summary',
    },
    {
      id: 'calculate-output-budget',
      name: 'Calculate Output Budget',
      tier: 'compute',
      dependsOn: ['prepare-progression-summary'],
      computeFn: 'calculateOutputBudget',
      computeArgs: { targetTokens: 2000 },
      outputKey: 'output_budget',
    },
    {
      id: 'summarize-for-claude',
      name: 'Summarize for Claude',
      tier: 'compute',
      dependsOn: ['calculate-output-budget'],
      computeFn: 'summarizeForClaude',
      computeArgs: {},
      outputKey: 'claude_input',
    },
    {
      id: 'synthesize-progression-report',
      name: 'Synthesize Pipeline Progression Report',
      tier: 'claude',
      dependsOn: ['summarize-for-claude', 'classify-quarter-health'],
      claudePrompt: `You are a RevOps analyst presenting a pipeline progression briefing.
Your job: give the revenue team an early warning if pipeline is building toward a coverage shortfall.
Be specific with quarter labels, dollar amounts, and coverage ratios. No hedging.

Write a pipeline progression report using this data:

{{claude_input}}

CLASSIFICATION:
{{classification}}

Structure:
1. **Current Quarter (Q0)** — coverage ratio, closed won to date, remaining gap
2. **Next Quarter (Q+1)** — coverage ratio vs. 3.0x target, trend direction, $ gap to reach target
3. **Out Quarter (Q+2)** — early signal, whether trend warrants action now
4. **One Action per At-Risk Quarter** — specific, dollar-targeted

Kellblog principle: 3.0x starting coverage is the minimum. Under 2.0x with less than 8 weeks is critical.

Under 400 words.`,
      outputKey: 'synthesis',
    },
  ],
};
