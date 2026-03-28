/**
 * Forward Deploy Admin Routes — Phases 8 & 10
 *
 * Admin-only endpoints for seeding and managing workspace intelligence.
 * Phase 8: Seeding endpoints
 * Phase 10: Full API surface for Forward Deployment UI
 */

import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../middleware/permissions.js';
import {
  seedWorkspaceForForwardDeploy,
  seedAllExistingWorkspaces,
} from '../lib/forward-deploy-seeder.js';
import {
  resolveWorkspaceIntelligence,
  invalidateWorkspaceIntelligence,
} from '../lib/workspace-intelligence.js';
import {
  CALIBRATION_QUESTIONS,
  getQuestionById,
} from '../lib/calibration-questions.js';
import { query } from '../db.js';

const router = Router();

/**
 * POST /api/admin/forward-deploy/seed/:workspaceId
 *
 * Seeds a single workspace with metrics and calibration checklist.
 * Pre-populates from existing workspace_config.
 * Idempotent - safe to run multiple times.
 */
router.post(
  '/forward-deploy/seed/:workspaceId',
  requirePermission('config.view'),
  async (req: Request, res: Response) => {
    const workspaceId = req.params.workspaceId as string;

    try {
      console.log(`[ForwardDeploy] Seeding workspace ${workspaceId}`);
      const result = await seedWorkspaceForForwardDeploy(workspaceId);

      res.json({
        success: true,
        ...result,
      });
    } catch (err: any) {
      console.error('[ForwardDeploy] Seed failed:', err?.message);
      res.status(500).json({
        success: false,
        error: 'Seed failed',
        message: err?.message,
      });
    }
  }
);

/**
 * POST /api/admin/forward-deploy/seed-all
 *
 * Seeds all existing workspaces with metrics and calibration checklist.
 * Pre-populates from existing workspace_config.
 * Returns summary of all workspaces seeded.
 */
router.post(
  '/forward-deploy/seed-all',
  requirePermission('config.view'),
  async (req: Request, res: Response) => {
    try {
      console.log(`[ForwardDeploy] Seeding all workspaces`);
      const results = await seedAllExistingWorkspaces();

      res.json({
        success: true,
        workspaces_processed: results.length,
        results,
      });
    } catch (err: any) {
      console.error('[ForwardDeploy] Bulk seed failed:', err?.message);
      res.status(500).json({
        success: false,
        error: 'Bulk seed failed',
        message: err?.message,
      });
    }
  }
);

// ============================================================
// Phase 10: WorkspaceIntelligence API Endpoints
// ============================================================

/**
 * GET /api/workspaces/:id/intelligence
 *
 * Returns the full WorkspaceIntelligence object for a workspace.
 * Used by: debug UI, forward deployment dashboard, any surface showing readiness state.
 */
router.get(
  '/:workspaceId/intelligence',
  requirePermission('config.view'),
  async (req: Request, res: Response) => {
    const workspaceId = req.params.workspaceId as string;

    try {
      const wi = await resolveWorkspaceIntelligence(workspaceId);
      res.json({ success: true, data: wi });
    } catch (err: any) {
      console.error('[ForwardDeploy] Failed to resolve WorkspaceIntelligence:', err?.message);
      res.status(500).json({
        success: false,
        error: 'Failed to resolve WorkspaceIntelligence',
        message: err?.message,
      });
    }
  }
);

/**
 * GET /api/workspaces/:id/intelligence/readiness
 *
 * Returns just the readiness domain — lighter call for progress indicators.
 */
router.get(
  '/:workspaceId/intelligence/readiness',
  requirePermission('config.view'),
  async (req: Request, res: Response) => {
    const workspaceId = req.params.workspaceId as string;

    try {
      const wi = await resolveWorkspaceIntelligence(workspaceId);
      res.json({
        success: true,
        data: {
          overall_score: wi.readiness.overall_score,
          by_domain: wi.readiness.by_domain,
          blocking_gaps: wi.readiness.blocking_gaps,
          skill_gates: wi.readiness.skill_gates,
        },
      });
    } catch (err: any) {
      console.error('[ForwardDeploy] Failed to resolve readiness:', err?.message);
      res.status(500).json({
        success: false,
        error: 'Failed to resolve readiness',
        message: err?.message,
      });
    }
  }
);

/**
 * GET /api/workspaces/:id/calibration
 *
 * Returns calibration checklist grouped by domain with progress counts.
 * Joins with CALIBRATION_QUESTIONS to include question text and metadata.
 */
