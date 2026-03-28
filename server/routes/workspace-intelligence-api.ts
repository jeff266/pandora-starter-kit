/**
 * WorkspaceIntelligence API — Phase 10
 *
 * Exposes the WI resolver, calibration checklist (with full question metadata),
 * and metric definitions as HTTP endpoints for the Forward Deployment UI and
 * forward-deployment specialist tooling.
 *
 * All routes require workspace API key or session auth (via workspaceApiRouter middleware).
 */

import { Router } from 'express';
import { query } from '../db.js';
import {
  resolveWorkspaceIntelligence,
  invalidateWorkspaceIntelligence,
} from '../lib/workspace-intelligence.js';
import { getQuestionById } from '../lib/calibration-questions.js';

const router = Router();

// ── GET /:workspaceId/intelligence ───────────────────────────────────────────
// Returns the full WorkspaceIntelligence object for the workspace.
router.get('/:workspaceId/intelligence', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const wi = await resolveWorkspaceIntelligence(workspaceId);
    res.json({ success: true, data: wi });
  } catch (err: any) {
    console.error('[wi-api] GET intelligence failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /:workspaceId/intelligence/readiness ──────────────────────────────────
// Returns just the readiness portion (scores + gates + blocking gaps).
router.get('/:workspaceId/intelligence/readiness', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const wi = await resolveWorkspaceIntelligence(workspaceId);
    res.json({ success: true, data: wi.readiness });
  } catch (err: any) {
    console.error('[wi-api] GET intelligence/readiness failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /:workspaceId/calibration ─────────────────────────────────────────────
// Returns the full calibration checklist — domain scores + per-domain questions
// with current answers, statuses, and question metadata merged in.
router.get('/:workspaceId/calibration', async (req, res) => {
  try {
    const { workspaceId } = req.params;

    const result = await query<{
      question_id: string;
      domain: string;
      status: string;
      answer: any;
      answer_source: string | null;
      confidence: number | null;
      human_confirmed: boolean;
      confirmed_by: string | null;
      confirmed_at: Date | null;
      depends_on: any;
      skill_dependencies: any;
    }>(
      `SELECT question_id, domain, status, answer, answer_source,
              confidence, human_confirmed, confirmed_by, confirmed_at,
              depends_on, skill_dependencies
       FROM calibration_checklist
       WHERE workspace_id = $1
       ORDER BY domain, question_id`,
      [workspaceId]
    );

    // Group by domain
    const domains: Record<string, {
      score: number;
      total: number;
      confirmed: number;
      inferred: number;
      unknown: number;
      questions: any[];
    }> = {
      business:     { score: 0, total: 0, confirmed: 0, inferred: 0, unknown: 0, questions: [] },
      metrics:      { score: 0, total: 0, confirmed: 0, inferred: 0, unknown: 0, questions: [] },
      taxonomy:     { score: 0, total: 0, confirmed: 0, inferred: 0, unknown: 0, questions: [] },
      pipeline:     { score: 0, total: 0, confirmed: 0, inferred: 0, unknown: 0, questions: [] },
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
      } else {
        domains[domain].unknown++;
      }

      domains[domain].questions.push({
        question_id:       row.question_id,
        question:          questionMeta.question,
        description:       questionMeta.description,
        answer_type:       questionMeta.answer_type,
        options:           questionMeta.options || [],
        status:            row.status,
        answer:            row.answer,
        answer_source:     row.answer_source,
        confidence:        row.confidence,
        required_for_live: questionMeta.required_for_live,
        skill_dependencies: Array.isArray(row.skill_dependencies)
          ? row.skill_dependencies
          : (row.skill_dependencies || []),
        depends_on: Array.isArray(row.depends_on)
          ? row.depends_on
          : (row.depends_on || []),
        human_confirmed:   row.human_confirmed,
        confirmed_by:      row.confirmed_by,
      });
    }

    // Calculate domain scores
    let totalConfirmed = 0;
    let totalInferred = 0;
    let totalRows = 0;

    for (const domain of Object.keys(domains)) {
      const d = domains[domain];
      if (d.total > 0) {
        d.score = Math.round(((d.confirmed + 0.5 * d.inferred) / d.total) * 100);
      }
      totalConfirmed += d.confirmed;
      totalInferred  += d.inferred;
      totalRows      += d.total;
    }

    const overall_score = totalRows > 0
      ? Math.round(((totalConfirmed + totalInferred * 0.5) / totalRows) * 100)
      : 0;

    res.json({ success: true, data: { overall_score, domains } });
  } catch (err: any) {
    console.error('[wi-api] GET calibration failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PATCH /:workspaceId/calibration/:questionId ───────────────────────────────
// Updates a single calibration checklist answer.
// Body: { answer, status: 'CONFIRMED'|'INFERRED', confirmed_by? }
router.patch('/:workspaceId/calibration/:questionId', async (req, res) => {
  try {
    const { workspaceId, questionId } = req.params;
    const { answer, status, confirmed_by } = req.body;

    if (!status || !['CONFIRMED', 'INFERRED', 'UNKNOWN'].includes(status)) {
      res.status(400).json({
        success: false,
        error: 'status must be CONFIRMED, INFERRED, or UNKNOWN',
      });
      return;
    }

    const answerJson = answer !== undefined ? JSON.stringify(answer) : null;
    const confirmedAt = status === 'CONFIRMED' ? new Date() : null;
    const humanConfirmed = status === 'CONFIRMED';
    const answerSource = status === 'CONFIRMED' ? 'USER' : null;

    const updateResult = await query<{
      question_id: string;
      status: string;
      answer: any;
      answer_source: string;
      confirmed_by: string;
      confirmed_at: Date;
      updated_at: Date;
    }>(
      `UPDATE calibration_checklist
       SET answer        = CASE WHEN $1::text IS NOT NULL THEN $1::jsonb ELSE answer END,
           status        = $2,
           answer_source = CASE WHEN $3::text IS NOT NULL THEN $3::text ELSE answer_source END,
           human_confirmed = $4,
           confirmed_by  = COALESCE($5, confirmed_by),
           confirmed_at  = COALESCE($6::timestamptz, confirmed_at),
           updated_at    = now()
       WHERE workspace_id = $7 AND question_id = $8
       RETURNING question_id, status, answer, answer_source, confirmed_by, confirmed_at, updated_at`,
      [
        answerJson,
        status,
        answerSource,
        humanConfirmed,
        confirmed_by ?? null,
        confirmedAt ? confirmedAt.toISOString() : null,
        workspaceId,
        questionId,
      ]
    );

    if (updateResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: `Question '${questionId}' not found in checklist for this workspace`,
      });
      return;
    }

    invalidateWorkspaceIntelligence(workspaceId);
    res.json({ success: true, data: updateResult.rows[0] });
  } catch (err: any) {
    console.error('[wi-api] PATCH calibration failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /:workspaceId/metrics ─────────────────────────────────────────────────
// Returns all metric definitions for the workspace from WorkspaceIntelligence.
router.get('/:workspaceId/metrics', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const wi = await resolveWorkspaceIntelligence(workspaceId);

    const metrics = Object.entries(wi.metrics).map(([metric_key, m]) => ({
      metric_key,
      label:               m.label,
      aggregation_method:  m.aggregation_method,
      unit:                m.unit,
      confidence:          m.confidence,
      last_computed_value: m.last_computed_value,
      confirmed_value:     m.confirmed_value,
    }));

    res.json({ success: true, data: metrics });
  } catch (err: any) {
    console.error('[wi-api] GET metrics failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /:workspaceId/metrics/:metricKey/confirm ─────────────────────────────
// Confirms or rejects a computed metric value.
// Body: { confirmed_value, confirmed: boolean, confirmed_by? }
router.post('/:workspaceId/metrics/:metricKey/confirm', async (req, res) => {
  try {
    const { workspaceId, metricKey } = req.params;
    const { confirmed_value, confirmed, confirmed_by } = req.body;

    if (confirmed === true) {
      await query(
        `UPDATE metric_definitions
         SET confidence     = 'CONFIRMED',
             confirmed_value = $1,
             confirmed_by   = $2,
             confirmed_at   = NOW(),
             updated_at     = NOW()
         WHERE workspace_id = $3 AND metric_key = $4`,
        [confirmed_value, confirmed_by ?? null, workspaceId, metricKey]
      );
    } else {
      await query(
        `UPDATE metric_definitions
         SET confidence = 'UNKNOWN',
             updated_at = NOW()
         WHERE workspace_id = $1 AND metric_key = $2`,
        [workspaceId, metricKey]
      );
    }

    invalidateWorkspaceIntelligence(workspaceId);
    res.json({ success: true, confirmed });
  } catch (err: any) {
    console.error('[wi-api] POST metrics confirm failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
