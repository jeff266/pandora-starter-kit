/**
 * Deliverables API Endpoints
 *
 * Provides endpoints for generating, previewing, and retrieving template-driven deliverables.
 */

import express from 'express';
import { generateDeliverable } from '../templates/deliverable-pipeline.js';
import { query } from '../db.js';

const router = express.Router({ mergeParams: true });

/**
 * POST /api/workspaces/:workspaceId/deliverables/generate
 *
 * Full pipeline: discovery → assembly → population
 * Generates a fully populated deliverable matrix.
 */
router.post('/deliverables/generate', async (req, res) => {
  const { workspaceId } = req.params;
  const { templateType, customDimensions, voiceConfig } = req.body;

  try {
    const result = await generateDeliverable({
      workspaceId,
      templateType,
      customDimensions,
      voiceConfig,
    });

    res.json({
      template_type: result.matrix.template_type,
      stages: result.matrix.stages.length,
      dimensions: result.matrix.rows.length,
      cells: result.matrix.cell_count,
      population: result.populationStats,
      timing: {
        discovery_ms: result.discovery_ms,
        assembly_ms: result.assembly_ms,
        population_ms: result.population_ms,
        total_ms: result.total_ms,
      },
      // Include the full matrix for the frontend or renderer
      matrix: result.matrix,
    });
  } catch (err) {
    console.error('[Deliverable] Generation failed:', err);
    res.status(500).json({
      error: 'Deliverable generation failed',
      details: (err as Error).message,
    });
  }
});

/**
 * POST /api/workspaces/:workspaceId/deliverables/preview
 *
 * Discovery + Assembly only, no synthesis.
 * Shows what the deliverable will look like without spending tokens on synthesis.
 */
router.post('/deliverables/preview', async (req, res) => {
  const { workspaceId } = req.params;
  const { templateType, customDimensions } = req.body;

  try {
    const result = await generateDeliverable({
      workspaceId,
      templateType,
      customDimensions,
      skipSynthesis: true,
    });

    res.json({
      template_type: result.matrix.template_type,
      stages: result.matrix.stages.map(s => s.stage_name),
      dimensions: result.matrix.rows.map(r => ({
        key: r.dimension_key,
        label: r.dimension_label,
        source_type: r.source_type,
      })),
      cell_budget: result.discovery.cell_budget,
      excluded_dimensions: result.discovery.excluded_dimensions,
      coverage: result.discovery.coverage,
      timing: {
        discovery_ms: result.discovery_ms,
        assembly_ms: result.assembly_ms,
      },
    });
  } catch (err) {
    console.error('[Deliverable] Preview failed:', err);
    res.status(500).json({
      error: 'Preview failed',
      details: (err as Error).message,
    });
  }
});

/**
 * GET /api/workspaces/:workspaceId/deliverables/latest
 *
 * Returns the most recent generated deliverable from cache
 * without regenerating.
 */
router.get('/deliverables/latest', async (req, res) => {
  const { workspaceId } = req.params;
  const { templateType = 'sales_process_map' } = req.query;

  try {
    const result = await query(`
      SELECT matrix, discovery, generated_at, total_tokens, cells_populated, cells_degraded
      FROM deliverable_results
      WHERE workspace_id = $1 AND template_type = $2
      ORDER BY generated_at DESC LIMIT 1
    `, [workspaceId, templateType]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'No deliverable found. Generate one first.',
      });
    }

    const row = result.rows[0];
    res.json({
      matrix: row.matrix,
      discovery: row.discovery,
      generated_at: row.generated_at,
      stats: {
        total_tokens: row.total_tokens,
        cells_populated: row.cells_populated,
        cells_degraded: row.cells_degraded,
      },
    });
  } catch (err) {
    console.error('[Deliverable] Retrieval failed:', err);
    res.status(500).json({
      error: 'Failed to retrieve deliverable',
      details: (err as Error).message,
    });
  }
});

export default router;
