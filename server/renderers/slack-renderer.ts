/**
 * Slack Renderer
 *
 * Extends existing Slack formatter to handle both evidence-based (agent/skill) output
 * and template-driven output. Produces Slack Block Kit JSON with action buttons,
 * severity indicators, and structured sections.
 */

import { Renderer, RendererInput, RenderOutput } from './types.js';

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '🔴',
  warning: '🟡',
  info: '🔵',
};

export class SlackRenderer implements Renderer {
  format = 'slack_blocks';

  async render(input: RendererInput): Promise<RenderOutput> {
    const start = Date.now();
    let blocks: any[] = [];

    if (input.templateMatrix) {
      blocks = this.renderTemplateBlocks(input);
    } else if (input.agentOutput) {
      blocks = this.renderAgentBlocks(input);
    } else if (input.skillEvidence) {
      blocks = this.renderSkillBlocks(input);
    }

    return {
      format: 'slack_blocks',
      slack_blocks: blocks,
      metadata: {
        render_duration_ms: Date.now() - start,
      },
    };
  }

  private renderAgentBlocks(input: RendererInput): any[] {
    const agent = input.agentOutput!;
    const blocks: any[] = [];
    const voice = input.workspace.voice;

    // Header
    blocks.push({
      type: 'header',
      text: { type: 'plain_text', text: '📊 Pipeline Intelligence Report' },
    });

    // Time context
    if (input.options.time_range_label) {
      blocks.push({
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `📅 ${input.options.time_range_label}  •  ${input.workspace.name}`,
        }],
      });
    }

    blocks.push({ type: 'divider' });

    // Narrative (cross-skill synthesis)
    if (agent.narrative) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: agent.narrative },
      });
      blocks.push({ type: 'divider' });
    }

    // Claims grouped by severity
    const claims = agent.all_claims || [];
    const grouped = this.groupClaimsBySeverity(claims);

    for (const severity of ['critical', 'warning', 'info'] as const) {
      const group = grouped[severity] || [];
      if (group.length === 0) continue;

      // Only show info claims in 'full_audit' detail
      if (severity === 'info' && input.options.detail_level === 'summary_only') continue;

      const emoji = SEVERITY_EMOJI[severity];
      const label = severity === 'critical' ? 'Critical' : severity === 'warning' ? 'Needs Attention' : 'Informational';

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${emoji} *${label}* (${group.length})`,
        },
      });

      // Show individual claims
      const maxToShow = voice?.detail_level === 'executive' ? 3 : severity === 'critical' ? 10 : 5;
      const shown = group.slice(0, maxToShow);

      for (const claim of shown) {
        const entityLine = claim.entity_id
          ? `\n_${claim.entity_type || 'Entity'}: ${claim.entity_id}_`
          : '';

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `• ${claim.message || claim.claim_text || ''}${entityLine}`,
          },
        });
      }

      if (group.length > maxToShow) {
        blocks.push({
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: `_…and ${group.length - maxToShow} more ${severity} findings_`,
          }],
        });
      }
    }

    // Action buttons
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '📥 Download Full Report' },
          action_id: 'download_report',
          value: agent.run_id || '',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔍 View in Command Center' },
          action_id: 'open_command_center',
          url: `${process.env.APP_URL || ''}/command-center`,
        },
      ],
    });

    // Footer
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `Powered by Pandora  •  ${(agent.skills_run || []).length} skills  •  ${agent.total_tokens || '?'} tokens`,
      }],
    });

    return blocks;
  }

  private renderSkillBlocks(input: RendererInput): any[] {
    const evidence = input.skillEvidence!;
    const blocks: any[] = [];

    blocks.push({
      type: 'header',
      text: { type: 'plain_text', text: `📊 Skill Report` },
    });

    // Claims
    for (const claim of (evidence.claims || [])) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${SEVERITY_EMOJI[claim.severity] || '●'} ${claim.claim_text}`,
        },
      });
    }

    return blocks;
  }

  private renderTemplateBlocks(input: RendererInput): any[] {
    const matrix = input.templateMatrix!;
    const blocks: any[] = [];

    // Template-driven Slack output = summary + call to action
    const typeLabels: Record<string, string> = {
      stage_matrix: '🗺️ Sales Process Map',
      ranked_list: '🏆 Lead Scoring Results',
      waterfall: '📈 Pipeline Waterfall',
      hybrid: '📋 GTM Blueprint',
    };

    blocks.push({
      type: 'header',
      text: { type: 'plain_text', text: typeLabels[matrix.template_type] || '📊 Deliverable Ready' },
    });

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Your *${matrix.template_type.replace(/_/g, ' ')}* for *${input.workspace.name}* is ready.\n\n`
          + `📐 ${(matrix.stages || []).length} stages × ${(matrix.rows || []).length} dimensions\n`
          + `📊 ${matrix.cell_count?.total || '?'} cells populated (${matrix.cell_count?.synthesize || 0} AI-synthesized)\n`
          + `${matrix.cell_count?.degraded ? `⚠️ ${matrix.cell_count.degraded} cells have limited data` : '✅ Full data coverage'}`,
      },
    });

    blocks.push({ type: 'divider' });

    // Download buttons
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '📥 Download Spreadsheet' },
          action_id: 'download_xlsx',
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '📄 Download PDF' },
          action_id: 'download_pdf',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔍 View in Command Center' },
          action_id: 'open_command_center',
        },
      ],
    });

    return blocks;
  }

  private groupClaimsBySeverity(claims: any[]): Record<string, any[]> {
    const grouped: Record<string, any[]> = {};
    for (const claim of claims) {
      if (!grouped[claim.severity]) grouped[claim.severity] = [];
      grouped[claim.severity].push(claim);
    }
    return grouped;
  }
}
