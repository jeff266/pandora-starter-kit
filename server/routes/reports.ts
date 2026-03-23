// Report Templates API Routes

import { Router, Request, Response } from 'express';
import { query } from '../db.js';
import { requirePermission } from '../middleware/permissions.js';
import { ReportTemplate, ReportSection, GenerateReportRequest } from '../reports/types.js';
import { generateReport } from '../reports/generator.js';
import { SECTION_LIBRARY, createSectionFromDefinition } from '../reports/section-library.js';
import { createLogger } from '../utils/logger.js';
import { renderDOCX } from '../renderers/docx-renderer.js';
import { renderReportPDF } from '../renderers/report-pdf-renderer.js';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { seedWbrQbrTemplates } from '../lib/seed-report-templates.js';

const router = Router();
const logger = createLogger('ReportsAPI');

// Helper to parse metric values like "$1.2M" -> 1200000
function parseMetricValue(value: string): number {
  const cleaned = value.replace(/[^0-9.KMB-]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;

  if (value.includes('K')) return num * 1000;
  if (value.includes('M')) return num * 1000000;
  if (value.includes('B')) return num * 1000000000;
  return num;
}

// List all report documents for workspace (Monday Briefings + agent runs)
router.get('/:workspaceId/reports', async (req: Request, res: Response) => {
  try {
    const workspaceId = String(req.params.workspaceId);
    const limit = Math.min(parseInt(String(req.query.limit)) || 20, 50);

    seedWbrQbrTemplates(workspaceId).catch(err =>
      logger.warn('WBR/QBR seed failed (non-fatal)', { error: err?.message })
    );

    const result = await query(
      `SELECT id, document_type, week_label, headline, generated_at,
              sections, actions, skills_included, agent_id, config
       FROM report_documents
       WHERE workspace_id = $1
       ORDER BY generated_at DESC
       LIMIT $2`,
      [workspaceId, limit]
    );

    res.json({ reports: result.rows });
  } catch (err) {
    logger.error('Failed to list reports', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to list reports' });
  }
});

// Get single report document (Monday Briefing or agent run)
router.get('/:workspaceId/reports/:reportId', async (req: Request, res: Response) => {
  try {
    const { workspaceId, reportId } = req.params as Record<string, string>;

    const result = await query(
      `SELECT id, document_type, week_label, headline, generated_at,
              sections, actions, recommended_next_steps, skills_included,
              tokens_used, agent_id, config
       FROM report_documents
       WHERE id = $1 AND workspace_id = $2`,
      [reportId, workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Failed to get report', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to get report' });
  }
});

// Living Document: Get TipTap content for a report document
router.get('/:workspaceId/report-documents/:documentId/content', async (req: Request, res: Response) => {
  try {
    const { workspaceId, documentId } = req.params as Record<string, string>;

    const result = await query(
      `SELECT tiptap_content FROM report_documents
       WHERE id = $1 AND workspace_id = $2`,
      [documentId, workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    res.json({ tiptap_content: result.rows[0].tiptap_content || {} });
  } catch (err) {
    logger.error('Failed to get tiptap content', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to get tiptap content' });
  }
});

// Living Document: Update TipTap content for a specific section (merge, not overwrite)
router.patch('/:workspaceId/report-documents/:documentId', async (req: Request, res: Response) => {
  try {
    const { workspaceId, documentId } = req.params as Record<string, string>;
    const { section_id, content } = req.body;

    if (!section_id || !content) {
      res.status(400).json({ error: 'section_id and content are required' });
      return;
    }

    // Use JSONB merge operator to update only the specified section_id
    // This preserves all other section contents
    const result = await query(
      `UPDATE report_documents
       SET tiptap_content = COALESCE(tiptap_content, '{}'::jsonb) || jsonb_build_object($3, $4)
       WHERE id = $1 AND workspace_id = $2
       RETURNING tiptap_content`,
      [documentId, workspaceId, section_id, JSON.stringify(content)]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    res.json({
      success: true,
      tiptap_content: result.rows[0].tiptap_content
    });
  } catch (err) {
    logger.error('Failed to update tiptap content', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to update tiptap content' });
  }
});

// Create chart in report document
router.post('/:workspaceId/reports/:reportDocumentId/charts', async (req: Request, res: Response) => {
  try {
    const { workspaceId, reportDocumentId } = req.params as Record<string, string>;
    const { chart_type, title, source_type, chart_spec } = req.body;

    if (!chart_spec) {
      res.status(400).json({ error: 'chart_spec is required' });
      return;
    }

    const result = await query(
      `INSERT INTO report_charts (
        report_document_id, chart_type, title, source_type, chart_spec, created_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING id, chart_type, title, chart_spec`,
      [reportDocumentId, chart_type, title || 'Untitled Chart', source_type || 'query', JSON.stringify(chart_spec)]
    );

    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Failed to create chart', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to create chart' });
  }
});

// Create new report template
router.post('/:workspaceId/reports', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params as Record<string, string>;
    const {
      name,
      description,
      sections = [],
      cadence = 'manual',
      schedule_day,
      schedule_time = '07:00',
      schedule_day_of_month,
      timezone = 'America/Los_Angeles',
      formats = ['pdf'],
      delivery_channels = [],
      recipients = [],
      branding_override,
      voice_config = { detail_level: 'manager', framing: 'direct' },
      created_from_template,
    } = req.body;

    if (!name || name.trim().length === 0) {
      res.status(400).json({ error: 'Report name is required' });
      return;
    }

    const result = await query<ReportTemplate>(
      `INSERT INTO report_templates (
        workspace_id, name, description, sections, cadence, schedule_day,
        schedule_time, schedule_day_of_month, timezone, formats, delivery_channels,
        recipients, branding_override, voice_config, created_from_template
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *`,
      [
        workspaceId,
        name,
        description || null,
        JSON.stringify(sections),
        cadence,
        schedule_day || null,
        schedule_time,
        schedule_day_of_month || null,
        timezone,
        JSON.stringify(formats),
        JSON.stringify(delivery_channels),
        JSON.stringify(recipients),
        branding_override ? JSON.stringify(branding_override) : null,
        JSON.stringify(voice_config),
        created_from_template || null,
      ]
    );

    logger.info('Report template created', { report_id: result.rows[0].id, name });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error('Failed to create report', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to create report' });
  }
});

// Update report template
router.put('/:workspaceId/reports/:reportId', async (req: Request, res: Response) => {
  try {
    const { workspaceId, reportId } = req.params as Record<string, string>;
    const {
      name,
      description,
      sections,
      cadence,
      schedule_day,
      schedule_time,
      schedule_day_of_month,
      timezone,
      formats,
      delivery_channels,
      recipients,
      branding_override,
      voice_config,
      is_active,
    } = req.body;

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description);
    }
    if (sections !== undefined) {
      updates.push(`sections = $${paramCount++}`);
      values.push(JSON.stringify(sections));
    }
    if (cadence !== undefined) {
      updates.push(`cadence = $${paramCount++}`);
      values.push(cadence);
    }
    if (schedule_day !== undefined) {
      updates.push(`schedule_day = $${paramCount++}`);
      values.push(schedule_day);
    }
    if (schedule_time !== undefined) {
      updates.push(`schedule_time = $${paramCount++}`);
      values.push(schedule_time);
    }
    if (schedule_day_of_month !== undefined) {
      updates.push(`schedule_day_of_month = $${paramCount++}`);
      values.push(schedule_day_of_month);
    }
    if (timezone !== undefined) {
      updates.push(`timezone = $${paramCount++}`);
      values.push(timezone);
    }
    if (formats !== undefined) {
      updates.push(`formats = $${paramCount++}`);
      values.push(JSON.stringify(formats));
    }
    if (delivery_channels !== undefined) {
      updates.push(`delivery_channels = $${paramCount++}`);
      values.push(JSON.stringify(delivery_channels));
    }
    if (recipients !== undefined) {
      updates.push(`recipients = $${paramCount++}`);
      values.push(JSON.stringify(recipients));
    }
    if (branding_override !== undefined) {
      updates.push(`branding_override = $${paramCount++}`);
      values.push(branding_override ? JSON.stringify(branding_override) : null);
    }
    if (voice_config !== undefined) {
      updates.push(`voice_config = $${paramCount++}`);
      values.push(JSON.stringify(voice_config));
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramCount++}`);
      values.push(is_active);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push(`updated_at = NOW()`);
    values.push(reportId, workspaceId);

    const result = await query<ReportTemplate>(
      `UPDATE report_templates
       SET ${updates.join(', ')}
       WHERE id = $${paramCount} AND workspace_id = $${paramCount + 1}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    logger.info('Report template updated', { report_id: reportId });
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Failed to update report', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to update report' });
  }
});

