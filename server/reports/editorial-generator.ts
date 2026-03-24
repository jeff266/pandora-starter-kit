/**
 * Editorial Report Generator
 *
 * Wires the editorial synthesizer into the report generation pipeline.
 * When a template has agent_id set, use editorial synthesis instead of section-generator.
 */

import { query } from '../db.js';
import {
  ReportTemplate,
  ReportSection,
  SectionContent,
  ReportGenerationContext,
  GenerateReportRequest,
  ReportGeneration,
} from './types.js';
import { createLogger } from '../utils/logger.js';
import { renderReportPDF } from '../renderers/report-pdf-renderer.js';
import { renderDOCX } from '../renderers/docx-renderer.js';
import { renderPPTX } from '../renderers/pptx-renderer-full.js';

// Editorial synthesis imports
import { editorialSynthesize } from '../agents/editorial-synthesizer.js';
import { gatherFreshEvidence } from '../agents/evidence-gatherer.js';
import { getTuningPairs } from '../agents/tuning.js';
import {
  extractDigest,
  saveDigest,
  getLatestDigest,
  getAgentMemory,
  updateAgentMemory,
  formatMemoryForPrompt,
} from '../agents/agent-memory.js';
import type { AgentDefinition } from '../agents/types.js';
import type { EditorialInput, AudienceConfig, DataWindowConfig, AgentBriefingOutput } from '../agents/editorial-types.js';

const logger = createLogger('EditorialGenerator');

/**
 * Generate a report using editorial synthesis
 */
