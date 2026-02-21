// Report Generation Pipeline
// Orchestrates: skill execution → section assembly → rendering → delivery

import { query } from '../db.js';
import {
  ReportTemplate,
  ReportSection,
  SectionContent,
  ReportGenerationContext,
  GenerateReportRequest,
  ReportGeneration,
} from './types.js';
import { getRequiredSkills } from './section-library.js';
import { generateSectionContent } from './section-generator.js';
import { createLogger } from '../utils/logger.js';
import { renderReportPDF } from '../renderers/report-pdf-renderer.js';
import { renderDOCX } from '../renderers/docx-renderer.js';
import { renderPPTX } from '../renderers/pptx-renderer-full.js';

const logger = createLogger('ReportGenerator');

export async function generateReport(request: GenerateReportRequest): Promise<ReportGeneration> {
  const startTime = Date.now();
  const { workspace_id, report_template_id, triggered_by, preview_only = false } = request;

  logger.info('Starting report generation', { workspace_id, report_template_id, triggered_by });

  // 1. Load template
  const templateResult = await query<ReportTemplate>(
    `SELECT * FROM report_templates WHERE id = $1 AND workspace_id = $2`,
    [report_template_id, workspace_id]
  );

  if (templateResult.rows.length === 0) {
    throw new Error(`Report template not found: ${report_template_id}`);
  }

  const template = templateResult.rows[0];

  if (!template.is_active && !preview_only) {
    throw new Error(`Report template is not active: ${report_template_id}`);
  }

  // 2. Load branding
  const brandingResult = await query<any>(
    `SELECT branding FROM workspaces WHERE id = $1`,
    [workspace_id]
  );
  const branding = template.branding_override || brandingResult.rows[0]?.branding || {};

  // 3. Filter enabled sections and sort by order
  const enabledSections = template.sections
    .filter((s: ReportSection) => s.enabled)
    .sort((a: ReportSection, b: ReportSection) => a.order - b.order);

  if (enabledSections.length === 0) {
    throw new Error('Report has no enabled sections');
  }

  // 4. Resolve required skills (deduplicated)
  const requiredSkills = getRequiredSkills(enabledSections);
  logger.info('Required skills', { skills: requiredSkills, count: requiredSkills.length });

  // 5. Generate content for each section
  logger.info('Generating section content', { section_count: enabledSections.length });
  const sectionsContent: SectionContent[] = [];

  for (const section of enabledSections) {
    try {
      const content = await generateSectionContent(workspace_id, section, template.voice_config);
      sectionsContent.push(content);
    } catch (err) {
      logger.error('Section generation failed', err instanceof Error ? err : undefined);
      // Continue with other sections - mark this as partial failure
      sectionsContent.push({
        section_id: section.id,
        title: section.label,
        narrative: `⚠️ Unable to generate content for this section: ${err instanceof Error ? err.message : 'Unknown error'}`,
        source_skills: section.skills,
        data_freshness: new Date().toISOString(),
        confidence: 0,
      });
    }
  }

  const generationDuration = Date.now() - startTime;

  // 6. Render to requested formats
  logger.info('Rendering report', { formats: template.formats });
  const renderStartTime = Date.now();

  const context: ReportGenerationContext = {
    workspace_id,
    template,
    sections_content: sectionsContent,
    branding,
    triggered_by,
    preview_only,
  };

  const formatsGenerated: Record<string, any> = {};

  // Render all requested formats in parallel
  const renderPromises: Promise<void>[] = [];

  if (template.formats.includes('pdf')) {
    renderPromises.push(
      renderReportPDF(context)
        .then(result => {
          formatsGenerated.pdf = result;
        })
        .catch(err => {
          logger.error('PDF rendering failed', err instanceof Error ? err : undefined);
          throw new Error(`PDF rendering failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        })
    );
  }

  if (template.formats.includes('docx')) {
    renderPromises.push(
      renderDOCX(context)
        .then(result => {
          formatsGenerated.docx = result;
        })
        .catch(err => {
          logger.error('DOCX rendering failed', err instanceof Error ? err : undefined);
          throw new Error(`DOCX rendering failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        })
    );
  }

  if (template.formats.includes('pptx')) {
    renderPromises.push(
      renderPPTX(context)
        .then(result => {
          formatsGenerated.pptx = result;
        })
        .catch(err => {
          logger.error('PPTX rendering failed', err instanceof Error ? err : undefined);
          throw new Error(`PPTX rendering failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        })
    );
  }

  // Wait for all renderers to complete
  await Promise.all(renderPromises);

  const renderDuration = Date.now() - renderStartTime;

  // 7. Save generation record (unless preview)
  let generationId: string;

  if (!preview_only) {
    const genResult = await query<{ id: string }>(
      `INSERT INTO report_generations (
        report_template_id, workspace_id, formats_generated, delivery_status,
        sections_snapshot, sections_content, skills_run, total_tokens, generation_duration_ms,
        render_duration_ms, triggered_by, data_as_of
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      RETURNING id`,
      [
        report_template_id,
        workspace_id,
        JSON.stringify(formatsGenerated),
        JSON.stringify({}), // Delivery happens in Phase 4
        JSON.stringify(enabledSections),
        JSON.stringify(sectionsContent),  // Store full content for viewer
        JSON.stringify(requiredSkills),
        0, // Token counting in Phase 1.5
        generationDuration,
        renderDuration,
        triggered_by,
      ]
    );

    generationId = genResult.rows[0].id;

    // Update template last_generated_at
    await query(
      `UPDATE report_templates
       SET last_generated_at = NOW(),
           last_generation_status = 'success',
           last_generation_error = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [report_template_id]
    );

    logger.info('Report generation complete', {
      generation_id: generationId,
      duration_ms: Date.now() - startTime,
      formats: Object.keys(formatsGenerated),
    });
  } else {
    generationId = `preview-${Date.now()}`;
    logger.info('Preview generation complete', { duration_ms: Date.now() - startTime });
  }

  return {
    id: generationId,
    report_template_id,
    workspace_id,
    formats_generated: formatsGenerated,
    delivery_status: {},
    sections_snapshot: enabledSections,
    sections_content: sectionsContent,
    skills_run: requiredSkills,
    total_tokens: 0,
    generation_duration_ms: generationDuration,
    render_duration_ms: renderDuration,
    triggered_by,
    data_as_of: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
}

// Renderers are now imported from separate modules
