/**
 * Governance DB Helpers
 *
 * Shared database operations for the skill_governance lifecycle.
 */

import { query } from '../db.js';

export interface SkillGovernanceRecord {
  id: string;
  workspace_id: string;
  source_type: string;
  source_id?: string;
  source_feedback_ids?: string[];
  change_type: string;
  change_description: string;
  change_payload: any;
  supersedes_id?: string;
  supersedes_type?: string;
  supersedes_snapshot?: any;
  shape_validation?: any;
  shape_valid?: boolean;
  shape_errors?: string[];
  review_result?: any;
  review_score?: number;
  review_recommendation?: string;
  review_concerns?: string[];
  explanation?: any;
  explanation_summary?: string;
  explanation_detail?: string;
  explanation_impact?: string;
  comparison?: any;
  comparison_test_cases?: any;
  comparison_before_results?: any;
  comparison_after_results?: any;
  comparison_improvement_score?: number;
  status: string;
  status_history?: Array<{ status: string; timestamp: string; actor: string; reason?: string }>;
  deployed_at?: Date;
  deployed_by?: string;
  trial_expires_at?: Date;
  monitoring_start?: Date;
  monitoring_feedback_before?: any;
  monitoring_feedback_after?: any;
  monitoring_verdict?: string;
  rolled_back_at?: Date;
  rolled_back_by?: string;
  rollback_reason?: string;
  created_at?: Date;
  updated_at?: Date;
}

export async function createGovernanceRecord(
  workspaceId: string,
  proposal: {
    source_type: string;
    source_id?: string;
    source_feedback_ids?: string[];
    change_type: string;
    change_description: string;
    change_payload: any;
    supersedes_id?: string;
    supersedes_type?: string;
  }
): Promise<SkillGovernanceRecord> {
  const result = await query(
    `INSERT INTO skill_governance
      (workspace_id, source_type, source_id, source_feedback_ids, change_type,
       change_description, change_payload, supersedes_id, supersedes_type, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'proposed')
     RETURNING *`,
    [
      workspaceId,
      proposal.source_type,
      proposal.source_id || null,
      proposal.source_feedback_ids || [],
      proposal.change_type,
      proposal.change_description,
      JSON.stringify(proposal.change_payload),
      proposal.supersedes_id || null,
      proposal.supersedes_type || null,
    ]
  );
  return result.rows[0];
}

export async function getGovernanceRecord(id: string): Promise<SkillGovernanceRecord | null> {
  const result = await query(`SELECT * FROM skill_governance WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

export async function updateStatus(
  id: string,
  status: string,
  actor: string,
  reason?: string
): Promise<void> {
  const historyEntry = JSON.stringify([{
    status,
    timestamp: new Date().toISOString(),
    actor,
    reason: reason || null,
  }]);

  await query(
    `UPDATE skill_governance
     SET status = $2,
         status_history = status_history || $3::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [id, status, historyEntry]
  );
}

export async function updateShapeValidation(
  id: string,
  result: { valid: boolean; errors: string[]; warnings: string[]; checks_performed: string[] }
): Promise<void> {
  await query(
    `UPDATE skill_governance
     SET shape_validation = $2::jsonb,
         shape_valid = $3,
         shape_errors = $4,
         updated_at = NOW()
     WHERE id = $1`,
    [id, JSON.stringify(result), result.valid, result.errors]
  );
}

export async function updateReview(
  id: string,
  result: {
    recommendation: string;
    score: number;
    concerns: string[];
    strengths: string[];
    revision_suggestions?: string;
    dimension_scores?: Record<string, number>;
  }
): Promise<void> {
  await query(
    `UPDATE skill_governance
     SET review_result = $2::jsonb,
         review_score = $3,
         review_recommendation = $4,
         review_concerns = $5,
         updated_at = NOW()
     WHERE id = $1`,
    [id, JSON.stringify(result), result.score, result.recommendation, result.concerns]
  );
}

export async function updateExplanation(
  id: string,
  explanation: {
    summary: string;
    detail: string;
    impact: string;
    supersedes?: string;
    rollback_note: string;
  }
): Promise<void> {
  await query(
    `UPDATE skill_governance
     SET explanation = $2::jsonb,
         explanation_summary = $3,
         explanation_detail = $4,
         explanation_impact = $5,
         updated_at = NOW()
     WHERE id = $1`,
    [id, JSON.stringify(explanation), explanation.summary, explanation.detail, explanation.impact]
  );
}

export async function updateComparison(
  id: string,
  result: {
    test_cases: any[];
    overall_improvement: number;
    recommendation: string;
    summary: string;
  }
): Promise<void> {
  await query(
    `UPDATE skill_governance
     SET comparison = $2::jsonb,
         comparison_test_cases = $3::jsonb,
         comparison_improvement_score = $4,
         updated_at = NOW()
     WHERE id = $1`,
    [id, JSON.stringify(result), JSON.stringify(result.test_cases), result.overall_improvement]
  );
}

export async function updateSnapshot(id: string, snapshot: any): Promise<void> {
  await query(
    `UPDATE skill_governance
     SET supersedes_snapshot = $2::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [id, JSON.stringify(snapshot)]
  );
}
