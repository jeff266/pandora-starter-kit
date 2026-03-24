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
import { generateEditorialReport } from './editorial-generator.js';

const logger = createLogger('ReportGenerator');

const SKILL_DISPLAY_NAMES: Record<string, string> = {
  'pipeline-hygiene': 'Pipeline Hygiene',
  'pipeline-coverage': 'Pipeline Coverage',
  'forecast-rollup': 'Forecast Rollup',
  'deal-risk-review': 'Deal Risk Review',
  'pipeline-waterfall': 'Pipeline Waterfall',
  'rep-scorecard': 'Rep Scorecard',
  'conversation-intelligence': 'Conversation Intelligence',
};

function humanizeSkillId(id: string): string {
  return SKILL_DISPLAY_NAMES[id] || id
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function checkSkillFreshness(
  workspace_id: string,
  skillIds: string[],
  thresholdMs: number
): Promise<Map<string, 'fresh' | 'stale' | 'missing'>> {
  const result = new Map<string, 'fresh' | 'stale' | 'missing'>();
  if (skillIds.length === 0) return result;
  try {
    // Find the most recent COMPLETED run per skill — ignores failed/running runs
    const rows = await query<{ skill_id: string; last_completed_at: string }>(
      `SELECT skill_id, MAX(created_at) AS last_completed_at
       FROM skill_runs
       WHERE workspace_id = $1 AND skill_id = ANY($2) AND status = 'completed'
       GROUP BY skill_id`,
      [workspace_id, skillIds]
    );
    const completedAt = new Map<string, Date>();
    for (const r of rows.rows) {
      completedAt.set(r.skill_id, new Date(r.last_completed_at));
    }
    for (const sid of skillIds) {
      const last = completedAt.get(sid);
      if (!last) {
        result.set(sid, 'missing');
      } else {
        const age = Date.now() - last.getTime();
        result.set(sid, age <= thresholdMs ? 'fresh' : 'stale');
      }
    }
  } catch {
    for (const sid of skillIds) result.set(sid, 'missing');
  }
  return result;
}

export async function generateReport(request: GenerateReportRequest): Promise<ReportGeneration> {
  const startTime = Date.now();
  const { workspace_id, report_template_id, triggered_by, preview_only = false, period_label, document_type } = request;

  logger.info('Starting report generation', { workspace_id, report_template_id, triggered_by });

  // 1. Load template
  const templateResult = await query<ReportTemplate & { agent_id?: string }>(
    `SELECT * FROM report_templates WHERE id = $1 AND workspace_id = $2`,
    [report_template_id, workspace_id]
  );

  if (templateResult.rows.length === 0) {
    throw new Error(`Report template not found: ${report_template_id}`);
  }

  const template = templateResult.rows[0];

  // EDITORIAL SYNTHESIS ROUTING:
  // If template has agent_id, use editorial synthesis instead of section-generator
  if (template.agent_id) {
    logger.info('Template has agent_id - routing to editorial synthesis', { agent_id: template.agent_id });
    return generateEditorialReport(request);
  }

  // Continue with legacy section-generator path for templates without agents

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

  // 4a. For WBR/QBR: check skill freshness upfront (7-day window per spec)
  const isWbrOrQbr = document_type === 'wbr' || document_type === 'qbr';
  const FRESHNESS_THRESHOLD_MS = 7 * 24 * 3600 * 1000;
  const skillFreshness = isWbrOrQbr
    ? await checkSkillFreshness(workspace_id, requiredSkills, FRESHNESS_THRESHOLD_MS)
    : new Map<string, 'fresh' | 'stale' | 'missing'>();

  // 4b. For WBR/QBR: check for prior doc feedback from Google Docs edits
  let priorFeedback: any | null = null;
  if (isWbrOrQbr) {
    try {
      // Find the most recent prior WBR/QBR document for this workspace
      const priorDocResult = await query<{
        id: string;
        google_doc_id: string | null;
      }>(
        `SELECT id, google_doc_id
         FROM report_documents
         WHERE workspace_id = $1
           AND document_type = $2
           AND google_doc_id IS NOT NULL
         ORDER BY generated_at DESC
         LIMIT 1`,
        [workspace_id, document_type]
      );

      if (priorDocResult.rows.length > 0) {
        const { readGoogleDocFeedback } = await import('./google-docs-feedback.js');
        priorFeedback = await readGoogleDocFeedback(
          workspace_id,
          priorDocResult.rows[0].id
        );
        if (priorFeedback) {
          logger.info('Prior Google Doc feedback loaded', {
            has_meaningful_changes: priorFeedback.has_meaningful_changes,
            word_count_delta: priorFeedback.word_count_delta,
          });
        }
      }
    } catch (err) {
      logger.warn('Failed to load prior feedback (non-fatal)', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // 5. Generate content for each section
  logger.info('Generating section content', { section_count: enabledSections.length });
  const sectionsContent: SectionContent[] = [];

  for (const section of enabledSections) {
    // WBR/QBR: if any required skill for this section lacks a completed run within 7 days,
    // replace narrative with a degraded placeholder instead of attempting generation
    if (isWbrOrQbr && section.skills.length > 0) {
      const notReadySkills = section.skills.filter(sid => {
        const status = skillFreshness.get(sid);
        return status === 'missing' || status === 'stale';
      });
      if (notReadySkills.length > 0) {
        const firstName = humanizeSkillId(notReadySkills[0]);
        const extraCount = notReadySkills.length - 1;
        const label = extraCount > 0
          ? `${firstName} (+${extraCount} more)`
          : firstName;
        sectionsContent.push({
          section_id: section.id,
          title: section.label,
          narrative: `⚠ ${label} has not run recently. Run it from the Skills page to populate this section.`,
          source_skills: section.skills,
          data_freshness: new Date().toISOString(),
          confidence: 0,
        });
        continue;
      }
    }

    try {
      const content = await generateSectionContent(
        workspace_id,
        section,
        template.voice_config,
        document_type,
        priorFeedback
      );
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

  // 8. When document_type is provided: persist a report_documents record with period_label override
  let documentId: string | undefined;
  if (document_type && !preview_only) {
    const skillsIncluded = sectionsContent
      .filter(sc => !sc.narrative?.startsWith('⚠'))
      .flatMap(sc => sc.source_skills ?? []);
    const skillsOmitted = sectionsContent
      .filter(sc => sc.narrative?.startsWith('⚠'))
      .flatMap(sc => sc.source_skills ?? []);

    // Generate executive summary for WBR/QBR documents
    let headline = `${template.name} — ${period_label ?? new Date().toLocaleDateString()}`;
    if (document_type === 'wbr' || document_type === 'qbr') {
      const { generateExecSummary } = await import('./exec-summary.js');
      const summary = await generateExecSummary(
        sectionsContent,
        document_type,
        period_label ?? new Date().toLocaleDateString(),
        workspace_id,
        priorFeedback
      );
      if (summary) {
        headline = summary;
      }
      // Falls back to mechanical headline if summary generation fails
    }

    const docResult = await query<{ id: string }>(
      `INSERT INTO report_documents
         (workspace_id, document_type, week_label, headline, sections,
          actions, skills_included, skills_omitted, tokens_used,
          orchestrator_run_id, generated_at, created_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, gen_random_uuid(), NOW(), NOW(), $10)
       RETURNING id`,
      [
        workspace_id,
        document_type,
        period_label ?? '',
        headline,
        JSON.stringify(sectionsContent),
        JSON.stringify([]),
        Array.from(new Set(skillsIncluded)),
        Array.from(new Set(skillsOmitted)),
        0,
        request.created_by_user_id || null,
      ]
    ).catch(err => {
      logger.error('Failed to insert report_documents', err instanceof Error ? err : undefined);
      return { rows: [] as { id: string }[] };
    });
    documentId = docResult.rows[0]?.id;
    if (documentId) {
      logger.info('Report document persisted', { document_id: documentId, document_type, period_label });
    } else {
      logger.warn('report_documents INSERT returned no id — document may not have been saved', { document_type, period_label });
    }
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
    document_id: documentId,
  };
}

// Renderers are now imported from separate modules
