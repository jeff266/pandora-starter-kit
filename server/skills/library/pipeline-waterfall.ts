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

    // Step 7: Classify movement patterns (DeepSeek)
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
- Velocity benchmarks: {{velocity_benchmarks}}

Items to classify:
{{top_deals}}

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

    // Step 8: Synthesize waterfall report (Claude)
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
      ],
      claudePrompt: `You are a RevOps strategist analyzing pipeline flow for a sales team.

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
{{velocity_benchmarks}}

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

Word budget: 600 words.`,
      outputKey: 'narrative',
      claudeTools: ['queryDeals', 'getDealsByStage'],
      maxToolCalls: 10,
    },
  ],

  schedule: {
    cron: '0 8 * * 1', // Monday 8 AM UTC
    trigger: 'on_demand',
  },

  outputFormat: 'markdown',
  estimatedDuration: '45s',
};