// Delete report template
router.delete('/:workspaceId/reports/:reportId', async (req: Request, res: Response) => {
  try {
    const { workspaceId, reportId } = req.params as Record<string, string>;

    const result = await query(
      `DELETE FROM report_templates
       WHERE id = $1 AND workspace_id = $2
       RETURNING id`,
      [reportId, workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    logger.info('Report template deleted', { report_id: reportId });
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to delete report', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to delete report' });
  }
});

// Manual generate report
router.post('/:workspaceId/reports/:reportId/generate', async (req: Request, res: Response) => {
  try {
    const { workspaceId, reportId } = req.params as { workspaceId: string; reportId: string };
    const preview = req.query.preview === 'true' || req.body.preview === true;
    const periodLabel: string | undefined = req.body.period_label;
    const docType: string | undefined = req.body.document_type;

    logger.info('Manual report generation requested', { workspace_id: workspaceId, report_id: reportId, preview, docType, periodLabel });

    const request: GenerateReportRequest = {
      workspace_id: workspaceId,
      report_template_id: reportId,
      triggered_by: 'manual',
      preview_only: preview,
      period_label: periodLabel,
      document_type: docType,
    };

    const generation = await generateReport(request);

    // document_id is set by generator.ts for WBR/QBR when preview_only is false
    res.json({ ...generation, document_id: generation.document_id });
  } catch (err) {
    logger.error('Report generation failed', err instanceof Error ? err : undefined);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Report generation failed' });
  }
});

