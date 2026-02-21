// Report Templates API Routes

import { Router, Request, Response } from 'express';
import { query } from '../db.js';
import { requirePermission } from '../middleware/permissions.js';
import { ReportTemplate, ReportSection, GenerateReportRequest } from '../reports/types.js';
import { generateReport } from '../reports/generator.js';
import { SECTION_LIBRARY, createSectionFromDefinition } from '../reports/section-library.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('ReportsAPI');

// List all report templates for workspace
router.get('/:workspaceId/reports', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params;

    const result = await query<ReportTemplate>(
      `SELECT * FROM report_templates
       WHERE workspace_id = $1
       ORDER BY created_at DESC`,
      [workspaceId]
    );

    res.json({ reports: result.rows });
  } catch (err) {
    logger.error('Failed to list reports', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to list reports' });
  }
});

// Get single report template
router.get('/:workspaceId/reports/:reportId', async (req: Request, res: Response) => {
  try {
    const { workspaceId, reportId } = req.params;

    const result = await query<ReportTemplate>(
      `SELECT * FROM report_templates
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

// Create new report template
router.post('/:workspaceId/reports', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.params;
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
    const { workspaceId, reportId } = req.params;
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
    const { workspaceId, reportId } = req.params;

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
    const { preview = false } = req.body;

    logger.info('Manual report generation requested', { workspace_id: workspaceId, report_id: reportId, preview });

    const request: GenerateReportRequest = {
      workspace_id: workspaceId,
      report_template_id: reportId,
      triggered_by: 'manual',
      preview_only: preview,
    };

    const generation = await generateReport(request);

    res.json(generation);
  } catch (err) {
    logger.error('Report generation failed', err instanceof Error ? err : undefined);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Report generation failed' });
  }
});

// List report generations (history)
router.get('/:workspaceId/reports/:reportId/generations', async (req: Request, res: Response) => {
  try {
    const { workspaceId, reportId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    const result = await query(
      `SELECT * FROM report_generations
       WHERE report_template_id = $1 AND workspace_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [reportId, workspaceId, limit]
    );

    res.json({ generations: result.rows });
  } catch (err) {
    logger.error('Failed to list generations', err instanceof Error ? err : undefined);
    res.status(500).json({ error: 'Failed to list generations' });
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

export default router;
