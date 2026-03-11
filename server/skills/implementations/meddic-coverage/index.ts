/**
 * MEDDIC Coverage Skill
 *
 * Scores MEDDIC/SPICED/BANT field coverage across the full activity history for a deal.
 * Each confirmed field cites its source. Surfaces contradictions across time.
 * Writes confirmed fields back to CRM via workflow rules.
 */

import type { SkillDefinition } from '../../types.js';
import { assembleCorpus } from './compute.js';
import { classifyFields } from './classify.js';
import { synthesizeCoverage } from './synthesize.js';
import { generateFindings } from './findings.js';
import { generateWritebackCandidates } from './writeback.js';
import { createLogger } from '../../../utils/logger.js';
import { query } from '../../../db.js';

const logger = createLogger('meddic-coverage');

export const meddicCoverageSkill: SkillDefinition = {
  id: 'meddic-coverage',
  name: 'MEDDIC Coverage',
  description: 'Scores MEDDIC/SPICED/BANT field coverage across the full activity history for a deal — all calls, emails, and notes. Each confirmed field cites its source. Surfaces contradictions across time. Writes confirmed fields back to CRM via workflow rules.',
  version: '1.0.0',
  category: 'deals',
  tier: 'mixed',
  requiredTools: [],
  requiredContext: [],
  outputFormat: 'json',
  estimatedDuration: '30-60 seconds',

  steps: [
    {
      id: 'execute-meddic-coverage',
      name: 'Execute MEDDIC Coverage Analysis',
      tier: 'compute',
      computeFn: 'meddicCoverageExecute',
      computeArgs: {},
      outputKey: 'result',
    },
  ],
};

/**
 * Main execution function for MEDDIC Coverage skill
 * This function orchestrates all phases: compute, classify, synthesize, findings, writeback
 */
export async function executeMeddicCoverage(
  workspaceId: string,
  dealId: string,
  runId: string
): Promise<any> {
  logger.info('Starting MEDDIC Coverage analysis', {
    workspaceId,
    dealId,
    runId,
  });

  try {
    // Phase 0: COMPUTE - Assemble corpus
    logger.info('Phase 0: Assembling corpus');
    const corpus = await assembleCorpus(workspaceId, dealId);

    // Check for insufficient data
    if (corpus.insufficient_data) {
      logger.warn('Insufficient data for analysis', {
        dealId,
        reason: corpus.insufficient_data_reason,
      });

      // Generate insufficient data finding
      const finding = {
        workspace_id: workspaceId,
        skill_run_id: runId,
        skill_id: 'meddic-coverage',
        severity: 'watch',
        category: 'meddic_no_activity_data',
        message: corpus.insufficient_data_reason || 'No calls or emails found for MEDDIC analysis',
        deal_id: dealId,
        metadata: {
          corpus_stats: corpus.corpus_stats,
        },
      };

      // Insert finding
      await query(
        `INSERT INTO findings (
          workspace_id, skill_run_id, skill_id, severity, category,
          message, deal_id, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          finding.workspace_id,
          finding.skill_run_id,
          finding.skill_id,
          finding.severity,
          finding.category,
          finding.message,
          finding.deal_id,
          JSON.stringify(finding.metadata),
        ]
      );

      return {
        status: 'insufficient_data',
        reason: corpus.insufficient_data_reason,
        corpus_stats: corpus.corpus_stats,
      };
    }

    // Phase 1: CLASSIFY - Extract fields using DeepSeek
    logger.info('Phase 1: Classifying fields with DeepSeek');
    const classifications = await classifyFields(corpus);

    // Phase 2: SYNTHESIZE - Coverage assessment using Claude
    logger.info('Phase 2: Synthesizing coverage assessment with Claude');
    const assessment = await synthesizeCoverage(corpus, classifications);

    // Phase 3: FINDINGS - Generate findings
    logger.info('Phase 3: Generating findings');
    const findings = generateFindings(corpus, classifications, assessment, runId);

    // Insert findings into database
    for (const finding of findings) {
      await query(
        `INSERT INTO findings (
          workspace_id, skill_run_id, skill_id, severity, category,
          message, deal_id, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          finding.workspace_id,
          finding.skill_run_id,
          finding.skill_id,
          finding.severity,
          finding.category,
          finding.message,
          finding.deal_id,
          JSON.stringify(finding.metadata),
        ]
      );
    }

    // Phase 4: WRITEBACK - Package high-confidence fields as actions
    logger.info('Phase 4: Generating writeback candidates');
    const writebackCount = await generateWritebackCandidates(
      corpus,
      classifications,
      runId
    );

    logger.info('MEDDIC Coverage analysis complete', {
      dealId,
      coverageScore: assessment.coverage_score,
      findingCount: findings.length,
      writebackCount,
    });

    // Return complete result
    return {
      status: 'completed',
      deal: {
        id: corpus.deal.id,
        name: corpus.deal.name,
        stage: corpus.deal.stage,
      },
      methodology: {
        base: corpus.methodology.base_methodology,
        version: corpus.methodology.version,
      },
      corpus_stats: corpus.corpus_stats,
      limited_evidence: corpus.limited_evidence,
      classifications: {
        field_count: classifications.field_count,
        confirmed_count: classifications.confirmed_count,
        partial_count: classifications.partial_count,
        missing_count: classifications.missing_count,
        extractions: classifications.extractions,
      },
      assessment: {
        coverage_score: assessment.coverage_score,
        executive_summary: assessment.executive_summary,
        gap_narrative: assessment.gap_narrative,
        recommended_actions: assessment.recommended_actions,
        contradiction_flags: assessment.contradiction_flags,
        stage_appropriateness_note: assessment.stage_appropriateness_note,
      },
      findings_count: findings.length,
      writeback_count: writebackCount,
    };
  } catch (error: any) {
    logger.error('MEDDIC Coverage analysis failed', {
      dealId,
      error: error.message,
      stack: error.stack,
    });

    throw error;
  }
}

/**
 * Register this skill with the SkillRegistry
 * Call this at app startup
 */
export function registerMeddicCoverageSkill() {
  const { getSkillRegistry } = require('../../registry.js');
  const registry = getSkillRegistry();
  registry.register(meddicCoverageSkill);
  logger.info('MEDDIC Coverage skill registered');
}
