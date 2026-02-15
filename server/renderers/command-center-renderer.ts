/**
 * Command Center Renderer
 *
 * Transforms skill findings and template content into structured JSON
 * that the Command Center frontend consumes. This is a data formatter
 * that shapes evidence for React components.
 */

import { Renderer, RendererInput, RenderOutput } from './types.js';

export class CommandCenterRenderer implements Renderer {
  format = 'command_center';

  async render(input: RendererInput): Promise<RenderOutput> {
    const start = Date.now();

    let payload: any;

    if (input.agentOutput) {
      payload = this.renderAgentPayload(input);
    } else if (input.skillEvidence) {
      payload = this.renderSkillPayload(input);
    } else if (input.templateMatrix) {
      payload = this.renderTemplatePayload(input);
    }

    return {
      format: 'html',
      html: JSON.stringify(payload), // Frontend consumes as JSON
      metadata: {
        render_duration_ms: Date.now() - start,
      },
    };
  }

  private renderAgentPayload(input: RendererInput): any {
    const agent = input.agentOutput!;

    return {
      type: 'agent_report',
      narrative: agent.narrative || null,

      // Findings feed — structured for FindingCard components
      findings: (agent.all_claims || []).map((claim: any) => ({
        id: claim.id,
        severity: claim.severity,
        skill_id: claim.skill_id,
        message: claim.message || claim.claim_text,
        entity_type: claim.entity_type,
        entity_id: claim.entity_id,
        category: claim.category,
        metric_value: claim.metric_value,
        metric_threshold: claim.metric_threshold,
        // Drill-through link
        drill_through: claim.entity_type && claim.entity_id
          ? { type: claim.entity_type, id: claim.entity_id }
          : null,
      })),

      // Summary stats for headline metrics
      stats: {
        total_findings: (agent.all_claims || []).length,
        critical: (agent.all_claims || []).filter((c: any) => c.severity === 'critical').length,
        warning: (agent.all_claims || []).filter((c: any) => c.severity === 'warning').length,
        info: (agent.all_claims || []).filter((c: any) => c.severity === 'info').length,
        skills_run: agent.skills_run?.length || 0,
        total_tokens: agent.total_tokens || 0,
      },

      // Per-skill evidence (for drill-through)
      skill_details: Object.entries(agent.skill_evidence || {}).map(([id, ev]: [string, any]) => ({
        skill_id: id,
        claims_count: ev.claims?.length || 0,
        records_count: ev.evaluated_records?.length || 0,
        data_sources: ev.data_sources || [],
      })),

      generated_at: new Date().toISOString(),
    };
  }

  private renderSkillPayload(input: RendererInput): any {
    const evidence = input.skillEvidence!;

    return {
      type: 'skill_report',
      findings: (evidence.claims || []).map((claim: any) => ({
        id: claim.claim_id,
        severity: claim.severity,
        message: claim.claim_text,
        entity_type: claim.entity_type,
        entity_ids: claim.entity_ids || [],
        metric_name: claim.metric_name,
        metric_values: claim.metric_values,
        threshold_applied: claim.threshold_applied,
      })),
      records: evidence.evaluated_records || [],
      column_schema: evidence.column_schema || [],
      data_sources: evidence.data_sources || [],
      parameters: evidence.parameters || [],
      generated_at: new Date().toISOString(),
    };
  }

  private renderTemplatePayload(input: RendererInput): any {
    const matrix = input.templateMatrix!;

    return {
      type: 'template_deliverable',
      template_type: matrix.template_type,
      stages: matrix.stages,
      rows: (matrix.rows || []).map((row: any) => ({
        dimension_key: row.dimension_key,
        dimension_label: row.dimension_label,
        display_order: row.display_order,
        cells: Object.entries(row.cells).reduce((acc: any, [stage, cell]: [string, any]) => {
          acc[stage] = {
            content: cell.content,
            status: cell.status,
            confidence: cell.confidence,
            degradation_reason: cell.degradation_reason,
          };
          return acc;
        }, {}),
      })),
      cell_count: matrix.cell_count,
      population_status: matrix.population_status,
      generated_at: matrix.populated_at || new Date().toISOString(),
    };
  }
}