router.get(
  '/:workspaceId/calibration',
  requirePermission('config.view'),
  async (req: Request, res: Response) => {
    const workspaceId = req.params.workspaceId as string;

    try {
      // Query checklist rows
      const result = await query(
        `SELECT question_id, domain, status, answer, answer_source,
                confidence, human_confirmed, confirmed_by, confirmed_at,
                depends_on, skill_dependencies
         FROM calibration_checklist
         WHERE workspace_id = $1
         ORDER BY domain, question_id`,
        [workspaceId]
      );

      // Group by domain and calculate scores
      const domains: Record<string, any> = {
        business: { score: 0, total: 0, confirmed: 0, inferred: 0, unknown: 0, questions: [] },
        metrics: { score: 0, total: 0, confirmed: 0, inferred: 0, unknown: 0, questions: [] },
        taxonomy: { score: 0, total: 0, confirmed: 0, inferred: 0, unknown: 0, questions: [] },
        pipeline: { score: 0, total: 0, confirmed: 0, inferred: 0, unknown: 0, questions: [] },
        segmentation: { score: 0, total: 0, confirmed: 0, inferred: 0, unknown: 0, questions: [] },
        data_quality: { score: 0, total: 0, confirmed: 0, inferred: 0, unknown: 0, questions: [] },
      };

      for (const row of result.rows) {
        const questionMeta = getQuestionById(row.question_id);
        if (!questionMeta) continue;

        const domain = row.domain;
        if (!domains[domain]) continue;

        domains[domain].total++;
        if (row.status === 'CONFIRMED') {
          domains[domain].confirmed++;
        } else if (row.status === 'INFERRED') {
          domains[domain].inferred++;
        } else if (row.status === 'UNKNOWN') {
          domains[domain].unknown++;
        }

        domains[domain].questions.push({
          question_id: row.question_id,
          question: questionMeta.question,
          description: questionMeta.description,
          answer_type: questionMeta.answer_type,
          options: questionMeta.options || [],
          status: row.status,
          answer: row.answer,
          answer_source: row.answer_source,
          confidence: row.confidence,
          required_for_live: questionMeta.required_for_live,
          skill_dependencies: row.skill_dependencies || [],
          depends_on: row.depends_on || [],
          human_confirmed: row.human_confirmed,
        });
      }

      // Calculate domain scores (confirmed + 0.5 * inferred) / total
      for (const domain of Object.keys(domains)) {
        if (domains[domain].total > 0) {
          domains[domain].score = Math.round(
            ((domains[domain].confirmed + 0.5 * domains[domain].inferred) / domains[domain].total) * 100
          );
        }
      }

      // Calculate overall score
      const domainScores = Object.values(domains).map((d: any) => d.score);
      const overall_score = Math.round(
        domainScores.reduce((sum: number, score: number) => sum + score, 0) / domainScores.length
      );

      res.json({
        success: true,
        data: {
          overall_score,
          domains,
        },
      });
    } catch (err: any) {
      console.error('[ForwardDeploy] Failed to fetch calibration:', err?.message);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch calibration',
        message: err?.message,
      });
    }
  }
);

/**
 * PATCH /api/workspaces/:id/calibration/:questionId
 *
 * Update a single checklist answer. Used when forward deployment specialist fills in a question.
 */
