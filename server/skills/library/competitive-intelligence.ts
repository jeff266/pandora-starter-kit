import type { SkillDefinition } from '../types.js';

export const competitiveIntelligenceSkill: SkillDefinition = {
  id: 'competitive-intelligence',
  name: 'Competitive Intelligence',
  description: 'Competitive landscape analysis: win/loss rates by competitor, where they appear in the funnel, trending mentions, and open deals with active competitive threats.',
  version: '1.0.0',
  category: 'reporting',
  tier: 'mixed',

  requiredTools: [
    'resolveTimeWindows',
    'ciCompGatherMentions',
    'ciCompComputeWinRates',
    'calculateOutputBudget',
  ],

  requiredContext: ['business_model'],

  timeConfig: {
    analysisWindow: 'trailing_90d',
    changeWindow: 'last_7d',
    trendComparison: 'previous_period',
  },

  steps: [
    {
      id: 'resolve-time-windows',
      name: 'Resolve Time Windows',
      tier: 'compute',
      computeFn: 'resolveTimeWindows',
      computeArgs: {
        analysisWindow: 'trailing_90d',
        changeWindow: 'last_7d',
        trendComparison: 'previous_period',
      },
      outputKey: 'time_windows',
    },

    {
      id: 'gather-competitor-mentions',
      name: 'Gather Competitor Mentions',
      tier: 'compute',
      dependsOn: ['resolve-time-windows'],
      computeFn: 'ciCompGatherMentions',
      computeArgs: { lookback_months: 6 },
      outputKey: 'competitor_mentions',
    },

    {
      id: 'compute-competitive-win-rates',
      name: 'Compute Competitive Win Rates',
      tier: 'compute',
      dependsOn: ['gather-competitor-mentions'],
      computeFn: 'ciCompComputeWinRates',
      computeArgs: { lookback_months: 6 },
      outputKey: 'competitive_rates',
    },

    {
      id: 'analyze-competitive-patterns',
      name: 'Analyze Competitive Patterns',
      tier: 'deepseek',
      dependsOn: ['gather-competitor-mentions', 'compute-competitive-win-rates'],
      deepseekPrompt: `You are a competitive intelligence analyst. Classify competitive patterns from win/loss data.

COMPETITOR MENTIONS:
{{{json competitor_mentions}}}

COMPETITIVE WIN RATES:
{{{json competitive_rates}}}

Classify each competitor's pattern. Return a JSON array:
[
  {
    "competitor_name": "string",
    "pattern": "displacement_threat" | "feature_gap" | "pricing_pressure" | "emerging_threat" | "declining_threat" | "segment_specific",
    "trend": "increasing" | "stable" | "decreasing",
    "evidence": "one-sentence with specific numbers and context",
    "open_deal_risk": "high" | "medium" | "low"
  }
]

Definitions:
- displacement_threat: consistently wins against us (win_rate_delta < -0.15)
- feature_gap: mentioned in context of product gaps (infer from deal stages and context)
- pricing_pressure: used as a pricing lever in negotiations
- emerging_threat: appeared in last 3 months but not before
- declining_threat: mentions decreasing over the analysis period
- segment_specific: only appears in certain deal sizes, industries, or stages

Return ONLY the JSON array.`,
      outputKey: 'competitive_patterns',
    },

    {
      id: 'calculate-output-budget',
      name: 'Calculate Output Budget',
      tier: 'compute',
      dependsOn: ['competitive_patterns'],
      computeFn: 'calculateOutputBudget',
      computeArgs: {},
      outputKey: 'output_budget',
    },

    {
      id: 'synthesize-competitive-report',
      name: 'Synthesize Competitive Intelligence Report',
      tier: 'claude',
      dependsOn: [
        'resolve-time-windows',
        'gather-competitor-mentions',
        'compute-competitive-win-rates',
        'analyze-competitive-patterns',
        'calculate-output-budget',
      ],
      claudePrompt: `You are a Revenue Intelligence analyst delivering the competitive landscape brief for {{business_model.company_name}}.

COMPETITOR MENTIONS:
{{{json competitor_mentions}}}

WIN RATES BY COMPETITOR:
{{{json competitive_rates}}}

COMPETITIVE PATTERNS:
{{{json competitive_patterns}}}

OUTPUT GUIDANCE:
{{{json output_budget}}}

STRUCTURE YOUR REPORT:

1. **Competitive Landscape**: Who are we seeing and how often? Rank by frequency.

2. **Head-to-Head Performance**: For each competitor — win rate when present vs absent, trend (increasing/decreasing mentions).

3. **Trending**: Which competitors are showing up more? Which are declining?

4. **Funnel Presence**: Which stages do competitors typically appear? (Early evaluation vs late negotiation)

5. **Open Deal Threats**: Active open deals with competitive presence. Specific deals, stages, amounts.

6. **Pattern Analysis**: Is competition feature-based, pricing-based, or relationship-based?

7. **Recommendations**: Battle cards needed, pricing adjustments, competitive positioning by segment.

{{voiceBlock}}

After the report, emit an <actions> block:
[{
  "action_type": "flag_at_risk" | "schedule_review",
  "severity": "critical" | "warning" | "info",
  "title": "short title",
  "summary": "1-2 sentences",
  "recommended_steps": ["step1"],
  "target_deal_name": "deal name if deal-specific",
  "owner_email": null,
  "impact_amount": 0,
  "urgency_label": "this_week" | "next_week"
}]
<actions>[]</actions>`,
      outputKey: 'narrative',
    },
  ],

  schedule: {
    cron: '0 8 1 * *',
    trigger: 'on_demand',
  },

  outputFormat: 'markdown',
  estimatedDuration: '60s',

  evidenceSchema: {
    entity_type: 'deal',
    columns: [
      { key: 'competitor_name', display: 'Competitor', format: 'text' },
      { key: 'deals_mentioned', display: 'Deals', format: 'number' },
      { key: 'win_rate', display: 'Win Rate (with)', format: 'number' },
      { key: 'win_rate_without', display: 'Win Rate (without)', format: 'number' },
      { key: 'win_rate_delta', display: 'Delta', format: 'number' },
    ],
  },
};
