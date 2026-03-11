/**
 * MEDDIC Coverage — Writeback Phase
 *
 * Packages high-confidence confirmed fields as writeback candidates
 * in the actions table with approval_status: pending.
 *
 * Does NOT write directly to CRM - lets the Workflow Builder handle execution.
 */

import { query } from '../../../db.js';
import { createLogger } from '../../../utils/logger.js';
import type { CorpusData } from './compute.js';
import type { ClassifyResult, FieldExtraction } from './classify.js';

const logger = createLogger('meddic-coverage-writeback');

export interface WritebackCandidate {
  field_key: string;
  field_label: string;
  proposed_value: string;
  source_citation: string;
  confidence: string;
  evidence_text: string;
}

/**
 * Generate writeback candidates for high-confidence confirmed fields
 */
export async function generateWritebackCandidates(
  corpus: CorpusData,
  classifications: ClassifyResult,
  runId: string
): Promise<number> {
  logger.info('Generating writeback candidates', {
    dealId: corpus.deal.id,
    confirmedCount: classifications.confirmed_count,
  });

  // Filter for high-confidence confirmed fields
  const highConfidenceFields = classifications.extractions.filter(
    e => e.status === 'confirmed' && e.confidence === 'high' && e.evidence_text
  );

  if (highConfidenceFields.length === 0) {
    logger.info('No high-confidence fields to write back', {
      dealId: corpus.deal.id,
    });
    return 0;
  }

  const candidates: WritebackCandidate[] = [];

  for (const extraction of highConfidenceFields) {
    // Map field key to Pandora writable field
    const fieldKey = mapFieldKeyToPandoraField(extraction.field);
    if (!fieldKey) {
      logger.warn('Field not mapped to Pandora writable field', {
        field: extraction.field,
      });
      continue;
    }

    // Get field label from methodology config
    const fieldConfig = corpus.methodology.merged_fields[extraction.field];
    const fieldLabel = fieldConfig?.label || extraction.field;

    // Build source citation
    const sourceCitation = buildSourceCitation(extraction);

    candidates.push({
      field_key: fieldKey,
      field_label: fieldLabel,
      proposed_value: extraction.evidence_text!,
      source_citation: sourceCitation,
      confidence: extraction.confidence!,
      evidence_text: extraction.evidence_text!,
    });
  }

  logger.info('Writeback candidates prepared', {
    dealId: corpus.deal.id,
    candidateCount: candidates.length,
  });

  // Insert actions into actions table
  let inserted = 0;
  for (const candidate of candidates) {
    try {
      await insertWritebackAction(
        corpus.deal.workspace_id,
        runId,
        corpus.deal.id,
        corpus.deal.name,
        candidate
      );
      inserted++;
    } catch (error: any) {
      logger.error('Failed to insert writeback action', {
        dealId: corpus.deal.id,
        field: candidate.field_key,
        error: error.message,
      });
    }
  }

  logger.info('Writeback candidates inserted', {
    dealId: corpus.deal.id,
    insertedCount: inserted,
  });

  return inserted;
}

/**
 * Map methodology field key to Pandora writable field key
 */
