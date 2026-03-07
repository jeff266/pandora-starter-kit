import express from 'express';
import { query } from '../db.js';
import { requireAdmin, requireWorkspaceAccess } from '../middleware/auth.js';
import { attachWorkspaceContext } from '../middleware/workspace-context.js';
import { configLoader } from '../config/workspace-config-loader.js';

const router = express.Router();

/**
 * GET /api/workspaces/:id/training-pairs/export
 * Admin only: Export training pairs for a workspace in JSONL format
 */
router.get('/:workspaceId/training-pairs/export', requireAdmin, async (req, res) => {
  const { workspaceId } = req.params;
  const { quality, min_edit_distance, format } = req.query;

  try {
    let queryText = 'SELECT system_prompt_at_time as prompt, corrected_output as completion, quality_label as quality, template_type, section_id FROM document_training_pairs WHERE workspace_id = $1';
    const params: any[] = [workspaceId];

    if (quality) {
      const qualities = (quality as string).split(',');
      queryText += ` AND quality_label = ANY($${params.length + 1}::text[])`;
      params.push(qualities);
    }

    if (min_edit_distance) {
      queryText += ` AND edit_distance >= $${params.length + 1}`;
      params.push(parseFloat(min_edit_distance as string));
    }

    const result = await query(queryText, params);

    if (format === 'jsonl' || !format) {
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Content-Disposition', `attachment; filename="training_pairs_${workspaceId}.jsonl"`);
      
      for (const row of result.rows) {
        res.write(JSON.stringify(row) + '\n');
      }
      res.end();
    } else {
      res.json(result.rows);
    }
  } catch (error) {
    console.error('Export training pairs error:', error);
    res.status(500).json({ error: 'Failed to export training pairs' });
  }
});

/**
 * GET /api/admin/training-pairs/export-all
 * Super-admin only: Export all training pairs across workspaces
 */
router.get('/admin/training-pairs/export-all', requireAdmin, async (req, res) => {
  const { quality, min_pairs_per_workspace } = req.query;

  try {
    let queryText = `
      const rows = SELECT system_prompt_at_time as prompt, corrected_output as completion, quality_label as quality, template_type, section_id 
      FROM document_training_pairs 
      WHERE 1=1
    `;
    const params: any[] = [];

    if (quality) {
      const qualities = (quality as string).split(',');
      queryText += ` AND quality_label = ANY($${params.length + 1}::text[])`;
      params.push(qualities);
    }

    // min_pairs_per_workspace logic would require a subquery or post-filtering
    // For simplicity, we filter in the query if requested
    if (min_pairs_per_workspace) {
      queryText += ` AND workspace_id IN (
        SELECT workspace_id FROM document_training_pairs GROUP BY workspace_id HAVING COUNT(*) >= $${params.length + 1}
      )`;
      params.push(parseInt(min_pairs_per_workspace as string));
    }

    const result = await query(queryText, params);

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Content-Disposition', 'attachment; filename="all_training_pairs.jsonl"');
    
    for (const row of result.rows) {
      res.write(JSON.stringify(row) + '\n');
    }
    res.end();
  } catch (error) {
    console.error('Export all training pairs error:', error);
    res.status(500).json({ error: 'Failed to export all training pairs' });
  }
});

/**
 * GET /api/workspaces/:id/document-quality
 * Aggregates document quality metrics
 */
router.get('/:workspaceId/document-quality', requireWorkspaceAccess, attachWorkspaceContext, async (req, res) => {
  const { workspaceId } = req.params;

  try {
    const profile = await configLoader.getDocumentProfile(workspaceId);
    
    // Aggregate from training_pairs
    const pairsResult = await query(`
      SELECT 
        COUNT(*) as total_pairs,
        AVG(edit_distance) as avg_edit_distance,
        COUNT(*) FILTER (WHERE quality_label = 'good') as good_pairs
      FROM document_training_pairs
      WHERE workspace_id = $1
    `, [workspaceId]);

    // Aggregate recent edits
    const recentEdits = await query(`
      SELECT 
        template_type,
        section_id,
        AVG(edit_distance) as avg_dist,
        COUNT(*) as count
      FROM document_edits
      WHERE workspace_id = $1
      GROUP BY template_type, section_id
      ORDER BY avg_dist DESC
      LIMIT 10
    `, [workspaceId]);

    // Aggregate distribution/engagement
    // In a real system we'd query document_distributions, but per spec we use profile data
    
    res.json({
      overallScore: profile.qualityScores.overall,
      trend: profile.qualityScores.trend,
      metrics: {
        editRate: profile.distributionPatterns.averageEditDistance,
        trainingPairCount: parseInt(String(pairsResult.rows[0].total_pairs || '0')),
        goodPairRatio: Number(pairsResult.rows[0].total_pairs) > 0 ? Number(pairsResult.rows[0].good_pairs) / Number(pairsResult.rows[0].total_pairs) : 0,
      },
      byTemplate: profile.distributionPatterns.slackEngagementByTemplate,
      mostEditedSections: recentEdits.rows.map(r => ({
        template: String(r.template_type),
        section: String(r.section_id),
        avgEditDistance: parseFloat(String(r.avg_dist)),
        editCount: parseInt(String(r.count))
      })),
      calibrationStatus: {
        completedAt: profile.calibration.completedAt,
        nextScheduledAt: profile.calibration.nextScheduledAt,
        completedSessions: profile.calibration.completedSessions
      }
    });
  } catch (error) {
    console.error('Get document quality error:', error);
    res.status(500).json({ error: 'Failed to fetch document quality' });
  }
});

export default router;