router.patch(
  '/:workspaceId/calibration/:questionId',
  requirePermission('config.view'),
  async (req: Request, res: Response) => {
    const workspaceId = req.params.workspaceId as string;
    const questionId = req.params.questionId as string;
    const { answer, status, confirmed_by } = req.body;

    try {
      // Validation
      if (!answer) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          message: 'answer is required',
        });
        return;
      }

      if (!['CONFIRMED', 'INFERRED'].includes(status)) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          message: 'status must be CONFIRMED or INFERRED',
        });
        return;
      }

      const questionMeta = getQuestionById(questionId);
      if (!questionMeta) {
        res.status(404).json({
          success: false,
          error: 'Question not found',
          message: `question_id '${questionId}' does not exist in CALIBRATION_QUESTIONS`,
        });
        return;
      }

      // Update checklist row
      const confidence = status === 'CONFIRMED' ? 1.0 : 0.7;
      const result = await query(
        `UPDATE calibration_checklist
         SET answer = $1, status = $2, confidence = $3,
             confirmed_by = $4, confirmed_at = NOW(),
             human_confirmed = ($2 = 'CONFIRMED'),
             answer_source = 'FORWARD_DEPLOY',
             updated_at = NOW()
         WHERE workspace_id = $5 AND question_id = $6
         RETURNING *`,
        [JSON.stringify(answer), status, confidence, confirmed_by, workspaceId, questionId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({
          success: false,
          error: 'Checklist row not found',
          message: `No checklist row found for workspace ${workspaceId} and question ${questionId}`,
        });
        return;
      }

      // Invalidate cache
      invalidateWorkspaceIntelligence(workspaceId);

      // Merge with question metadata
      const updatedRow = result.rows[0];
      res.json({
        success: true,
        data: {
          ...updatedRow,
          question: questionMeta.question,
          description: questionMeta.description,
          answer_type: questionMeta.answer_type,
          options: questionMeta.options || [],
          required_for_live: questionMeta.required_for_live,
        },
      });
    } catch (err: any) {
      console.error('[ForwardDeploy] Failed to update calibration answer:', err?.message);
      res.status(500).json({
        success: false,
        error: 'Failed to update calibration answer',
        message: err?.message,
      });
    }
  }
);

/**
 * POST /api/workspaces/:id/calibration/:questionId/confirm
 *
 * Confirmation loop endpoint. Pandora presents a computed value — human says yes or no.
 */
router.post(
  '/:workspaceId/calibration/:questionId/confirm',
  requirePermission('config.view'),
  async (req: Request, res: Response) => {
    const workspaceId = req.params.workspaceId as string;
    const questionId = req.params.questionId as string;
    const { confirmed_value, confirmed, confirmed_by } = req.body;

    try {
      const questionMeta = getQuestionById(questionId);
      if (!questionMeta) {
        res.status(404).json({
          success: false,
          error: 'Question not found',
          message: `question_id '${questionId}' does not exist`,
        });
        return;
      }

      let result;

      if (confirmed === true) {
        // User confirmed the computed value
        result = await query(
          `UPDATE calibration_checklist
           SET status = 'CONFIRMED', human_confirmed = true,
               confirmed_by = $1, confirmed_at = NOW(),
               answer = jsonb_set(COALESCE(answer, '{}'), '{confirmed_value}', $2::text::jsonb),
               updated_at = NOW()
           WHERE workspace_id = $3 AND question_id = $4
           RETURNING *`,
          [confirmed_by, JSON.stringify(confirmed_value), workspaceId, questionId]
        );
      } else {
        // User rejected the computed value
        result = await query(
          `UPDATE calibration_checklist
           SET status = 'UNKNOWN', human_confirmed = false,
               pandora_computed_answer = answer,
               answer = null,
               updated_at = NOW()
           WHERE workspace_id = $1 AND question_id = $2
           RETURNING *`,
          [workspaceId, questionId]
        );
      }

      if (result.rows.length === 0) {
        res.status(404).json({
          success: false,
          error: 'Checklist row not found',
          message: `No checklist row found for workspace ${workspaceId} and question ${questionId}`,
        });
        return;
      }

      // Invalidate cache
      invalidateWorkspaceIntelligence(workspaceId);

      res.json({
        success: true,
        data: result.rows[0],
        message: confirmed ? 'Answer confirmed' : 'Answer rejected, status set to UNKNOWN',
      });
    } catch (err: any) {
      console.error('[ForwardDeploy] Failed to confirm answer:', err?.message);
      res.status(500).json({
        success: false,
        error: 'Failed to confirm answer',
        message: err?.message,
      });
    }
  }
);

/**
 * GET /api/workspaces/:id/metrics
 *
 * Returns all metric definitions for workspace merged with standard library metadata.
 */
router.get(
  '/:workspaceId/metrics',
  requirePermission('config.view'),
  async (req: Request, res: Response) => {
    const workspaceId = req.params.workspaceId as string;

    try {
      const result = await query(
        `SELECT * FROM metric_definitions
         WHERE workspace_id = $1
         ORDER BY metric_key`,
        [workspaceId]
      );

      // Get WI to check current confidence gates
      const wi = await resolveWorkspaceIntelligence(workspaceId);

      const metrics = result.rows.map((m: any) => ({
        ...m,
        current_gate: wi.metrics[m.metric_key]?.confidence ?? 'UNKNOWN',
      }));

      res.json({
        success: true,
        data: metrics,
      });
    } catch (err: any) {
      console.error('[ForwardDeploy] Failed to fetch metrics:', err?.message);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch metrics',
        message: err?.message,
      });
    }
  }
);

