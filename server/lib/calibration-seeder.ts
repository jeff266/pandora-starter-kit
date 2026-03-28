/**
 * Calibration Checklist Seeder — Phase 8
 *
 * Idempotently seeds 108 calibration questions into `calibration_checklist`
 * for a workspace, then runs a CRM scan to pre-populate inferable answers.
 *
 * Entry point: ensureCalibrationChecklist(workspaceId)
 */

import { query } from '../db.js';
import { CALIBRATION_QUESTIONS } from './calibration-questions.js';

const CLOSED_PHASES = new Set(['closed_won', 'closed_lost']);

const PHASE_ORDER: Record<string, number> = {
  prospecting: 1,
  qualification: 2,
  demo: 3,
  proposal: 4,
  evaluation: 5,
  negotiation: 6,
  closed_won: 7,
  closed_lost: 8,
};

/**
 * Ensures the calibration checklist is fully seeded for a workspace.
 * No-ops if already seeded. Safe to call on every WI resolution.
 */
export async function ensureCalibrationChecklist(workspaceId: string): Promise<void> {
  try {
    const countResult = await query<{ cnt: string }>(
      'SELECT COUNT(*) as cnt FROM calibration_checklist WHERE workspace_id = $1',
      [workspaceId]
    );
    const existingCount = parseInt(countResult.rows[0]?.cnt ?? '0', 10);
    if (existingCount >= CALIBRATION_QUESTIONS.length) return;

    const questionsJson = JSON.stringify(
      CALIBRATION_QUESTIONS.map((q) => ({
        question_id: q.question_id,
        domain: q.domain,
        question: q.question,
        depends_on: q.depends_on ?? [],
        skill_dependencies: q.skill_dependencies ?? [],
      }))
    );

    await query(
      `INSERT INTO calibration_checklist
         (workspace_id, question_id, domain, question, depends_on, skill_dependencies, status)
       SELECT
         $1,
         q->>'question_id',
         q->>'domain',
         q->>'question',
         ARRAY(SELECT jsonb_array_elements_text(q->'depends_on')),
         ARRAY(SELECT jsonb_array_elements_text(q->'skill_dependencies')),
         'UNKNOWN'
       FROM jsonb_array_elements($2::jsonb) AS q
       ON CONFLICT (workspace_id, question_id) DO NOTHING`,
      [workspaceId, questionsJson]
    );

    await scanCrmAnswers(workspaceId);
  } catch (err) {
    console.error('[CalibrationSeeder] ensureCalibrationChecklist failed', {
      workspaceId,
      err,
    });
  }
}

/**
 * Scans CRM data (workspace config + deals) to pre-populate inferable questions.
 * Only updates rows that are still UNKNOWN — never overwrites human-confirmed data.
 */
async function scanCrmAnswers(workspaceId: string): Promise<void> {
  const updates: Array<{ question_id: string; answer: unknown; confidence: number }> = [];

  try {
    // ── 1. Stage mappings from workspace_config.calibration ──────────────────
    const wsResult = await query<{ workspace_config: any }>(
      'SELECT workspace_config FROM workspaces WHERE id = $1',
      [workspaceId]
    );
    const cfg = wsResult.rows[0]?.workspace_config;
    const stageMappings: Record<string, string> = cfg?.calibration?.stage_mappings ?? {};

    if (Object.keys(stageMappings).length > 0) {
      const activeStages: string[] = [];
      const closedStages: string[] = [];
      const stagesByPhase: Record<string, string[]> = {};

      for (const [stageName, phase] of Object.entries(stageMappings)) {
        const cleaned = stageName.trim();
        if (!cleaned) continue;

        if (CLOSED_PHASES.has(phase)) {
          closedStages.push(cleaned);
        } else {
          activeStages.push(cleaned);
          if (!stagesByPhase[phase]) stagesByPhase[phase] = [];
          stagesByPhase[phase].push(cleaned);
        }
      }

      if (activeStages.length > 0) {
        updates.push({
          question_id: 'pipeline_active_stages',
          answer: [...new Set(activeStages)],
          confidence: 0.9,
        });

        const orderedStages = Object.entries(stagesByPhase)
          .sort(([a], [b]) => (PHASE_ORDER[a] ?? 99) - (PHASE_ORDER[b] ?? 99))
          .flatMap(([, stages]) => [...new Set(stages)]);
        updates.push({
          question_id: 'pipeline_stage_order',
          answer: orderedStages,
          confidence: 0.85,
        });
      }

      if (closedStages.length > 0) {
        updates.push({
          question_id: 'pipeline_excludes_stages',
          answer: [...new Set(closedStages)],
          confidence: 0.85,
        });
      }
    }

    // ── 2. Forecast categories from deals ─────────────────────────────────────
    const fcResult = await query<{ forecast_category: string }>(
      `SELECT DISTINCT forecast_category
       FROM deals
       WHERE workspace_id = $1
         AND forecast_category IS NOT NULL
         AND forecast_category NOT IN ('not_forecasted', '')`,
      [workspaceId]
    );
    const forecastCats = fcResult.rows.map((r) => r.forecast_category).filter(Boolean);
    if (forecastCats.length > 0) {
      updates.push({
        question_id: 'forecast_categories',
        answer: forecastCats,
        confidence: 0.9,
      });
    }

    // ── 3. Stage history availability ─────────────────────────────────────────
    const stageHistResult = await query<{ cnt: string }>(
      `SELECT COUNT(*) as cnt FROM deals
       WHERE workspace_id = $1 AND previous_stage IS NOT NULL`,
      [workspaceId]
    );
    const stageHistCount = parseInt(stageHistResult.rows[0]?.cnt ?? '0', 10);
    if (stageHistCount > 0) {
      updates.push({
        question_id: 'stage_history_tracked',
        answer: true,
        confidence: 0.95,
      });
    }

    // ── 4. Probability-weighted pipeline ──────────────────────────────────────
    const probResult = await query<{ cnt: string }>(
      `SELECT COUNT(*) as cnt FROM deals
       WHERE workspace_id = $1
         AND probability IS NOT NULL
         AND probability > 0
         AND probability < 100`,
      [workspaceId]
    );
    const probCount = parseInt(probResult.rows[0]?.cnt ?? '0', 10);
    if (probCount > 10) {
      updates.push({
        question_id: 'weighted_pipeline',
        answer: true,
        confidence: 0.85,
      });
    }
  } catch (err) {
    console.error('[CalibrationSeeder] scanCrmAnswers scan failed', { workspaceId, err });
    return;
  }

  for (const upd of updates) {
    try {
      await query(
        `UPDATE calibration_checklist
         SET answer = $1::jsonb,
             answer_source = 'CRM_SCAN',
             status = 'INFERRED',
             confidence = $2,
             updated_at = now()
         WHERE workspace_id = $3
           AND question_id = $4
           AND status = 'UNKNOWN'`,
        [JSON.stringify(upd.answer), upd.confidence, workspaceId, upd.question_id]
      );
    } catch (err) {
      console.error('[CalibrationSeeder] update failed', {
        question_id: upd.question_id,
        err,
      });
    }
  }
}
