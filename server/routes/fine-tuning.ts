import { Router } from 'express';
import { query } from '../db.js';
import { assembleDataset } from '../llm/dataset-assembler.js';
import { submitFineTuningJob, getDeployedFineTunedModel } from '../llm/fireworks-trainer.js';
import { evaluateFineTunedModel } from '../llm/model-evaluator.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/admin/fine-tuning/readiness
 * Counts document_training_pairs grouped by pair_type+quality_label+workspace_id
 */
router.get('/readiness', requireAdmin, async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        pair_type, 
        quality_label, 
        workspace_id,
        COUNT(*) as count
      FROM document_training_pairs
      GROUP BY pair_type, quality_label, workspace_id
    `);

    const rows = result.rows;
    const readiness: any = {
      document_synthesis: { totalPairs: 0, goodPairs: 0, readyToTrain: false, byWorkspace: [] },
      classification: { totalPairs: 0, goodPairs: 0, readyToTrain: false, byWorkspace: [] }
    };

    const workspaceMap: Record<string, any> = {};

    for (const row of rows) {
      const type = row.pair_type;
      const count = parseInt(row.count);
      if (!readiness[type]) continue;

      readiness[type].totalPairs += count;
      if (row.quality_label === 'good') {
        readiness[type].goodPairs += count;
      }

      if (!workspaceMap[row.workspace_id]) {
        workspaceMap[row.workspace_id] = { workspace_id: row.workspace_id, document_synthesis: 0, classification: 0 };
      }
      workspaceMap[row.workspace_id][type] += count;
    }

    readiness.document_synthesis.readyToTrain = readiness.document_synthesis.goodPairs >= 500;
    readiness.classification.readyToTrain = readiness.classification.goodPairs >= 200;
    
    readiness.document_synthesis.byWorkspace = Object.values(workspaceMap).map((w: any) => ({
      workspace_id: w.workspace_id,
      count: w.document_synthesis
    })).filter(w => w.count > 0);

    readiness.classification.byWorkspace = Object.values(workspaceMap).map((w: any) => ({
      workspace_id: w.workspace_id,
      count: w.classification
    })).filter(w => w.count > 0);

    res.json(readiness);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/fine-tuning/assemble-dataset
 * Calls assembleDataset, stats only for now (streaming to file would need more infra)
 */
router.post('/assemble-dataset', requireAdmin, async (req, res) => {
  try {
    const options = req.body;
    const result = await assembleDataset(options);
    res.json({
      stats: result.stats,
      message: "Dataset assembled successfully (stats only in this preview)"
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/fine-tuning/submit-job
 */
router.post('/submit-job', requireAdmin, async (req, res) => {
  try {
    const { purpose, options } = req.body;
    const dataset = await assembleDataset(options || {
      pairType: purpose,
      qualityFilter: ['good', 'needs_improvement'],
      trainSplitPct: 0.9,
      deduplicateThreshold: 0.95
    });

    const jobId = await submitFineTuningJob(purpose, dataset);
    res.json({ jobId, status: 'submitted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/fine-tuning/jobs
 */
router.get('/jobs', requireAdmin, async (req, res) => {
  try {
    const result = await query(`
      SELECT * FROM fine_tuning_jobs 
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/fine-tuning/jobs/:id
 */
router.get('/jobs/:id', requireAdmin, async (req, res) => {
  try {
    const result = await query('SELECT * FROM fine_tuning_jobs WHERE id = $1', [req.params.id as string]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/fine-tuning/jobs/:id/evaluate
 */
router.post('/jobs/:id/evaluate', requireAdmin, async (req, res) => {
  try {
    const jobResult = await query('SELECT * FROM fine_tuning_jobs WHERE id = $1', [req.params.id]);
    if (jobResult.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
    
    // We need the validation records. In a real system we might store them or re-assemble.
    // For now we re-assemble based on job config or defaults.
    const dataset = await assembleDataset({
      pairType: jobResult.rows[0].model_purpose,
      qualityFilter: ['good', 'needs_improvement'],
      trainSplitPct: 0.9,
      deduplicateThreshold: 0.95
    });

    const result = await evaluateFineTunedModel(req.params.id as string, dataset.val);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/fine-tuning/jobs/:id/deploy
 */
router.post('/jobs/:id/deploy', requireAdmin, async (req, res) => {
  try {
    await query(
      "UPDATE fine_tuning_jobs SET status = 'deployed', deployed_at = NOW() WHERE id = $1",
      [req.params.id]
    );
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/fine-tuning/jobs/:id/rollback
 */
router.post('/jobs/:id/rollback', requireAdmin, async (req, res) => {
  try {
    await query(
      "UPDATE fine_tuning_jobs SET status = 'superseded' WHERE id = $1",
      [req.params.id]
    );
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/fine-tuning/stats
 * Helper for dashboard cost impact and fallback rates
 */
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const fallbackStats = await query(`
      SELECT 
        capability,
        COUNT(*) as total_calls,
        SUM(CASE WHEN fell_back THEN 1 ELSE 0 END) as fallback_calls,
        AVG(confidence) as avg_confidence
      FROM llm_call_log
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY capability
    `);

    const costStats = await query(`
      SELECT 
        SUM(input_tokens) as total_input,
        SUM(output_tokens) as total_output,
        COUNT(*) as total_calls
      FROM llm_call_log
      WHERE created_at > NOW() - INTERVAL '30 days'
      AND model_used NOT LIKE '%claude%' -- Assuming fine-tuned models don't have claude in name
      AND fell_back = FALSE
    `);

    res.json({
      fallbacks: fallbackStats.rows,
      savings: costStats.rows[0]
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