function mapFieldKeyToPandoraField(methodologyFieldKey: string): string | null {
  // Normalize field key
  const normalized = methodologyFieldKey.toLowerCase().replace(/[_-]/g, '_');

  // Map MEDDIC fields
  const meddicMapping: Record<string, string> = {
    'metrics': 'meddic_metrics',
    'meddic_metrics': 'meddic_metrics',
    'economic_buyer': 'meddic_economic_buyer',
    'meddic_economic_buyer': 'meddic_economic_buyer',
    'decision_criteria': 'meddic_decision_criteria',
    'meddic_decision_criteria': 'meddic_decision_criteria',
    'decision_process': 'meddic_decision_process',
    'meddic_decision_process': 'meddic_decision_process',
    'identify_pain': 'meddic_identify_pain',
    'meddic_identify_pain': 'meddic_identify_pain',
    'pain': 'meddic_identify_pain',
    'champion': 'meddic_champion',
    'meddic_champion': 'meddic_champion',
    'competition': 'meddic_competition',
    'meddic_competition': 'meddic_competition',
  };

  // Map SPICED fields
  const spicedMapping: Record<string, string> = {
    'situation': 'spiced_situation',
    'spiced_situation': 'spiced_situation',
    'spiced_pain': 'spiced_pain',
    'impact': 'spiced_impact',
    'spiced_impact': 'spiced_impact',
    'critical_event': 'spiced_critical_event',
    'spiced_critical_event': 'spiced_critical_event',
    'decision': 'spiced_decision',
    'spiced_decision': 'spiced_decision',
  };

  // Map BANT fields
  const bantMapping: Record<string, string> = {
    'budget': 'bant_budget',
    'bant_budget': 'bant_budget',
    'authority': 'bant_authority',
    'bant_authority': 'bant_authority',
    'need': 'bant_need',
    'bant_need': 'bant_need',
    'timeline': 'bant_timeline',
    'bant_timeline': 'bant_timeline',
  };

  // Combine all mappings
  const allMappings = { ...meddicMapping, ...spicedMapping, ...bantMapping };

  return allMappings[normalized] || null;
}

/**
 * Build source citation from extraction
 */
function buildSourceCitation(extraction: FieldExtraction): string {
  const sourceType = extraction.evidence_source?.type || 'unknown';
  const sourceDate = extraction.evidence_source?.date
    ? new Date(extraction.evidence_source.date).toLocaleDateString()
    : 'unknown date';

  const evidenceSnippet = extraction.evidence_text
    ? extraction.evidence_text.slice(0, 100)
    : 'No evidence text';

  return `Written by Pandora MEDDIC Coverage | Evidence: ${evidenceSnippet} | Source: ${sourceType} ${sourceDate}`;
}

/**
 * Insert writeback action into actions table
 */
async function insertWritebackAction(
  workspaceId: string,
  runId: string,
  dealId: string,
  dealName: string,
  candidate: WritebackCandidate
): Promise<void> {
  // Supersede existing open writeback actions for same field + deal
  await query(
    `UPDATE actions
     SET execution_status = 'superseded',
         dismissed_reason = 'superseded',
         updated_at = now()
     WHERE workspace_id = $1
       AND source_skill = 'meddic-coverage'
       AND target_deal_id = $2
       AND action_type = 'meddic_field_update'
       AND execution_payload->>'field_key' = $3
       AND execution_status = 'open'`,
    [workspaceId, dealId, candidate.field_key]
  );

  // Insert new action
  const executionPayload = {
    field_key: candidate.field_key,
    proposed_value: candidate.proposed_value,
    source_citation: candidate.source_citation,
    crm_updates: [
      {
        field: candidate.field_key,
        proposed_value: candidate.proposed_value,
      },
    ],
  };

  const metadata = {
    confidence: candidate.confidence,
    evidence_text: candidate.evidence_text,
  };

  const result = await query(
    `INSERT INTO actions (
      workspace_id, source_run_id, source_skill,
      action_type, severity, title, summary,
      target_entity_name, target_deal_id,
      execution_payload, metadata,
      execution_status
    ) VALUES (
      $1, $2, $3,
      $4, $5, $6, $7,
      $8, $9,
      $10, $11,
      $12
    ) RETURNING id`,
    [
      workspaceId,
      runId,
      'meddic-coverage',
      'meddic_field_update',
      'info',
      `Update ${candidate.field_label} for ${dealName}`,
      `Pandora detected ${candidate.field_label}: ${candidate.proposed_value.slice(0, 100)}`,
      dealName,
      dealId,
      JSON.stringify(executionPayload),
      JSON.stringify(metadata),
      'open', // Status is open, awaiting workflow approval
    ]
  );

  // Audit log: created
  await query(
    `INSERT INTO action_audit_log (workspace_id, action_id, event_type, actor, to_status)
     VALUES ($1, $2, 'created', 'system', 'open')`,
    [workspaceId, result.rows[0].id]
  );

  logger.info('Writeback action created', {
    actionId: result.rows[0].id,
    dealId,
    field: candidate.field_key,
  });
}