/**
 * PATCH /api/workspaces/:id/metrics/:metricKey
 *
 * Forward deployment override of a metric definition.
 */
router.patch(
  '/:workspaceId/metrics/:metricKey',
  requirePermission('config.view'),
  async (req: Request, res: Response) => {
    const workspaceId = req.params.workspaceId as string;
    const metricKey = req.params.metricKey as string;
    const { numerator, denominator, label, description, confirmed_by } = req.body;

    try {
      // Basic validation of numerator if provided
      if (numerator) {
        if (!numerator.entity || !numerator.aggregation) {
          res.status(400).json({
            success: false,
            error: 'Validation failed',
            message: 'numerator must have entity and aggregation fields',
          });
          return;
        }
      }

      const result = await query(
        `UPDATE metric_definitions
         SET numerator = COALESCE($1, numerator),
             denominator = COALESCE($2, denominator),
             label = COALESCE($3, label),
             description = COALESCE($4, description),
             confidence = 'CONFIRMED',
             confirmed_by = $5,
             confirmed_at = NOW(),
             source = 'FORWARD_DEPLOY',
             updated_at = NOW()
         WHERE workspace_id = $6 AND metric_key = $7
         RETURNING *`,
        [
          numerator ? JSON.stringify(numerator) : null,
          denominator ? JSON.stringify(denominator) : null,
          label,
          description,
          confirmed_by,
          workspaceId,
          metricKey,
        ]
      );

      if (result.rows.length === 0) {
        res.status(404).json({
          success: false,
          error: 'Metric not found',
          message: `No metric found for workspace ${workspaceId} and metric_key ${metricKey}`,
        });
        return;
      }

      // Invalidate cache
      invalidateWorkspaceIntelligence(workspaceId);

      res.json({
        success: true,
        data: result.rows[0],
      });
    } catch (err: any) {
      console.error('[ForwardDeploy] Failed to update metric:', err?.message);
      res.status(500).json({
        success: false,
        error: 'Failed to update metric',
        message: err?.message,
      });
    }
  }
);

/**
 * POST /api/workspaces/:id/metrics/:metricKey/confirm
 *
 * Confirmation loop for metrics. Pandora computed a value — does it match expectations?
 */
router.post(
  '/:workspaceId/metrics/:metricKey/confirm',
  requirePermission('config.view'),
  async (req: Request, res: Response) => {
    const workspaceId = req.params.workspaceId as string;
    const metricKey = req.params.metricKey as string;
    const { confirmed_value, confirmed, confirmed_by } = req.body;

    try {
      let result;

      if (confirmed === true) {
        // User confirmed the metric value
        result = await query(
          `UPDATE metric_definitions
           SET confidence = 'CONFIRMED',
               confirmed_value = $1,
               confirmed_by = $2,
               confirmed_at = NOW(),
               updated_at = NOW()
           WHERE workspace_id = $3 AND metric_key = $4
           RETURNING *`,
          [confirmed_value, confirmed_by, workspaceId, metricKey]
        );
      } else {
        // User rejected the metric value - set to UNKNOWN and log
        result = await query(
          `UPDATE metric_definitions
           SET confidence = 'UNKNOWN',
               updated_at = NOW()
           WHERE workspace_id = $1 AND metric_key = $2
           RETURNING *`,
          [workspaceId, metricKey]
        );

        console.log(
          `[ForwardDeploy] Metric ${metricKey} rejected by ${confirmed_by}. Definition may need review.`
        );
      }

      if (result.rows.length === 0) {
        res.status(404).json({
          success: false,
          error: 'Metric not found',
          message: `No metric found for workspace ${workspaceId} and metric_key ${metricKey}`,
        });
        return;
      }

      // Invalidate cache
      invalidateWorkspaceIntelligence(workspaceId);

      res.json({
        success: true,
        data: result.rows[0],
        message: confirmed
          ? 'Metric value confirmed'
          : 'Metric value rejected, confidence set to UNKNOWN. Definition may need adjustment.',
      });
    } catch (err: any) {
      console.error('[ForwardDeploy] Failed to confirm metric:', err?.message);
      res.status(500).json({
        success: false,
        error: 'Failed to confirm metric',
        message: err?.message,
      });
    }
  }
);

export default router;
