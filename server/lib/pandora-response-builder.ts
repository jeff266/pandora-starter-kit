import { v4 as uuid } from 'uuid';
import {
  PandoraBlock,
  PandoraResponse,
  NarrativeBlock,
  ChartBlock,
  TableBlock,
  ActionCardBlock,
  DeliberationBlock,
} from '../../shared/types/response-blocks.js';
import { ChartSpec } from '../../client/src/types/chart-types.js';

export class PandoraResponseBuilder {
  private blocks: PandoraBlock[] = [];
  private toolsUsed: string[] = [];
  private startedAt = Date.now();

  addNarrative(content: string, severity?: NarrativeBlock['severity']): this {
    this.blocks.push({ blockType: 'narrative', id: uuid(), content, severity });
    return this;
  }

  addChart(spec: ChartSpec, saveable = false): this {
    this.blocks.push({ blockType: 'chart', id: uuid(), spec, saveable });
    return this;
  }

  addTable(
    columns: TableBlock['columns'],
    rows: TableBlock['rows'],
    opts?: { title?: string; maxRows?: number }
  ): this {
    this.blocks.push({
      blockType: 'table',
      id: uuid(),
      columns,
      rows,
      ...opts,
    });
    return this;
  }

  addActionCard(card: Omit<ActionCardBlock, 'blockType' | 'id'>): this {
    this.blocks.push({ blockType: 'action_card', id: uuid(), ...card });
    return this;
  }

  addDeliberation(d: Omit<DeliberationBlock, 'blockType' | 'id'>): this {
    this.blocks.push({ blockType: 'deliberation', id: uuid(), ...d });
    return this;
  }

  recordTool(toolId: string): this {
    this.toolsUsed.push(toolId);
    return this;
  }

  build(
    surface: PandoraResponse['surface'],
    workspaceId: string,
    tokenCost?: number
  ): PandoraResponse {
    return {
      id: uuid(),
      surface,
      workspace_id: workspaceId,
      created_at: new Date().toISOString(),
      blocks: this.blocks,
      meta: {
        tools_used: [...new Set(this.toolsUsed)],
        token_cost: tokenCost,
        latency_ms: Date.now() - this.startedAt,
      },
    };
  }
}
