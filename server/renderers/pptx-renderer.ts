import { Renderer, RendererInput, RenderOutput } from './types.js';
import { renderPPTX } from './pptx-renderer-full.js';
import * as fs from 'fs';

export class PPTXRenderer implements Renderer {
  format = 'pptx';

  async render(input: RendererInput): Promise<RenderOutput> {
    const context = this.buildContext(input);
    const result = await renderPPTX(context);

    const buffer = fs.readFileSync(result.filepath);

    return {
      format: 'pptx',
      filename: result.filepath.split('/').pop(),
      filepath: result.filepath,
      buffer,
      metadata: {
        file_size_bytes: result.size_bytes,
        render_duration_ms: 0,
      },
    };
  }

  private buildContext(input: RendererInput): any {
    const sections_content: any[] = [];

    if (input.agentOutput) {
      const agent = input.agentOutput;
      for (const [skillId, evidence] of Object.entries(agent.skill_evidence || {})) {
        sections_content.push({
          title: evidence.skill_name || skillId,
          narrative: evidence.output_text || '',
          confidence: evidence.confidence ?? 0.8,
          data_freshness: evidence.run_started_at || new Date().toISOString(),
          metrics: (evidence.metrics || []).map((m: any) => ({
            label: m.label || m.name,
            value: String(m.value ?? ''),
            severity: m.severity,
            delta: m.delta,
            delta_direction: m.delta_direction,
          })),
          deal_cards: (evidence.evaluated_records || []).slice(0, 10).map((r: any) => ({
            name: r.name || r.deal_name || 'Unknown Deal',
            amount: r.amount ? `$${Number(r.amount).toLocaleString()}` : undefined,
            stage: r.stage,
            owner: r.owner,
            signal_severity: r.severity || 'info',
            action: r.recommendation || r.action,
          })),
          action_items: (evidence.actions || []).map((a: any) => ({
            action: a.action || a.text || a.message,
            owner: a.owner,
            urgency: a.urgency || 'this_week',
          })),
          table: null,
        });
      }
    } else if (input.templateMatrix) {
      const tm = input.templateMatrix;
      if (tm.sections) {
        for (const section of tm.sections) {
          sections_content.push({
            title: section.title || section.label || 'Section',
            narrative: section.content || '',
            confidence: 0.9,
            data_freshness: tm.populated_at || new Date().toISOString(),
            metrics: [],
            deal_cards: [],
            action_items: [],
            table: null,
          });
        }
      } else if (tm.rows && tm.stages) {
        sections_content.push({
          title: tm.template_name || 'Analysis',
          narrative: '',
          confidence: 0.9,
          data_freshness: tm.populated_at || new Date().toISOString(),
          metrics: [],
          deal_cards: [],
          action_items: [],
          table: {
            headers: ['Dimension', ...tm.stages.map(s => s.stage_name)],
            rows: tm.rows.map(row => {
              const rowObj: Record<string, string> = { Dimension: row.dimension_label };
              for (const stage of tm.stages!) {
                rowObj[stage.stage_name] = row.cells[stage.stage_normalized]?.content || '';
              }
              return rowObj;
            }),
          },
        });
      }
    } else if (input.skillEvidence) {
      const ev = input.skillEvidence;
      sections_content.push({
        title: ev.skill_name || 'Analysis',
        narrative: ev.output_text || '',
        confidence: ev.confidence ?? 0.8,
        data_freshness: ev.run_started_at || new Date().toISOString(),
        metrics: [],
        deal_cards: [],
        action_items: [],
        table: null,
      });
    }

    return {
      workspace_id: input.workspace.id,
      template: {
        id: 'registry-render',
        name: input.agentOutput?.agent_name || input.skillEvidence?.skill_name || 'Pandora Report',
        description: '',
      },
      sections_content,
      branding: input.workspace.branding ? {
        primary_color: input.workspace.branding.primary_color,
        company_name: input.workspace.branding.company_name,
        prepared_by: input.workspace.branding.prepared_by,
      } : undefined,
    };
  }
}
