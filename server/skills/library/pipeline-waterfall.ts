/**
 * Pipeline Waterfall Skill
 *
 * Shows where deals enter, advance, stall, and fall out of the pipeline
 * stage by stage. Answers: "Where are deals getting stuck?"
 */

import type { SkillDefinition } from '../types.js';

export const pipelineWaterfallSkill: SkillDefinition = {
  id: 'pipeline-waterfall',
  name: 'Pipeline Waterfall',
  description: 'Shows where deals enter, advance, stall, and fall out of the pipeline stage by stage',
  version: '1.0.0',
  category: 'pipeline',
  tier: 'mixed',

  requiredTools: [
    'waterfallAnalysis',
    'waterfallDeltas',
    'topDealsInMotion',
    'velocityBenchmarks',
    'prepareWaterfallSummary',
  ],

  requiredContext: ['goals_and_targets'],

  timeConfig: {
    analysisWindow: 'trailing_7d',
    changeWindow: 'last_7d',
  },

  steps: [
    // Step 1: Resolve time windows
    {
      id: 'resolve-time-windows',
      name: 'Resolve Time Windows',
      tier: 'compute',
      computeFn: 'resolveTimeWindows',
      computeArgs: {},
      outputKey: 'time_windows',
    },

    // Step 2: Gather current period waterfall
    {
      id: 'gather-current-waterfall',
      name: 'Gather Current Period Waterfall',
      tier: 'compute',
      dependsOn: ['resolve-time-windows'],
      computeFn: 'waterfallAnalysis',
      computeArgs: { period: 'current' },
      outputKey: 'current_waterfall',
    },

    // Step 3: Gather previous period waterfall
    {
      id: 'gather-previous-waterfall',
      name: 'Gather Previous Period Waterfall',
      tier: 'compute',
      dependsOn: ['resolve-time-windows'],
      computeFn: 'waterfallAnalysis',
      computeArgs: { period: 'previous' },
      outputKey: 'previous_waterfall',
    },

    // Step 4: Compute period-over-period deltas
    {
      id: 'compute-waterfall-deltas',
      name: 'Compute Waterfall Deltas',
      tier: 'compute',
      dependsOn: ['gather-current-waterfall', 'gather-previous-waterfall'],
      computeFn: 'waterfallDeltas',
      computeArgs: {},
      outputKey: 'waterfall_deltas',
    },

    // Step 5: Gather top deals in motion
    {
      id: 'gather-top-deals-in-motion',
      name: 'Gather Top Deals in Motion',
      tier: 'compute',
      dependsOn: ['resolve-time-windows'],
      computeFn: 'topDealsInMotion',
      computeArgs: {},
      outputKey: 'top_deals',
    },

    // Step 6: Gather velocity benchmarks
    {
      id: 'gather-velocity-benchmarks',
      name: 'Gather Velocity Benchmarks',
      tier: 'compute',
      computeFn: 'velocityBenchmarks',
      computeArgs: {},
      outputKey: 'velocity_benchmarks',
    },

    // Step 7: Prepare waterfall summary for Claude
    {
      id: 'prepare-summary',
      name: 'Prepare Waterfall Summary',
      tier: 'compute',
      dependsOn: ['gather-current-waterfall', 'compute-waterfall-deltas', 'gather-top-deals-in-motion', 'gather-velocity-benchmarks'],
      computeFn: 'prepareWaterfallSummary',
      computeArgs: {},
      outputKey: 'pipeline_context',
    },

    // Step 8: Classify movement patterns (DeepSeek)
    {
      id: 'classify-movement-patterns',
      name: 'Classify Movement Patterns (DeepSeek)',
      tier: 'deepseek',
      dependsOn: ['gather-top-deals-in-motion', 'compute-waterfall-deltas', 'gather-velocity-benchmarks'],
      deepseekPrompt: `You are a RevOps analyst reviewing pipeline stage movements.

For each deal movement, classify:
1. movement_type: one of [healthy_advance, stalled_advance, premature_advance, expected_loss, surprise_loss, slow_decay, fast_close]
2. confidence: 0.0 to 1.0
3. signals: evidence supporting classification

Definitions:
- healthy_advance: normal progression, appropriate time in stage
- stalled_advance: moved forward but spent 2x+ avg time in prev stage
- premature_advance: moved forward unusually fast, may lack qualification
- expected_loss: declining signals before closing lost
- surprise_loss: appeared healthy then closed lost unexpectedly
- slow_decay: gradually going dark, no sudden event
- fast_close: moving significantly faster than average (positive)

For each stage anomaly (>20% change from previous period), classify:
1. anomaly_type: one of [process_change, seasonal, rep_behavior, market_shift]
2. confidence: 0.0 to 1.0
3. likely_cause: brief explanation

Context:
- Analysis period: {{time_windows.analysisStart}} to {{time_windows.analysisEnd}}
- Velocity benchmarks: {{{json velocity_benchmarks}}}

Items to classify:
{{{json top_deals}}}

Anomalies to classify:
{{waterfall_deltas.anomalies}}

Respond with ONLY a JSON object: { "dealClassifications": [...], "anomalyClassifications": [...] }`,
      deepseekSchema: {
        type: 'object',
        properties: {
          dealClassifications: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                dealId: { type: 'string' },
                dealName: { type: 'string' },
                movement_type: { type: 'string' },
                confidence: { type: 'number' },
                signals: { type: 'array', items: { type: 'string' } },
              },
              required: ['dealId', 'dealName', 'movement_type', 'confidence', 'signals'],
            },
          },
          anomalyClassifications: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                stage: { type: 'string' },
                anomaly_type: { type: 'string' },
                confidence: { type: 'number' },
                likely_cause: { type: 'string' },
              },
              required: ['stage', 'anomaly_type', 'confidence', 'likely_cause'],
            },
          },
        },
        required: ['dealClassifications', 'anomalyClassifications'],
      },
      outputKey: 'classifications',
    },

    // Step 9: Synthesize waterfall report (Claude)
    {
      id: 'synthesize-waterfall-report',
      name: 'Synthesize Waterfall Report',
      tier: 'claude',
      dependsOn: [
        'gather-current-waterfall',
        'compute-waterfall-deltas',
        'gather-top-deals-in-motion',
        'gather-velocity-benchmarks',
        'classify-movement-patterns',
        'prepare-summary',
      ],
      claudePrompt: `You are a RevOps strategist analyzing pipeline flow for a sales team.

{{#if dataFreshness.isStale}}
⚠️ DATA FRESHNESS: {{dataFreshness.staleCaveat}}
{{/if}}

{{#unless dataFreshness.hasStageHistory}}
NOTE: Stage history not available (file import workspace). Waterfall analysis requires stage transition history to track deal progression. Re-upload deals weekly to build stage movement tracking over time.

Output a brief message:
"Pipeline waterfall analysis requires stage history to track deal movements between periods.
Current file import contains snapshot data only. Upload deals consistently (weekly) to build stage transition history and enable waterfall insights."

Skip the full waterfall report.
{{/unless}}

{{#if dataFreshness.hasStageHistory}}
BUSINESS CONTEXT:
{{businessContext}}

WATERFALL SUMMARY ({{time_windows.periodLabel}}):
Total open pipeline start: {{current_waterfall.summary.totalOpenStart}} deals
Total open pipeline end: {{current_waterfall.summary.totalOpenEnd}} deals
Net change: {{current_waterfall.summary.netPipelineChange}} deals

New pipeline created: {{current_waterfall.summary.newPipelineCreated.count}} deals (\${{current_waterfall.summary.newPipelineCreated.value}})
Closed won: {{current_waterfall.summary.closedWon.count}} deals (\${{current_waterfall.summary.closedWon.value}})
Closed lost: {{current_waterfall.summary.closedLost.count}} deals (\${{current_waterfall.summary.closedLost.value}})

STAGE-BY-STAGE FLOW:
{{#each current_waterfall.stages}}
Stage: {{this.stage}}
  Start: {{this.startOfPeriod}} deals
  Entered: {{this.entered}} deals (\${{this.enteredValue}})
  Advanced: {{this.advanced}} deals (\${{this.advancedValue}})
  Fell out: {{this.fellOut}} deals (\${{this.fellOutValue}})
  Won: {{this.won}} deals (\${{this.wonValue}})
  End: {{this.endOfPeriod}} deals
  Net change: {{this.netChange}} deals
{{/each}}

PERIOD COMPARISON (vs {{time_windows.previousPeriodLabel}}):
{{waterfall_deltas.summary}}

Biggest leakage: {{waterfall_deltas.biggestLeakage}}
Biggest bottleneck: {{waterfall_deltas.biggestBottleneck}}
Fastest stage: {{waterfall_deltas.fastestStage}}

DEAL MOVEMENT CLASSIFICATIONS:
{{classifications.dealClassifications}}

ANOMALIES:
{{classifications.anomalyClassifications}}

VELOCITY BENCHMARKS:
{{{json velocity_benchmarks}}}

CURRENT PIPELINE SNAPSHOT:
{{#each pipeline_context.stageDistribution}}
- {{this.stage}}: {{this.count}} deals (\${{this.totalValue}})
{{/each}}
Total open: {{pipeline_context.pipelineTotals.totalOpenDeals}} deals (\${{pipeline_context.pipelineTotals.totalOpenValue}})

HIGH-RISK DEALS (risk score >= 60):
{{#each pipeline_context.highRiskDeals}}
- {{this.name}} (\${{this.amount}}, {{this.owner}}) — Risk: {{this.dealRisk}}, Stage: {{this.stage}}, {{this.daysInStage}} days in stage
{{/each}}

STALE DEALS (no activity > 14 days):
{{#each pipeline_context.staleDeals}}
- {{this.name}} (\${{this.amount}}, {{this.owner}}) — Stage: {{this.stage}}, {{this.daysSinceActivity}} days since activity
{{/each}}

Produce a Pipeline Waterfall Report that answers:
1. Where is the pipeline leaking? (which stages have the highest fall-out, and why)
2. Where is it bottlenecked? (which stages have the lowest advance rates)
3. What changed this week vs last? (anomalies and their likely causes)
4. What are the highest-impact deals in motion? (advancing or at risk)
5. What should leadership do THIS WEEK? (2-3 specific actions)

Rules:
- Lead with the single most important finding
- Use specific deal names, dollar amounts, and rep names
- If a stage has zero movement, call it out — that's a signal
- Compare to velocity benchmarks: "Deals are spending 2.3x longer in Evaluation than the historical average"
- End with prioritized actions, not a summary
- Use markdown formatting with headers, bullet points, and bold text for emphasis

Word budget: 600 words.
{{/if}}`,
      outputKey: 'narrative',
    },
  ],

  schedule: {
    cron: '0 8 * * 1', // Monday 8 AM UTC
    trigger: 'on_demand',
  },

  outputFormat: 'markdown',
  estimatedDuration: '45s',

  evidenceSchema: {
    entity_type: 'deal',
    columns: [
      { key: 'deal_name', display: 'Deal Name', format: 'text' },
      { key: 'amount', display: 'Amount', format: 'currency' },
      { key: 'owner', display: 'Owner', format: 'text' },
      { key: 'from_stage', display: 'From Stage', format: 'text' },
      { key: 'to_stage', display: 'To Stage', format: 'text' },
      { key: 'days_in_stage', display: 'Days in Stage', format: 'number' },
      { key: 'movement_type', display: 'Movement Type', format: 'text' },
      { key: 'velocity_vs_benchmark', display: 'Velocity vs Benchmark', format: 'text' },
      { key: 'severity', display: 'Severity', format: 'severity' },
    ],
  },
};
