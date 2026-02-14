/**
 * Evidence Builder Registry
 *
 * Registers per-skill evidence builder functions that map compute/classify
 * step outputs into structured SkillEvidence objects.
 *
 * Called by the skill runtime after all steps complete.
 */

import { registerEvidenceBuilder } from '../evidence-builder.js';
import { buildPipelineHygieneEvidence } from './pipeline-hygiene.js';
import { buildDealRiskReviewEvidence } from './deal-risk-review.js';
import { buildSingleThreadAlertEvidence } from './single-thread-alert.js';
import { buildDataQualityAuditEvidence } from './data-quality-audit.js';
import { buildPipelineCoverageEvidence } from './pipeline-coverage.js';
import { buildForecastRollupEvidence } from './forecast-rollup.js';
import { buildWeeklyRecapEvidence } from './weekly-recap.js';
import { buildRepScorecardEvidence } from './rep-scorecard.js';
import { buildPipelineWaterfallEvidence } from './pipeline-waterfall.js';
import { buildBowtieAnalysisEvidence } from './bowtie-analysis.js';
import { buildPipelineGoalsEvidence } from './pipeline-goals.js';
import { buildLeadScoringEvidence } from './lead-scoring.js';
import { buildIcpDiscoveryEvidence } from './icp-discovery.js';
import { buildWorkspaceConfigAuditEvidence } from './workspace-config-audit.js';
import { buildContactRoleResolutionEvidence } from './contact-role-resolution.js';
import { buildCustomFieldDiscoveryEvidence } from './custom-field-discovery.js';
import { buildProjectRecapEvidence } from './project-recap.js';
import { buildStrategyInsightsEvidence } from './strategy-insights.js';

export function registerAllEvidenceBuilders(): void {
  registerEvidenceBuilder('pipeline-hygiene', buildPipelineHygieneEvidence);
  registerEvidenceBuilder('deal-risk-review', buildDealRiskReviewEvidence);
  registerEvidenceBuilder('single-thread-alert', buildSingleThreadAlertEvidence);
  registerEvidenceBuilder('data-quality-audit', buildDataQualityAuditEvidence);
  registerEvidenceBuilder('pipeline-coverage', buildPipelineCoverageEvidence);
  registerEvidenceBuilder('forecast-rollup', buildForecastRollupEvidence);
  registerEvidenceBuilder('weekly-recap', buildWeeklyRecapEvidence);
  registerEvidenceBuilder('rep-scorecard', buildRepScorecardEvidence);
  registerEvidenceBuilder('pipeline-waterfall', buildPipelineWaterfallEvidence);
  registerEvidenceBuilder('bowtie-analysis', buildBowtieAnalysisEvidence);
  registerEvidenceBuilder('pipeline-goals', buildPipelineGoalsEvidence);
  registerEvidenceBuilder('lead-scoring', buildLeadScoringEvidence);
  registerEvidenceBuilder('icp-discovery', buildIcpDiscoveryEvidence);
  registerEvidenceBuilder('workspace-config-audit', buildWorkspaceConfigAuditEvidence);
  registerEvidenceBuilder('contact-role-resolution', buildContactRoleResolutionEvidence);
  registerEvidenceBuilder('custom-field-discovery', buildCustomFieldDiscoveryEvidence);
  registerEvidenceBuilder('project-recap', buildProjectRecapEvidence);
  registerEvidenceBuilder('strategy-insights', buildStrategyInsightsEvidence);
}
