/**
 * WorkspaceIntelligence API — Phase 10
 *
 * Exposes the WI resolver, calibration checklist, and metric definitions
 * as HTTP endpoints for forward-deployment and client consumption.
 *
 * All routes require workspace API key or session auth (via workspaceApiRouter middleware).
 */

import { Router } from 'express';
import { query } from '../db.js';
import {
  resolveWorkspaceIntelligence,
  invalidateWorkspaceIntelligence,
} from '../lib/workspace-intelligence.js';

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
// Returns the calibration checklist summary — domain scores + per-domain counts.
router.get('/:workspaceId/calibration', async (req, res) => {
  try {
    const { workspaceId } = req.params;

    const result = await query<{
      domain: string;
      status: string;
      cnt: string;
    }>(
      `SELECT domain, status, COUNT(*) as cnt
       FROM calibration_checklist
       WHERE workspace_id = $1
       GROUP BY domain, status
       ORDER BY domain, status`,
      [workspaceId]
    );

    // Build domain breakdown
    const domainMap: Record<
      string,
      { total: number; confirmed: number; inferred: number; unknown: number }
    > = {};

    let totalConfirmed = 0;
    let totalInferred = 0;
    let totalRows = 0;

    for (const row of result.rows) {
      const cnt = parseInt(row.cnt, 10);
      if (!domainMap[row.domain]) {
        domainMap[row.domain] = { total: 0, confirmed: 0, inferred: 0, unknown: 0 };
      }
      domainMap[row.domain].total += cnt;
      totalRows += cnt;

      if (row.status === 'CONFIRMED') {
        domainMap[row.domain].confirmed += cnt;
        totalConfirmed += cnt;
      } else if (row.status === 'INFERRED') {
        domainMap[row.domain].inferred += cnt;
        totalInferred += cnt;
      } else if (row.status === 'UNKNOWN') {
        domainMap[row.domain].unknown += cnt;
      }
    }

    // Overall score: CONFIRMED=1, INFERRED=0.5, else 0
    const weightedScore =
      totalRows > 0
        ? Math.round(((totalConfirmed + totalInferred * 0.5) / totalRows) * 100)
        : 0;

    res.json({
      success: true,
      data: {
        overall_score: weightedScore,
        total_questions: totalRows,
        domains: domainMap,
      },
    });
  } catch (err: any) {
    console.error('[wi-api] GET calibration failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PATCH /:workspaceId/calibration/:questionId ───────────────────────────────
// Updates a single calibration checklist answer.
// Body: { answer, status, confirmed_by? }
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

    // Invalidate WI cache so readiness recalculates immediately
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
      label: m.label,
      aggregation_method: m.aggregation_method,
      unit: m.unit,
      confidence: m.confidence,
      last_computed_value: m.last_computed_value,
      confirmed_value: m.confirmed_value,
    }));

    res.json({ success: true, data: metrics });
  } catch (err: any) {
    console.error('[wi-api] GET metrics failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
