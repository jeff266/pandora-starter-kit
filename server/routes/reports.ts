// Report Templates API Routes

import { Router, Request, Response } from 'express';
import { query } from '../db.js';
import { requirePermission } from '../middleware/permissions.js';
import { ReportTemplate, ReportSection, GenerateReportRequest } from '../reports/types.js';
import { generateReport } from '../reports/generator.js';
import { SECTION_LIBRARY, createSectionFromDefinition } from '../reports/section-library.js';
import { createLogger } from '../utils/logger.js';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
    // Accept preview flag from query param or request body
    const preview = req.query.preview === 'true' || req.body.preview === true;

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

// List report generations (history) - summary only
router.get('/:workspaceId/reports/:reportId/generations', async (req: Request, res: Response) => {
  try {
    const { workspaceId, reportId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
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
    const { workspaceId, reportId } = req.params;

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

// Compare two generations
router.get('/:workspaceId/reports/:reportId/compare', async (req: Request, res: Response) => {
  try {
    const { workspaceId, reportId } = req.params;
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
    const { workspaceId, reportId } = req.params;
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