// List report generations (history) - summary only
router.get('/:workspaceId/reports/:reportId/generations', async (req: Request, res: Response) => {
  try {
    const { workspaceId, reportId } = req.params;
    const limit = Math.min(parseInt(String(req.query.limit)) || 20, 100);
    const before = req.query.before as string;

    let sql = `SELECT
        id, created_at, triggered_by,
        delivery_status, formats_generated,
        generation_duration_ms, render_duration_ms,
        skills_run, data_as_of, error_message
       FROM report_generations
       WHERE report_template_id = $1 AND workspace_id = $2`;

    const params: any[] = [reportId, workspaceId];

    if (before) {
      sql += ` AND created_at < $3`;
      params.push(before);
    }

    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await query(sql, params);

    res.json({ generations: result.rows });
  } catch (err) {
    logger.error('Failed to list generations', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to list generations' });
  }
});

// Get latest generation with full content
router.get('/:workspaceId/reports/:reportId/generations/latest', async (req: Request, res: Response) => {
  try {
    const { workspaceId, reportId } = req.params as Record<string, string>;

    const result = await query(
      `SELECT * FROM report_generations
       WHERE report_template_id = $1 AND workspace_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [reportId, workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'No generations found for this report' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Failed to get latest generation', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to get latest generation' });
  }
});

// Get specific generation with full content
router.get('/:workspaceId/reports/:reportId/generations/:generationId', async (req: Request, res: Response) => {
  try {
    const { workspaceId, reportId, generationId } = req.params;

    const result = await query(
      `SELECT * FROM report_generations
       WHERE id = $1 AND report_template_id = $2 AND workspace_id = $3`,
      [generationId, reportId, workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Generation not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Failed to get generation', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to get generation' });
  }
});

router.get('/:workspaceId/generations/:generationId', async (req: Request, res: Response) => {
  try {
    const { workspaceId, generationId } = req.params;

    const result = await query(
      `SELECT rg.*,
              a.name as agent_name
       FROM report_generations rg
       LEFT JOIN agents a ON a.id = rg.agent_id
       WHERE rg.id = $1 AND rg.workspace_id = $2`,
      [generationId, workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Generation not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Failed to get generation by ID', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to get generation' });
  }
});

router.get('/:workspaceId/generations-by-agent/:agentId', async (req: Request, res: Response) => {
  try {
    const { workspaceId, agentId } = req.params;
    const limit = Math.min(parseInt(String(req.query.limit)) || 20, 50);

    const result = await query(
      `SELECT id, created_at, triggered_by, generation_duration_ms, total_tokens, opening_narrative,
              version, parent_generation_id, annotated_by, annotated_at
       FROM report_generations
       WHERE agent_id = $1 AND workspace_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [agentId, workspaceId, limit]
    );

    res.json({ generations: result.rows });
  } catch (err) {
    logger.error('Failed to list agent generations', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to list generations' });
  }
});

// Save annotated V2 generation
router.post('/:workspaceId/reports/:reportId/generations', async (req: Request, res: Response) => {
  try {
    const { workspaceId, reportId } = req.params as Record<string, string>;
    const { parent_generation_id, human_annotations, sections_content, annotated_by } = req.body as {
      parent_generation_id: string;
      human_annotations: any[];
      sections_content: any[];
      annotated_by?: string;
    };

    if (!parent_generation_id) {
      res.status(400).json({ error: 'parent_generation_id is required' });
      return;
    }

    // Fetch parent to copy its metadata and compute next version
    const parentResult = await query(
      `SELECT * FROM report_generations WHERE id = $1 AND workspace_id = $2`,
      [parent_generation_id, workspaceId]
    );
    if (parentResult.rows.length === 0) {
      res.status(404).json({ error: 'Parent generation not found' });
      return;
    }
    const parent = parentResult.rows[0];
    const nextVersion = (parent.version || 1) + 1;

    // Insert V2 generation
    const insertResult = await query(
      `INSERT INTO report_generations
         (workspace_id, report_template_id, agent_id, sections_content, opening_narrative,
          editorial_decisions, run_digest, skills_run, total_tokens, triggered_by,
          version, parent_generation_id, human_annotations, annotated_by, annotated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual',
               $10, $11, $12, $13, NOW())
       RETURNING id, created_at, version`,
      [
        workspaceId,
        reportId || parent.report_template_id,
        parent.agent_id,
        JSON.stringify(sections_content || parent.sections_content),
        parent.opening_narrative,
        parent.editorial_decisions,
        parent.run_digest,
        parent.skills_run,
        parent.total_tokens,
        nextVersion,
        parent_generation_id,
        JSON.stringify(human_annotations || []),
        annotated_by || null,
      ]
    );

    const newGeneration = insertResult.rows[0];

    // Write feedback signals to agent_feedback for 'override' and 'strike' annotations
    if (parent.agent_id && Array.isArray(human_annotations)) {
      for (const annotation of human_annotations) {
        if (annotation.type === 'override' && annotation.new_value) {
          await query(
            `INSERT INTO agent_feedback
               (workspace_id, agent_id, generation_id, feedback_type, section_id, signal, comment, processed)
             VALUES ($1, $2, $3, 'section', $4, 'wrong_data', $5, false)`,
            [
              workspaceId,
              parent.agent_id,
              newGeneration.id,
              annotation.block_id,
              `Changed: "${annotation.original_value}" → "${annotation.new_value}"`,
            ]
          ).catch(() => {});
        } else if (annotation.type === 'strike') {
          await query(
            `INSERT INTO agent_feedback
               (workspace_id, agent_id, generation_id, feedback_type, section_id, signal, comment, processed)
             VALUES ($1, $2, $3, 'section', $4, 'not_useful', $5, false)`,
            [
              workspaceId,
              parent.agent_id,
              newGeneration.id,
              annotation.block_id,
              `Struck out: "${annotation.original_value}"`,
            ]
          ).catch(() => {});
        }
      }
    }

    // Write training pairs to agent_tuning_pairs for override annotations only.
    // Strikes without a replacement value are not yet a training pair.
    if (Array.isArray(human_annotations)) {
      // Fallback: skills_run on the generation when section lookup fails
      const skillsRunFallback: string[] = Array.isArray(parent.skills_run)
        ? parent.skills_run
        : typeof parent.skills_run === 'string'
          ? (() => { try { return JSON.parse(parent.skills_run); } catch { return []; } })()
          : [];

      // Normalise sections_content to an array for per-block section lookup
      const sectionsContent: Array<{ section_id?: string; source_skills?: string[] }> =
        Array.isArray(parent.sections_content)
          ? parent.sections_content
          : typeof parent.sections_content === 'string'
            ? (() => { try { return JSON.parse(parent.sections_content); } catch { return []; } })()
            : [];

      for (const annotation of human_annotations) {
        if (annotation.type === 'override' && annotation.new_value) {
          // block_id format: "{section_id}:{type}:{index}" — parse section_id from prefix
          const sectionId = annotation.block_id?.split(':')[0] ?? '';
          const section = sectionsContent.find(s => s.section_id === sectionId);
          const skillId: string | null =
            section?.source_skills?.[0] ?? skillsRunFallback[0] ?? null;

          // Classify the skill so dataset assemblers can explicitly handle custom corrections
          let skillSource: 'built_in' | 'custom' | 'unknown' = 'unknown';
          if (skillId) {
            try {
              const customCheck = await query(
                `SELECT 1 FROM custom_skills WHERE skill_id = $1 LIMIT 1`,
                [skillId]
              );
              if (customCheck.rows.length > 0) {
                skillSource = 'custom';
                logger.info('[TuningPairs] Custom skill annotation stored — pair preserved', {
                  skill_id: skillId,
                  block_id: annotation.block_id,
                  generation_id: newGeneration.id,
                });
              } else {
                skillSource = 'built_in';
              }
            } catch {
              skillSource = 'unknown';
            }
          }

          await query(
            `INSERT INTO agent_tuning_pairs
               (workspace_id, agent_id, generation_id, skill_id, skill_source, source, block_id, input_context, preferred_output)
             VALUES ($1, $2, $3, $4, $5, 'report_annotation', $6, $7, $8)`,
            [
              workspaceId,
              parent.agent_id || null,
              newGeneration.id,
              skillId,
              skillSource,
              annotation.block_id || null,
              String(annotation.original_value ?? ''),
              String(annotation.new_value),
            ]
          ).catch(() => {});
        }
      }
    }

    logger.info(`Saved V${nextVersion} report generation`, { newId: newGeneration.id, parentId: parent_generation_id });
    res.json({ generation: newGeneration });
  } catch (err) {
    logger.error('Failed to save V2 generation', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to save annotated generation' });
  }
});

// Compare two generations
router.get('/:workspaceId/reports/:reportId/compare', async (req: Request, res: Response) => {
  try {
    const { workspaceId, reportId } = req.params as Record<string, string>;
    const { left, right } = req.query;

    if (!left || !right) {
      res.status(400).json({ error: 'Missing left or right generation ID' });
      return;
    }

    const result = await query(
      `SELECT * FROM report_generations
       WHERE id = ANY($1) AND report_template_id = $2 AND workspace_id = $3
       ORDER BY created_at ASC`,
      [[left, right], reportId, workspaceId]
    );

    if (result.rows.length !== 2) {
      res.status(404).json({ error: 'One or both generations not found' });
      return;
    }

    res.json({
      left: result.rows[0],
      right: result.rows[1],
    });
  } catch (err) {
    logger.error('Failed to compare generations', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to compare generations' });
  }
});

// Get metric trends across generations
router.get('/:workspaceId/reports/:reportId/trends', async (req: Request, res: Response) => {
  try {
    const { workspaceId, reportId } = req.params as Record<string, string>;
    const metric = req.query.metric as string;
    const periods = Math.min(parseInt(req.query.periods as string) || 8, 52);

    if (!metric) {
      res.status(400).json({ error: 'Missing metric parameter' });
      return;
    }

    const result = await query(
      `SELECT id, created_at, sections_content
       FROM report_generations
       WHERE report_template_id = $1 AND workspace_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [reportId, workspaceId, periods]
    );

    // Extract metric value from each generation's sections_content
    const dataPoints = result.rows
      .map((gen: any) => {
        const sections = gen.sections_content || [];
        for (const section of sections) {
          if (section.metrics) {
            const metricCard = section.metrics.find((m: any) =>
              m.label.toLowerCase().includes(metric.toLowerCase())
            );
            if (metricCard) {
              // Parse value (e.g., "$1.2M" -> 1200000)
              const numericValue = parseMetricValue(metricCard.value);
              return {
                date: gen.created_at,
                value: numericValue,
                label: metricCard.value,
              };
            }
          }
        }
        return null;
      })
      .filter(Boolean)
      .reverse(); // Oldest first for chart rendering

    res.json({
      metric,
      data_points: dataPoints,
    });
  } catch (err) {
    logger.error('Failed to get trends', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to get trends' });
  }
});

// Get section library
router.get('/:workspaceId/report-sections', async (_req: Request, res: Response) => {
  try {
    res.json({ sections: SECTION_LIBRARY });
  } catch (err) {
    logger.error('Failed to get section library', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to get section library' });
  }
});

// List report templates for a workspace (summary — for generation modal template lookup)
router.get('/:workspaceId/report-templates', async (req: Request, res: Response) => {
  try {
    const workspaceId = String(req.params.workspaceId);
    // Ensure WBR/QBR templates are seeded before returning results
    await seedWbrQbrTemplates(workspaceId);
    const result = await query(
      `SELECT id, name, description, cadence, created_from_template, is_active, sections, created_at
       FROM report_templates
       WHERE workspace_id = $1
       ORDER BY created_at ASC`,
      [workspaceId]
    );
    res.json({ templates: result.rows });
  } catch (err) {
    logger.error('Failed to list report templates', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to list report templates' });
  }
});

// On-demand annotated export — re-renders a V2 generation with annotations applied
router.get('/:workspaceId/reports/:reportId/generations/:generationId/export/:format', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const reportId = req.params.reportId as string;
    const generationId = req.params.generationId as string;
    const format = req.params.format as string;

    if (!['pdf', 'docx'].includes(format)) {
      res.status(400).json({ error: 'Supported formats: pdf, docx' });
      return;
    }

    // Load generation
    const genResult = await query(
      `SELECT rg.*, rt.name as template_name, rt.description as template_description,
              w.branding
       FROM report_generations rg
       LEFT JOIN report_templates rt ON rt.id = rg.report_template_id
       LEFT JOIN workspaces w ON w.id = rg.workspace_id
       WHERE rg.id = $1 AND rg.workspace_id = $2`,
      [generationId, workspaceId]
    );

    if (genResult.rows.length === 0) {
      res.status(404).json({ error: 'Generation not found' });
      return;
    }

    const gen = genResult.rows[0];
    const templateName = (gen.template_name || gen.agent_name || 'Report') as string;

    const context = {
      workspace_id: workspaceId,
      template: {
        id: reportId,
        name: templateName,
        description: (gen.template_description || '') as string,
      } as any,
      sections_content: gen.sections_content || [],
      branding: gen.branding || {},
      triggered_by: 'manual' as const,
      preview_only: false,
      human_annotations: gen.human_annotations || [],
      annotated_at: gen.annotated_at as string | undefined,
      annotated_by: gen.annotated_by as string | undefined,
      version: (gen.version || 1) as number,
    };

    let filepath: string;
    let mimeType: string;
    let filename: string;

    if (format === 'docx') {
      const result = await renderDOCX(context);
      filepath = result.filepath;
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      filename = path.basename(result.filepath);
    } else {
      const result = await renderReportPDF(context);
      filepath = result.filepath;
      mimeType = 'application/pdf';
      filename = path.basename(result.filepath);
    }

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    const stream = fs.createReadStream(filepath);
    stream.pipe(res);
    stream.on('error', (err) => {
      logger.error('Export stream error', err);
      if (!res.headersSent) res.status(500).json({ error: 'Export failed' });
    });
  } catch (err) {
    logger.error('Annotated export failed', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Export failed' });
  }
});

// Download generated report file (with workspace ownership validation)
router.get('/:workspaceId/reports/:reportId/download/:format', async (req: Request, res: Response) => {
  try {
    const { workspaceId, reportId, format } = req.params;
    const filename = req.query.file as string;

    if (!filename) {
      res.status(400).json({ error: 'Missing file parameter' });
      return;
    }

    const sanitized = path.basename(filename);

    const ownershipCheck = await query(
      `SELECT id FROM report_generations
       WHERE report_template_id = $1
         AND workspace_id = $2
         AND formats_generated->$3->>'filepath' LIKE '%/' || $4
       LIMIT 1`,
      [reportId, workspaceId, format, sanitized]
    );

    if (ownershipCheck.rows.length === 0) {
      res.status(403).json({ error: 'Access denied — this file does not belong to your workspace' });
      return;
    }

    const outDir = path.join(os.tmpdir(), 'pandora-reports');
    const filepath = path.join(outDir, sanitized);

    if (!fs.existsSync(filepath)) {
      res.status(404).json({ error: 'Report file not found. It may have expired — regenerate the report.' });
      return;
    }

    const mimeTypes: Record<string, string> = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };

    const mimeType = mimeTypes[format as string] || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${sanitized}"`);
    res.setHeader('Cache-Control', 'no-cache');

    const stream = fs.createReadStream(filepath);
    stream.pipe(res);

    stream.on('error', (err) => {
      logger.error('File stream error', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream file' });
      }
    });
  } catch (err) {
    logger.error('Failed to download report', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to download report' });
  }
});

// Create share link for a generation
router.post('/:workspaceId/reports/:reportId/generations/:generationId/share', async (req: Request, res: Response) => {
  try {
    const { workspaceId, reportId, generationId } = req.params;
    const {
      access = 'public',
      expires_in,
      allowed_emails = [],
      include_download = true,
      password,
    } = req.body;

    // Verify generation exists and belongs to workspace
    const genCheck = await query(
      `SELECT id FROM report_generations
       WHERE id = $1 AND report_template_id = $2 AND workspace_id = $3`,
      [generationId, reportId, workspaceId]
    );

    if (genCheck.rows.length === 0) {
      res.status(404).json({ error: 'Generation not found' });
      return;
    }

    // Generate random share token
    const shareToken = crypto.randomBytes(16).toString('hex');

    // Calculate expiry
    let expiresAt = null;
    if (expires_in) {
      const duration = parseDuration(expires_in); // e.g., "7d" -> 7 days in ms
      expiresAt = new Date(Date.now() + duration);
    }

    // Hash password if provided
    let passwordHash = null;
    if (password) {
      passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    }

    const result = await query(
      `INSERT INTO report_share_links (
        report_template_id, generation_id, workspace_id,
        share_token, access_type, allowed_emails, password_hash,
        include_download, expires_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        reportId,
        generationId,
        workspaceId,
        shareToken,
        access,
        JSON.stringify(allowed_emails),
        passwordHash,
        include_download,
        expiresAt,
        null, // TODO: Add user_id from auth middleware
      ]
    );

    const shareUrl = `${process.env.APP_URL || 'http://localhost:3000'}/shared/${shareToken}`;

    res.json({
      share_url: shareUrl,
      share_token: shareToken,
      expires_at: expiresAt,
      access_type: access,
    });
  } catch (err) {
    logger.error('Failed to create share link', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to create share link' });
  }
});

// Access shared report (public route - no workspace auth required)
router.get('/shared/:shareToken', async (req: Request, res: Response) => {
  try {
    const { shareToken } = req.params;
    const { password } = req.query;

    // Find share link
    const linkResult = await query(
      `SELECT * FROM report_share_links WHERE share_token = $1`,
      [shareToken]
    );

    if (linkResult.rows.length === 0) {
      res.status(404).json({ error: 'Share link not found' });
      return;
    }

    const shareLink = linkResult.rows[0];

    // Check expiry
    if (shareLink.expires_at && new Date(shareLink.expires_at) < new Date()) {
      res.status(410).json({ error: 'This share link has expired' });
      return;
    }

    // Check password
    if (shareLink.password_hash) {
      if (!password) {
        res.status(401).json({ error: 'Password required', requires_password: true });
        return;
      }
      const providedHash = crypto.createHash('sha256').update(password as string).digest('hex');
      if (providedHash !== shareLink.password_hash) {
        res.status(401).json({ error: 'Incorrect password' });
        return;
      }
    }

    // Update access tracking
    await query(
      `UPDATE report_share_links
       SET last_accessed_at = NOW(), access_count = access_count + 1
       WHERE id = $1`,
      [shareLink.id]
    );

    // Fetch generation
    const genResult = await query(
      `SELECT * FROM report_generations WHERE id = $1`,
      [shareLink.generation_id]
    );

    if (genResult.rows.length === 0) {
      res.status(404).json({ error: 'Report generation not found' });
      return;
    }

    // Fetch template
    const templateResult = await query(
      `SELECT id, name, description FROM report_templates WHERE id = $1`,
      [shareLink.report_template_id]
    );

    res.json({
      generation: genResult.rows[0],
      template: templateResult.rows[0],
      share_config: {
        include_download: shareLink.include_download,
        access_type: shareLink.access_type,
      },
    });
  } catch (err) {
    logger.error('Failed to access shared report', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to access shared report' });
  }
});

// Delete share link
router.delete('/:workspaceId/reports/:reportId/shares/:shareId', async (req: Request, res: Response) => {
  try {
    const { workspaceId, reportId, shareId } = req.params;

    const result = await query(
      `DELETE FROM report_share_links
       WHERE id = $1 AND report_template_id = $2 AND workspace_id = $3
       RETURNING id`,
      [shareId, reportId, workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Share link not found' });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to delete share link', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to delete share link' });
  }
});

// Helper to parse duration strings like "7d", "2w", "1m"
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([dhwm])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7 days

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 'd': return value * 24 * 60 * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'w': return value * 7 * 24 * 60 * 60 * 1000;
    case 'm': return value * 30 * 24 * 60 * 60 * 1000;
    default: return 7 * 24 * 60 * 60 * 1000;
  }
}

// GET /api/workspaces/:workspaceId/reports/documents/:documentId/evidence
// Query params: section_id, claim_id
// Returns evaluated_records filtered to the claim's entity_ids
router.get('/:workspaceId/reports/documents/:documentId/evidence', async (req: Request, res: Response) => {
  try {
    const { workspaceId, documentId } = req.params as Record<string, string>;
    const { section_id, claim_id } = req.query as { section_id?: string; claim_id?: string };

    if (!section_id || !claim_id) {
      return res.status(400).json({ error: 'section_id and claim_id are required' });
    }

    const docResult = await query(
      `SELECT sections, generated_at FROM report_documents WHERE id = $1 AND workspace_id = $2`,
      [documentId, workspaceId]
    );
    if (!docResult.rows.length) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const sections: any[] = docResult.rows[0].sections ?? [];
    const generatedAt: string = docResult.rows[0].generated_at;

    const section = sections.find((s: any) => s.section_id === section_id);
    if (!section) {
      return res.status(404).json({ error: 'Section not found' });
    }

    let foundClaim: any = null;
    let foundRecords: any[] = [];

    // Path 1: use stored skill_run_ids (new docs)
    const skillRunIds: Record<string, string> = section.skill_run_ids ?? {};
    for (const [, runId] of Object.entries(skillRunIds)) {
      const run = await query(
        `SELECT output->'evidence'->'claims' as claims,
                output->'evidence'->'evaluated_records' as records
         FROM skill_runs WHERE id = $1 AND workspace_id = $2`,
        [runId, workspaceId]
      );
      if (!run.rows.length) continue;

      const claims: any[] = run.rows[0].claims ?? [];
      const records: any[] = run.rows[0].records ?? [];
      const claim = claims.find((c: any) => c.claim_id === claim_id);
      if (!claim) continue;

      foundClaim = claim;
      foundRecords = records;
      break;
    }

    // Path 2: timestamp-based fallback (legacy docs without skill_run_ids)
    if (!foundClaim) {
      const sourceSkills: string[] = section.source_skills ?? [];
      for (const skillId of sourceSkills) {
        const run = await query(
          `SELECT output->'evidence'->'claims' as claims,
                  output->'evidence'->'evaluated_records' as records
           FROM skill_runs
           WHERE workspace_id = $1
             AND skill_id = $2
             AND status = 'completed'
             AND created_at <= $3
             AND created_at > $3::timestamptz - INTERVAL '24 hours'
           ORDER BY created_at DESC LIMIT 1`,
          [workspaceId, skillId, generatedAt]
        );
        if (!run.rows.length) continue;

        const claims: any[] = run.rows[0].claims ?? [];
        const records: any[] = run.rows[0].records ?? [];
        const claim = claims.find((c: any) => c.claim_id === claim_id);
        if (!claim) continue;

        foundClaim = claim;
        foundRecords = records;
        break;
      }
    }

    if (!foundClaim) {
      return res.status(404).json({ error: 'Claim not found', claim_id });
    }

    const entityIds = new Set<string>(foundClaim.entity_ids ?? []);
    const matchedRecords: any[] = entityIds.size > 0
      ? foundRecords.filter((r: any) => entityIds.has(r.entity_id))
      : [];

    return res.json({
      claim: {
        claim_id: foundClaim.claim_id,
        claim_text: foundClaim.claim_text,
        severity: foundClaim.severity,
        metric_name: foundClaim.metric_name,
        threshold_applied: foundClaim.threshold_applied,
        entity_count: matchedRecords.length,
      },
      records: matchedRecords.slice(0, 50),
      total: matchedRecords.length,
      truncated: matchedRecords.length > 50,
    });
  } catch (err) {
    logger.error('Evidence lookup failed', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to load evidence' });
  }
});

const REPORT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function cleanupReportFiles() {
  const outDir = path.join(os.tmpdir(), 'pandora-reports');
  if (!fs.existsSync(outDir)) return;

  const now = Date.now();
  let cleaned = 0;

  try {
    const files = fs.readdirSync(outDir);
    for (const file of files) {
      const filepath = path.join(outDir, file);
      try {
        const stat = fs.statSync(filepath);
        if (now - stat.mtimeMs > REPORT_TTL_MS) {
          fs.unlinkSync(filepath);
          cleaned++;
        }
      } catch {
        // skip files that can't be stat'd
      }
    }
    if (cleaned > 0) {
      logger.info(`Report TTL cleanup: removed ${cleaned} expired file(s)`);
    }
  } catch (err) {
    logger.error('Report TTL cleanup failed', err instanceof Error ? err : undefined);
  }
}

export default router;
