import { getPipelineHealth } from './get-pipeline-health.js';
import { getForecastRollup } from './get-forecast-rollup.js';
import { getAtRiskDeals } from './get-at-risk-deals.js';
import { getRepScorecard } from './get-rep-scorecard.js';
import { runDeliberationTool } from './run-deliberation.js';
import { getConciergeBrief } from './get-concierge-brief.js';
import { queryDeals } from './query-deals.js';
import { generateReportTool } from './generate-report.js';
import { getReport } from './get-report.js';
import { listReports } from './list-reports.js';
import { exportReportToGoogleDocs } from './export-report.js';
import { runSkill } from './run-skill.js';
import { getSkillStatus } from './get-skill-status.js';
import { getPipelineSummary } from './get-pipeline-summary.js';
import { listDimensions } from './list-dimensions.js';

import {
  runPipelineHygiene,
  runForecastRollupSkill,
  runDealRiskReview,
  runRepScorecardSkill,
  runConversationIntelligence,
  runICPDiscovery,
  runCompetitiveIntelligence,
  runBowtiAnalysis,
  runMonteCarlo,
  runStrategyInsights,
} from './skills/convenience.js';

import { getDealRiskReview } from './skills/get-deal-risk-review.js';
import { getCallThemes } from './skills/get-call-themes.js';
import { getICPProfile } from './skills/get-icp-profile.js';
import { getCompetitiveLandscape } from './skills/get-competitive-landscape.js';
import { getFunnelAnalysis } from './skills/get-funnel-analysis.js';
import { getMonteCarlo } from './skills/get-monte-carlo-forecast.js';
import { getStrategyInsights } from './skills/get-strategy-insights.js';

import {
  saveClaudeInsight,
  createAction,
  saveToReport,
  saveHypothesis,
} from './write/index.js';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: object;
  handler: (args: any, workspaceId: string) => Promise<any>;
}

export const tools: McpTool[] = [
  // Read tools — pipeline & forecast
  getPipelineSummary,
  getPipelineHealth,
  getForecastRollup,
  getAtRiskDeals,
  getRepScorecard,
  getConciergeBrief,
  queryDeals,
  getSkillStatus,
  listDimensions,

  // Skill runner — generic (covers all 38 skills)
  runSkill,

  // Per-skill convenience tools — generic runners (run_X pattern)
  runPipelineHygiene,
  runForecastRollupSkill,
  runDealRiskReview,
  runRepScorecardSkill,
  runConversationIntelligence,
  runICPDiscovery,
  runCompetitiveIntelligence,
  runBowtiAnalysis,
  runMonteCarlo,
  runStrategyInsights,

  // Per-skill rich get tools — structured output with field extraction (get_X pattern)
  getDealRiskReview,
  getCallThemes,
  getICPProfile,
  getCompetitiveLandscape,
  getFunnelAnalysis,
  getMonteCarlo,
  getStrategyInsights,

  // Report tools
  generateReportTool,
  getReport,
  listReports,
  exportReportToGoogleDocs,

  // Deliberation
  runDeliberationTool,

  // Write-back tools
  saveClaudeInsight,
  createAction,
  saveToReport,
  saveHypothesis,
];

const toolMap = new Map<string, McpTool>(tools.map(t => [t.name, t]));

export async function callTool(
  name: string,
  args: any,
  workspaceId: string
): Promise<any> {
  const tool = toolMap.get(name);
  if (!tool) {
    throw new Error(
      `Unknown tool: "${name}". Available tools: ${tools.map(t => t.name).join(', ')}`
    );
  }
  return tool.handler(args, workspaceId);
}