export async function generateEditorialReport(
  request: GenerateReportRequest
): Promise<ReportGeneration> {
  const startTime = Date.now();
  const { workspace_id, report_template_id, triggered_by, preview_only = false, skip_delivery = false } = request;

  logger.info('[EditorialGenerator] Starting editorial report generation', {
    workspace_id,
    report_template_id,
    triggered_by,
  });

  // 1. Load template
  const templateResult = await query<ReportTemplate & { agent_id?: string }>(
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

  if (!template.agent_id) {
    throw new Error('Template does not have agent_id set - use generateReport() instead');
  }

  // 2. Load agent
  const agentResult = await query<AgentDefinition>(
    `SELECT * FROM agents WHERE id = $1 AND workspace_id = $2`,
    [template.agent_id, workspace_id]
  );

  if (agentResult.rows.length === 0) {
    throw new Error(`Agent not found: ${template.agent_id}`);
  }

  const agent = agentResult.rows[0];

  // 3. Load branding
  const brandingResult = await query<any>(
    `SELECT branding FROM workspaces WHERE id = $1`,
    [workspace_id]
  );
  const branding = template.branding_override || brandingResult.rows[0]?.branding || {};

  // 4. Filter enabled sections
  const enabledSections = template.sections
    .filter((s: ReportSection) => s.enabled)
    .sort((a: ReportSection, b: ReportSection) => a.order - b.order);

  if (enabledSections.length === 0) {
    throw new Error('Report has no enabled sections');
  }

  // 5. Gather fresh evidence for all skills
  logger.info('[EditorialGenerator] Gathering skill evidence', { skills: agent.skills });
  const skillEvidence = await gatherFreshEvidence(agent.skills.map(s => s.skillId), workspace_id);

  logger.info('[EditorialGenerator] Evidence gathered', {
    skill_count: Object.keys(skillEvidence).length,
  });

  // 6. Load tuning pairs
  const tuningPairs = await getTuningPairs(agent.id, workspace_id);

  // 7. Build audience config from agent metadata (new columns > focus_config > template defaults)
  const agentAudience = (agent as any).audience;
  const hasAudienceConfig = agentAudience && agentAudience.role;
  const audience: AudienceConfig = hasAudienceConfig
    ? {
        role: agentAudience.role,
        detail_preference: agentAudience.detail_preference || 'manager',
        vocabulary_avoid: agentAudience.vocabulary_avoid,
        vocabulary_prefer: agentAudience.vocabulary_prefer,
      }
    : {
        role: (agent as any).focus_config?.audience_role || 'Revenue Operations',
        detail_preference: template.voice_config?.detail_level || 'analyst',
        vocabulary_avoid: (agent as any).focus_config?.vocabulary_avoid,
        vocabulary_prefer: (agent as any).focus_config?.vocabulary_prefer,
      };

  // Read focus questions and data window from agent
  const focusQuestions: string[] = (agent as any).focus_questions ?? [];
  const dataWindow = (agent as any).data_window ?? { primary: 'current_week', comparison: 'previous_period' };

  // 8. Load memory (Phase 3) — previous digest + rolling memory + previous generation for WoW
  const [previousDigest, agentMemory, previousGenRow] = await Promise.all([
    getLatestDigest(agent.id, workspace_id),
    getAgentMemory(agent.id, workspace_id),
    query(
      `SELECT id, created_at, opening_narrative, sections_content, editorial_decisions
       FROM report_generations
       WHERE agent_id = $1 AND workspace_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [agent.id, workspace_id]
    ).then(r => r.rows[0] || null).catch(() => null),
  ]);
  const memoryBlock = formatMemoryForPrompt(previousDigest, agentMemory);

  let previousOutput: AgentBriefingOutput | undefined;
  if (previousGenRow) {
    previousOutput = {
      generation_id: previousGenRow.id,
      generated_at: previousGenRow.created_at,
      opening_narrative: previousGenRow.opening_narrative || '',
      sections: previousGenRow.sections_content || [],
      editorial_decisions: previousGenRow.editorial_decisions || [],
    };
  }

  logger.info('[EditorialGenerator] Memory loaded', {
    has_previous_digest: !!previousDigest,
    has_rolling_memory: !!agentMemory,
    has_previous_generation: !!previousOutput,
    memory_block_chars: memoryBlock.length,
  });

  // 9. Call editorial synthesizer
  logger.info('[EditorialGenerator] Running editorial synthesis', {
    audience_role: audience.role,
    focus_questions_count: focusQuestions.length,
    data_window: dataWindow.primary,
  });

  const editorialInput: EditorialInput = {
    agent,
    workspaceId: workspace_id,
    runId: `gen-${Date.now()}`,
    skillEvidence,
    availableSections: enabledSections,
    tuningPairs,
    voiceConfig: template.voice_config,
    audience,
    focusQuestions: focusQuestions.length > 0 ? focusQuestions : undefined,
    dataWindow: dataWindow,
    memoryContext: memoryBlock,
    previousOutput,
  };

  const editorial = await editorialSynthesize(editorialInput);

  const generationDuration = Date.now() - startTime;

  logger.info('[EditorialGenerator] Editorial synthesis complete', {
    sections_included: editorial.sections_included.length,
    sections_dropped: editorial.sections_dropped.length,
    editorial_decisions: editorial.editorial_decisions.length,
    tokens_used: editorial.tokens_used,
  });

  // 9a. Attach chart data from skill evidence to matching sections
  for (const section of editorial.sections) {
    if ((section as any).chart_data) continue;
    for (const skillId of (section.source_skills ?? [])) {
      const evidence = skillEvidence[skillId];
      if (evidence?.chart_data) {
        (section as any).chart_data = evidence.chart_data;
        break;
      }
    }
  }

  // 9. Render to requested formats
  logger.info('[EditorialGenerator] Rendering report', { formats: template.formats });
  const renderStartTime = Date.now();

  const context: ReportGenerationContext = {
    workspace_id,
    template,
    sections_content: editorial.sections,
    branding,
    triggered_by,
    preview_only,
    opening_narrative: editorial.opening_narrative,
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
          logger.error('[EditorialGenerator] PDF rendering failed', err instanceof Error ? err : undefined);
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
          logger.error('[EditorialGenerator] DOCX rendering failed', err instanceof Error ? err : undefined);
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
          logger.error('[EditorialGenerator] PPTX rendering failed', err instanceof Error ? err : undefined);
          throw new Error(`PPTX rendering failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        })
    );
  }

  // Wait for all renderers to complete
  await Promise.all(renderPromises);

  const renderDuration = Date.now() - renderStartTime;

  // 10. Save generation record (unless preview)
  let generationId: string;

  if (!preview_only) {
    const genResult = await query<{ id: string }>(
      `INSERT INTO report_generations (
        report_template_id, workspace_id, agent_id, formats_generated, delivery_status,
        sections_snapshot, sections_content, editorial_decisions, opening_narrative,
        skills_run, total_tokens, generation_duration_ms,
        render_duration_ms, triggered_by, data_as_of
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
      RETURNING id`,
      [
        report_template_id,
        workspace_id,
        agent.id,
        JSON.stringify(formatsGenerated),
        JSON.stringify({}),
        JSON.stringify(editorial.sections),
        JSON.stringify(editorial.sections),
        JSON.stringify(editorial.editorial_decisions),
        editorial.opening_narrative,
        JSON.stringify(agent.skills.map(s => s.skillId)),
        editorial.tokens_used,
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

    // Update agent last_run_at
    await query(
      `UPDATE agents
       SET last_run_at = NOW(),
           total_deliveries = total_deliveries + 1,
           updated_at = NOW()
       WHERE id = $1`,
      [agent.id]
    );

    // Phase 3: Save digest and update rolling memory
    try {
      const newDigest = extractDigest(editorial);
      await saveDigest(generationId, newDigest);
      await updateAgentMemory(
        agent.id,
        workspace_id,
        newDigest,
        agentMemory,
        skillEvidence
      );
      logger.info('[EditorialGenerator] Memory updated after generation', {
        generation_id: generationId,
      });
    } catch (memErr) {
      logger.error('[EditorialGenerator] Failed to update memory (non-fatal)', memErr instanceof Error ? memErr : undefined);
    }

    logger.info('[EditorialGenerator] Report generation complete', {
      generation_id: generationId,
      duration_ms: Date.now() - startTime,
      formats: Object.keys(formatsGenerated),
    });
  } else {
    generationId = `preview-${Date.now()}`;
    logger.info('[EditorialGenerator] Preview generation complete', { duration_ms: Date.now() - startTime });
  }

  return {
    id: generationId,
    report_template_id,
    workspace_id,
    formats_generated: formatsGenerated,
    delivery_status: {},
    sections_snapshot: enabledSections,
    sections_content: editorial.sections,
    opening_narrative: editorial.opening_narrative,
    editorial_decisions: editorial.editorial_decisions,
    skills_run: agent.skills.map(s => s.skillId),
    total_tokens: editorial.tokens_used,
    generation_duration_ms: generationDuration,
    render_duration_ms: renderDuration,
    triggered_by,
    data_as_of: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
}
