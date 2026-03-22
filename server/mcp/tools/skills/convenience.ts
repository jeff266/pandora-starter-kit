import type { McpTool } from '../index.js';
import { runSkillWithAutoSave } from './helpers.js';

function makeSkillTool(
  name: string,
  skillId: string,
  description: string,
  extraProperties?: Record<string, any>
): McpTool {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties: {
        save: {
          type: 'boolean',
          description: 'Auto-save results to Pandora (default: true)',
        },
        ...extraProperties,
      },
    },
    handler: async (args: any, workspaceId: string) => {
      const save = args.save !== false;
      return runSkillWithAutoSave(workspaceId, skillId, {}, save, name);
    },
  };
}

export const runPipelineHygiene: McpTool = makeSkillTool(
  'run_pipeline_hygiene',
  'pipeline-hygiene',
  'Runs pipeline hygiene analysis. Returns stale deals, single-threaded deals, data quality issues, and coverage ratio. Auto-saves results. Use this instead of run_skill for pipeline health questions — it returns richer deal-level detail. Pass save: false to skip auto-save.'
);

export const runForecastRollupSkill: McpTool = makeSkillTool(
  'run_forecast_rollup_skill',
  'forecast-rollup',
  'Runs forecast roll-up skill. Returns category totals, rep-level forecast, weighted vs unweighted pipeline. Auto-saves results. Pass save: false to skip.'
);

export const runDealRiskReview: McpTool = makeSkillTool(
  'run_deal_risk_review',
  'deal-risk-review',
  'Runs deal risk assessment across all open deals. Scores each deal for risk based on stage, activity, single-threading, and conversation signals. Returns risk-ranked deals. Auto-saves. Pass save: false to skip.'
);

export const runRepScorecardSkill: McpTool = makeSkillTool(
  'run_rep_scorecard_skill',
  'rep-scorecard',
  'Runs rep scorecard skill. Returns per-rep metrics: quota attainment, pipeline coverage, deal velocity, activity rate, win rate. Auto-saves. Pass save: false to skip.'
);

export const runConversationIntelligence: McpTool = makeSkillTool(
  'run_conversation_intelligence',
  'conversation-intelligence',
  'Mines call transcripts and conversation data for themes, risk signals, and coaching opportunities. Returns topic clusters and rep-level conversation patterns. Auto-saves. Pass save: false to skip.'
);

export const runICPDiscovery: McpTool = makeSkillTool(
  'run_icp_discovery',
  'icp-discovery',
  'Runs ICP discovery analysis. Identifies the ideal customer profile from won deals — company size, industry, tech stack signals, deal velocity patterns. Auto-saves. Pass save: false to skip.'
);

export const runCompetitiveIntelligence: McpTool = makeSkillTool(
  'run_competitive_intelligence',
  'competitive-intelligence',
  'Analyzes competitor mentions across deals and conversations. Returns win/loss rates by competitor, positioning gaps, and battlecard signals. Auto-saves. Pass save: false to skip.'
);

export const runBowtiAnalysis: McpTool = makeSkillTool(
  'run_bowtie_analysis',
  'bowtie-analysis',
  'Runs full bowtie funnel analysis. Returns conversion rates across each pipeline stage, bottleneck classification, and expansion vs new business split. Auto-saves. Pass save: false to skip.'
);

export const runMonteCarlo: McpTool = makeSkillTool(
  'run_monte_carlo',
  'monte-carlo-forecast',
  'Runs Monte Carlo revenue forecast simulation. Returns P10/P50/P90 revenue projections, confidence intervals, and scenario narratives. Auto-saves. Pass save: false to skip.'
);

export const runStrategyInsights: McpTool = makeSkillTool(
  'run_strategy_insights',
  'strategy-insights',
  'Synthesizes outputs from all other skills into org-wide strategic themes, systemic risk patterns, and leadership recommendations. Requires at least 3 other skills to have run in the last 14 days. Auto-saves. Pass save: false to skip.'
);
