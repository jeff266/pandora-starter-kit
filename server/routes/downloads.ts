/**
 * Downloads API Endpoints
 *
 * Serves rendered files to users. Manages temp file lifecycle.
 */

import { Router } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { renderDeliverable, renderMultiple } from '../renderers/registry.js';
import { query } from '../db.js';
import type { RendererInput, RenderOptions, BrandingConfig } from '../renderers/types.js';
import { assemblePipelineReview, assembleForecast } from '../renderers/data-assembler.js';
import { renderPipelineReviewXLSX } from '../renderers/pipeline-review-xlsx.js';
import { renderForecastXLSX } from '../renderers/forecast-xlsx.js';
import { renderPipelineReviewPDF } from '../renderers/pipeline-review-pdf.js';
import { renderForecastPDF } from '../renderers/forecast-pdf.js';

const router = Router({ mergeParams: true });

// Download storage (in-memory for v1, could move to Redis/DB for multi-instance)
const downloadStore = new Map<string, {
  filepath: string;
  filename: string;
  format: string;
  createdAt: number;
}>();

/**
 * POST /api/workspaces/:workspaceId/render
 *
 * Body: { format: 'xlsx' | 'pdf' | 'pptx', source: 'latest_agent_run' | 'latest_deliverable' | run_id, options?: RenderOptions }
 * Renders the specified output and returns download URL
 */
