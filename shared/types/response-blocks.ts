import { ChartSpec } from '../../client/src/types/chart-types.js';

export type PandoraBlockType = 'narrative' | 'chart' | 'table' | 'action_card' | 'deliberation';

export type DeliberationMode = 'bull_bear' | 'red_team';

export interface DeliberationPanel {
  role: string;           // 'Bull' | 'Bear' | 'Plan' | 'Red Team' | 'Verdict'
  summary: string;
  key_points: string[];
  confidence: number;     // 0-1
  color_hint?: string;    // 'bull' | 'bear' | 'synthesis' — maps to SEMANTIC_COLORS
}

export interface DeliberationBlock {
  blockType: 'deliberation';
  id: string;
  mode: DeliberationMode;
  run_id?: string;
  hypothesis: string;     // the question or claim being deliberated
  panels: DeliberationPanel[];
  synthesis: string;
  verdict?: string;
}

export interface NarrativeBlock {
  blockType: 'narrative';
  id: string;
  content: string;
  severity?: 'critical' | 'warning' | 'info' | 'positive';
}

export interface ChartBlock {
  blockType: 'chart';
  id: string;
  spec: ChartSpec;
  saveable?: boolean;
}

export interface TableBlock {
  blockType: 'table';
  id: string;
  title?: string;
  columns: Array<{
    key: string;
    label: string;
    format?: 'currency' | 'number' | 'percent' | 'date' | 'text';
  }>;
  rows: Array<Record<string, string | number | null>>;
  maxRows?: number;
}

export interface ActionCardBlock {
  blockType: 'action_card';
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  rationale: string;
  target_entity_type: 'deal' | 'account' | 'contact';
  target_entity_id?: string;
  target_entity_name?: string;
  action_id?: string;
  cta_label: string;
  cta_href?: string;
}

export type PandoraBlock =
  | NarrativeBlock
  | ChartBlock
  | TableBlock
  | ActionCardBlock
  | DeliberationBlock;

export interface PandoraResponse {
  id: string;
  surface: 'ask_pandora' | 'concierge';
  workspace_id: string;
  created_at: string;
  blocks: PandoraBlock[];
  meta: {
    tools_used: string[];
    token_cost?: number;
    latency_ms?: number;
  };
}
