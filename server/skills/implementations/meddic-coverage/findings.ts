/**
 * MEDDIC Coverage — Findings Generation
 *
 * Generates findings based on coverage assessment:
 * - Critical gaps (score < 40)
 * - Partial coverage (score 40-70)
 * - Strong coverage (score > 70)
 * - Contradictions
 * - Stage-specific missing fields (EB, Champion)
 */

import { createLogger } from '../../../utils/logger.js';
import type { CorpusData } from './compute.js';
import type { ClassifyResult, FieldExtraction } from './classify.js';
import type { CoverageAssessment } from './synthesize.js';

const logger = createLogger('meddic-coverage-findings');

export interface Finding {
  workspace_id: string;
  skill_run_id: string;
  skill_id: string;
  severity: 'act' | 'watch' | 'info';
  category: string;
  message: string;
  deal_id: string;
  owner_email?: string;
  metadata: Record<string, any>;
}

/**
 * Generate findings from coverage assessment
 */
export function generateFindings(
  corpus: CorpusData,
  classifications: ClassifyResult,
  assessment: CoverageAssessment,
  runId: string
): Finding[] {
  logger.info('Generating findings', {
    dealId: corpus.deal.id,
    coverageScore: assessment.coverage_score,
  });

  const findings: Finding[] = [];

  // Check for insufficient data (handled in compute phase)
  if (corpus.insufficient_data) {
    findings.push(makeFinding(
      corpus,
      runId,
      'meddic_no_activity_data',
      'watch',
      'No calls or emails found for MEDDIC analysis. Cannot assess coverage without conversation data.',
      {}
    ));
    return findings;
  }

  // Coverage score findings
  if (assessment.coverage_score < 40) {
    findings.push(makeFinding(
      corpus,
      runId,
      'meddic_critical_gaps',
      'act',
      `Critical MEDDIC gaps detected (${assessment.coverage_score}/100). ${assessment.gap_narrative}`,
      {
        coverage_score: assessment.coverage_score,
        gap_narrative: assessment.gap_narrative,
      }
    ));
  } else if (assessment.coverage_score >= 40 && assessment.coverage_score <= 70) {
    findings.push(makeFinding(
      corpus,
      runId,
      'meddic_partial_coverage',
      'watch',
      `Partial MEDDIC coverage (${assessment.coverage_score}/100). ${assessment.gap_narrative}`,
      {
        coverage_score: assessment.coverage_score,
        gap_narrative: assessment.gap_narrative,
      }
    ));
  } else if (assessment.coverage_score > 70) {
    findings.push(makeFinding(
      corpus,
      runId,
      'meddic_strong_coverage',
      'info',
      `Strong MEDDIC coverage (${assessment.coverage_score}/100). ${assessment.executive_summary}`,
      {
        coverage_score: assessment.coverage_score,
        executive_summary: assessment.executive_summary,
      }
    ));
  }

  // Contradiction findings
  if (assessment.contradiction_flags.length > 0) {
    for (const contradiction of assessment.contradiction_flags) {
      findings.push(makeFinding(
        corpus,
        runId,
        'meddic_contradiction',
        'act',
        `MEDDIC contradiction detected for ${contradiction.field}: ${contradiction.note}`,
        {
          field: contradiction.field,
          source_a: contradiction.source_a,
          source_b: contradiction.source_b,
          note: contradiction.note,
        }
      ));
    }
  }

  // Stage-specific findings
  const stageNormalized = corpus.deal.stage_normalized?.toLowerCase() || '';

  // Economic Buyer missing in late stages
  const ebExtraction = classifications.extractions.find(
    e => e.field === 'meddic_economic_buyer' || e.field === 'economic_buyer'
  );
  const isLateStage = ['proposal', 'negotiation', 'contract_review', 'closed_won'].some(
    stage => stageNormalized.includes(stage)
  );

  if (ebExtraction?.status === 'missing' && isLateStage) {
    findings.push(makeFinding(
      corpus,
      runId,
      'meddic_no_eb_late_stage',
      'act',
      `Economic Buyer not identified, but deal is in ${corpus.deal.stage} stage. This is critical for deal progression.`,
      {
        field: 'economic_buyer',
        current_stage: corpus.deal.stage,
      }
    ));
  }

  // Champion missing in evaluation+ stages
  const championExtraction = classifications.extractions.find(
    e => e.field === 'meddic_champion' || e.field === 'champion'
  );
  const isEvaluationOrLater = ['evaluation', 'proposal', 'negotiation', 'contract_review', 'closed_won'].some(
    stage => stageNormalized.includes(stage)
  );

  if (championExtraction?.status === 'missing' && isEvaluationOrLater) {
    findings.push(makeFinding(
      corpus,
      runId,
      'meddic_no_champion',
      'watch',
      `Champion not identified, but deal is in ${corpus.deal.stage} stage. A champion is important for deal success.`,
      {
        field: 'champion',
        current_stage: corpus.deal.stage,
      }
    ));
  }

  // Add recommended actions as findings (P1 only)
  for (const action of assessment.recommended_actions) {
    if (action.priority === 'P1') {
      findings.push(makeFinding(
        corpus,
        runId,
        `meddic_action_${action.field}`,
        'act',
        `MEDDIC action required for ${action.field}: ${action.action}`,
        {
          field: action.field,
          action: action.action,
          priority: action.priority,
        }
      ));
    }
  }

  logger.info('Findings generated', {
    dealId: corpus.deal.id,
    findingCount: findings.length,
  });

  return findings;
}

/**
 * Helper to create a finding
 */
function makeFinding(
  corpus: CorpusData,
  runId: string,
  category: string,
  severity: 'act' | 'watch' | 'info',
  message: string,
  metadata: Record<string, any>
): Finding {
  return {
    workspace_id: corpus.deal.workspace_id,
    skill_run_id: runId,
    skill_id: 'meddic-coverage',
    severity,
    category,
    message,
    deal_id: corpus.deal.id,
    owner_email: undefined, // Will be populated from deal owner if needed
    metadata,
  };
}
