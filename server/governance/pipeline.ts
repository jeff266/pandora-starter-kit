/**
 * Governance Pipeline Orchestrator
 *
 * Runs a proposed change through all five governance agents in sequence:
 * validate → review → explain → compare → pending_approval (or rejected)
 */

import {
  createGovernanceRecord,
  getGovernanceRecord,
  updateStatus,
  updateShapeValidation,
  updateReview,
  updateExplanation,
  updateComparison,
  updateSnapshot,
  type SkillGovernanceRecord,
} from './db.js';
import { validateChangeShape } from './shape-validator.js';
import { reviewProposedChange } from './review-agent.js';
import { explainProposedChange } from './explainer-agent.js';
import { snapshotExisting } from './rollback-engine.js';
import { compareBeforeAfter } from './comparison-engine.js';

export interface GovernanceProposal {
  source_type: string;
  source_id?: string;
  source_feedback_ids?: string[];
  change_type: string;
  change_description: string;
  change_payload: any;
  supersedes_id?: string;
}

export async function processGovernanceProposal(
  workspaceId: string,
  proposal: GovernanceProposal
): Promise<SkillGovernanceRecord> {
  // 1. Create governance record
  const record = await createGovernanceRecord(workspaceId, proposal);
  await updateStatus(record.id, 'validating', 'system');

  // 2. Snapshot what this supersedes (for rollback)
  if (proposal.supersedes_id) {
    try {
      const snapshot = await snapshotExisting(workspaceId, proposal.change_type, proposal.change_payload);
      if (snapshot) await updateSnapshot(record.id, snapshot);
    } catch (err) {
      console.warn(`[Governance] Snapshot failed for ${record.id}:`, err);
    }
  }

  // 3. Shape validation
  let shapeResult;
  try {
    shapeResult = await validateChangeShape(workspaceId, proposal.change_type, proposal.change_payload);
    await updateShapeValidation(record.id, shapeResult);
  } catch (err) {
    shapeResult = { valid: false, errors: [`Shape validation error: ${err}`], warnings: [], checks_performed: [] };
    await updateShapeValidation(record.id, shapeResult);
  }

  if (!shapeResult.valid) {
    await updateStatus(record.id, 'rejected', 'shape_validator', `Shape validation failed: ${shapeResult.errors.join('; ')}`);
    return (await getGovernanceRecord(record.id))!;
  }
  await updateStatus(record.id, 'validated', 'shape_validator');

  // 4. Review agent
  await updateStatus(record.id, 'reviewing', 'system');
  let reviewResult;
  try {
    const currentRecord = (await getGovernanceRecord(record.id))!;
    reviewResult = await reviewProposedChange(workspaceId, currentRecord);
    await updateReview(record.id, reviewResult);
  } catch (err) {
    reviewResult = { recommendation: 'needs_revision' as const, score: 0.3, concerns: [`Review error: ${err}`], strengths: [], dimension_scores: {} };
    await updateReview(record.id, reviewResult);
  }

  if (reviewResult.recommendation === 'reject') {
    await updateStatus(record.id, 'rejected', 'review_agent', `Review rejected: ${reviewResult.concerns.join('; ')}`);
    return (await getGovernanceRecord(record.id))!;
  }
  await updateStatus(record.id, 'reviewed', 'review_agent');

  // 5. Explainer agent
  try {
    const currentRecord = (await getGovernanceRecord(record.id))!;
    const explanation = await explainProposedChange(workspaceId, currentRecord);
    await updateExplanation(record.id, explanation);
  } catch (err) {
    console.warn(`[Governance] Explainer failed for ${record.id}:`, err);
  }

  // 6. Comparison engine — initialized with a safe default so step 7 always has a value
  let comparisonResult: { test_cases: any[]; overall_improvement: number; recommendation: 'deploy' | 'hold' | 'reject'; summary: string } = {
    test_cases: [],
    overall_improvement: 0,
    recommendation: 'hold',
    summary: 'Comparison not yet run',
  };

  try {
    const currentRecord = (await getGovernanceRecord(record.id))!;
    comparisonResult = await compareBeforeAfter(workspaceId, currentRecord);
  } catch (err) {
    comparisonResult = {
      test_cases: [],
      overall_improvement: 0,
      recommendation: 'hold',
      summary: `Comparison engine error: ${err}`,
    };
    console.warn(`[Governance] Comparison engine failed for ${record.id}:`, err);
  }

  // Persist comparison results separately — failure here must not block step 7
  try {
    await updateComparison(record.id, comparisonResult);
  } catch (err) {
    console.warn(`[Governance] Could not persist comparison for ${record.id} (non-fatal):`, err);
  }

  // 7. Final status — guaranteed to run regardless of comparison outcome
  try {
    if (comparisonResult.recommendation === 'reject' || comparisonResult.overall_improvement < -0.2) {
      await updateStatus(record.id, 'rejected', 'comparison_engine', `Comparison showed regression: ${comparisonResult.summary}`);
    } else {
      await updateStatus(record.id, 'pending_approval', 'system');
    }
  } catch (err) {
    // Last-ditch: if updateStatus itself fails, force the record out of 'reviewed'
    console.error(`[Governance] Could not set final status for ${record.id}:`, err);
    await query(
      `UPDATE skill_governance SET status = 'pending_approval', updated_at = NOW() WHERE id = $1 AND status = 'reviewed'`,
      [record.id]
    ).catch(() => null);
  }

  return (await getGovernanceRecord(record.id))!;
}

// ===== PAYLOAD BUILDER =====

export interface SelfHealSuggestion {
  type: 'resolver_pattern' | 'workspace_context' | 'named_filter';
  description: string;
  implementation_hint: string;
  confidence: number;
  source_pattern?: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 50);
}

function extractRegex(hint: string): string | null {
  // Try to find a regex pattern in the hint
  const match = hint.match(/[Rr]egex[:\s]+[`'"]?([^`'"]+)[`'"]?/);
  if (match) return match[1];
  // Look for forward-slash patterns
  const slashMatch = hint.match(/\/([^\/]+)\/[gi]*/);
  if (slashMatch) return slashMatch[1];
  return null;
}

export function buildPayloadFromSuggestion(suggestion: SelfHealSuggestion): any {
  switch (suggestion.type) {
    case 'workspace_context':
      return {
        context_key: slugify(suggestion.description),
        context_value: suggestion.implementation_hint,
        context_category: 'auto',
        injection_point: 'system_prompt',
        confidence: suggestion.confidence,
        evidence: suggestion.source_pattern || 'self_heal',
      };

    case 'resolver_pattern': {
      const extractedRegex = extractRegex(suggestion.implementation_hint);
      const pattern = extractedRegex || slugify(suggestion.description).replace(/_/g, '\\s+');
      return {
        pattern,
        pattern_flags: 'i',
        intent: slugify(suggestion.description),
        response_template: suggestion.implementation_hint,
        data_query: '',
        priority: 100,
        test_inputs: [],
        test_non_matches: [],
      };
    }

    case 'named_filter':
      return {
        filter_name: suggestion.description.substring(0, 50),
        filter_slug: slugify(suggestion.description),
        description: suggestion.implementation_hint,
        filter_definition: {
          entity_type: 'deal',
          conditions: [],
        },
        suggested_aliases: [],
      };

    default:
      return {
        context_key: slugify(suggestion.description),
        context_value: suggestion.implementation_hint,
        context_category: 'auto',
        injection_point: 'system_prompt',
        confidence: suggestion.confidence,
        evidence: 'self_heal',
      };
  }
}