router.post('/render', requirePermission('data.export'), async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { format, source, options, document_type } = req.body;

    if (!format) {
      return res.status(400).json({ error: 'format is required' });
    }

    // ── Direct-DB render path for pipeline_review / forecast ──
    if (document_type === 'pipeline_review' || document_type === 'forecast') {
      // Load branding from workspace
      const wsResult = await query(
        'SELECT branding FROM workspaces WHERE id = $1',
        [workspaceId]
      );
      const branding: BrandingConfig | undefined = wsResult.rows[0]?.branding ?? undefined;

      let result: { buffer: Buffer; filename: string };

      if (document_type === 'pipeline_review') {
        const data = await assemblePipelineReview(workspaceId, {
          period_days: options?.period_days ?? 7,
        });
        if (format === 'pdf') {
          result = await renderPipelineReviewPDF(data, branding);
        } else {
          result = await renderPipelineReviewXLSX(data, branding);
        }
      } else {
        const data = await assembleForecast(workspaceId, {
          quarter: options?.quarter,
        });
        if (format === 'pdf') {
          result = await renderForecastPDF(data, branding);
        } else {
          result = await renderForecastXLSX(data, branding);
        }
      }

      // Write buffer to temp file
      const filepath = path.join(os.tmpdir(), result.filename);
      fs.writeFileSync(filepath, result.buffer);

      const downloadId = generateDownloadId();
      await storeDownloadReference(downloadId, filepath, result.filename, format);

      return res.json({
        download_url: `/api/downloads/${downloadId}`,
        filename: result.filename,
        format,
        metadata: {},
      });
    }

    // ── Template-driven render path (existing) ────────────────
    const input = await assembleRendererInput(workspaceId, source, options);

    // Render
    const output = await renderDeliverable(format, input);

    if (!output.filepath || !output.filename) {
      return res.status(500).json({ error: 'Renderer did not produce a file' });
    }

    // Store reference for download
    const downloadId = generateDownloadId();
    await storeDownloadReference(downloadId, output.filepath, output.filename, format);

    res.json({
      download_url: `/api/downloads/${downloadId}`,
      filename: output.filename,
      format,
      metadata: output.metadata,
    });
  } catch (err) {
    console.error('[Render]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/workspaces/:workspaceId/render-multiple
 *
 * Body: { formats: ['xlsx', 'pdf'], source, options }
 * Renders in multiple formats simultaneously
 */
router.post('/render-multiple', requirePermission('data.export'), async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { formats, source, options } = req.body;

    if (!formats || !Array.isArray(formats) || formats.length === 0) {
      return res.status(400).json({ error: 'formats array is required' });
    }

    const input = await assembleRendererInput(workspaceId, source, options);
    const outputs = await renderMultiple(formats, input);

    const downloads = await Promise.all(outputs.map(async (output) => {
      if (!output.filepath || !output.filename) {
        return {
          format: output.format,
          error: 'Renderer did not produce a file',
        };
      }

      const downloadId = generateDownloadId();
      await storeDownloadReference(downloadId, output.filepath, output.filename, output.format);
      return {
        format: output.format,
        download_url: `/api/downloads/${downloadId}`,
        filename: output.filename,
        metadata: output.metadata,
      };
    }));

    res.json({ downloads });
  } catch (err) {
    console.error('[RenderMultiple]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/downloads/:downloadId
 *
 * Streams the file to the client
 */
router.get('/:downloadId', requirePermission('data.export'), async (req, res) => {
  try {
    const ref = await getDownloadReference(req.params.downloadId);
    if (!ref) {
      return res.status(404).json({ error: 'Download not found or expired' });
    }

    if (!fs.existsSync(ref.filepath)) {
      downloadStore.delete(req.params.downloadId);
      return res.status(410).json({ error: 'File expired — regenerate the report' });
    }

    const mimeTypes: Record<string, string> = {
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pdf: 'application/pdf',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };

    res.setHeader('Content-Type', mimeTypes[ref.format] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${ref.filename}"`);

    const stream = fs.createReadStream(ref.filepath);
    stream.pipe(res);
    stream.on('end', () => {
      // Clean up temp file after download
      fs.unlink(ref.filepath, () => {});
      downloadStore.delete(req.params.downloadId);
    });
  } catch (err) {
    console.error('[Download]', err);
    res.status(500).json({ error: 'Download failed' });
  }
});

// ── Helpers ──────────────────────────────────────────────────────

async function assembleRendererInput(
  workspaceId: string,
  source: string,
  options?: RenderOptions
): Promise<RendererInput> {
  // Load workspace metadata + branding
  const wsResult = await query(`
    SELECT id, name, branding, voice_config
    FROM workspaces
    WHERE id = $1
  `, [workspaceId]);

  if (wsResult.rows.length === 0) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }

  const workspace = wsResult.rows[0];

  // Determine source
  let templateMatrix = null;
  let agentOutput = null;

  if (source === 'latest_deliverable') {
    // Load from deliverable_results
    const result = await query(`
      SELECT matrix FROM deliverable_results
      WHERE workspace_id = $1
      ORDER BY generated_at DESC LIMIT 1
    `, [workspaceId]);

    if (result.rows.length > 0) {
      templateMatrix = result.rows[0].matrix;
    }
  } else if (source === 'latest_agent_run') {
    // Load from agent_runs (if exists)
    const result = await query(`
      SELECT output FROM agent_runs
      WHERE workspace_id = $1
      ORDER BY completed_at DESC LIMIT 1
    `, [workspaceId]);

    if (result.rows.length > 0) {
      agentOutput = result.rows[0].output;
    }
  } else {
    // Assume source is a specific run_id or deliverable_id
    // Try deliverable_results first
    const delResult = await query(`
      SELECT matrix FROM deliverable_results
      WHERE workspace_id = $1 AND id = $2
    `, [workspaceId, source]);

    if (delResult.rows.length > 0) {
      templateMatrix = delResult.rows[0].matrix;
    } else {
      // Try agent_runs
      const agentResult = await query(`
        SELECT output FROM agent_runs
        WHERE workspace_id = $1 AND id = $2
      `, [workspaceId, source]);

      if (agentResult.rows.length > 0) {
        agentOutput = agentResult.rows[0].output;
      }
    }
  }

  if (!templateMatrix && !agentOutput) {
    throw new Error(`No data found for source: ${source}`);
  }

  return {
    templateMatrix,
    agentOutput,
    workspace: {
      id: workspace.id,
      name: workspace.name,
      branding: workspace.branding,
      voice: workspace.voice_config,
    },
    options: options || {
      detail_level: 'summary_and_data',
      include_methodology: true,
      include_evidence_tables: false,
      generated_at: new Date().toISOString(),
    },
  };
}

function generateDownloadId(): string {
  return `dl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

async function storeDownloadReference(
  id: string,
  filepath: string,
  filename: string,
  format: string
): Promise<void> {
  downloadStore.set(id, {
    filepath,
    filename,
    format,
    createdAt: Date.now(),
  });
}

async function getDownloadReference(id: string): Promise<any> {
  const ref = downloadStore.get(id);
  if (!ref) return null;

  // Expire after 1 hour
  if (Date.now() - ref.createdAt > 3600000) {
    downloadStore.delete(id);
    if (fs.existsSync(ref.filepath)) {
      fs.unlink(ref.filepath, () => {});
    }
    return null;
  }

  return ref;
}

// Cleanup expired downloads every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, ref] of downloadStore.entries()) {
    if (now - ref.createdAt > 3600000) {
      downloadStore.delete(id);
      if (fs.existsSync(ref.filepath)) {
        fs.unlink(ref.filepath, () => {});
      }
    }
  }
}, 15 * 60 * 1000);

export default router;
