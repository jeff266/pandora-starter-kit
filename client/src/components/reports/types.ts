export interface MetricCard {
  label: string;
  value: string;
  delta?: string;
  delta_direction?: 'up' | 'down' | 'flat';
  severity?: 'good' | 'warning' | 'critical';
}

export interface DealCard {
  name: string;
  amount: string;
  owner: string;
  stage: string;
  signal: string;
  signal_severity: 'critical' | 'warning' | 'info';
  detail: string;
  action: string;
}

export interface ActionItem {
  owner: string;
  action: string;
  urgency: 'today' | 'this_week' | 'this_month';
  related_deal?: string;
}

export interface TableRow {
  [key: string]: string | number | null;
}

export interface SankeyStageNode {
  id: string;
  label: string;
  deals: number;
  value: number;
  won: number;
  wonValue: number;
  lostCount: number;
  lostValue: number;
}

export interface SankeyFlow {
  fromId: string;
  toId: string;
  deals: number;
  value: number;
}

export interface SankeyConversionRate {
  fromLabel: string;
  toLabel: string;
  rate: number;
  delta?: number;
}

export interface SankeyChartData {
  type: 'sankey';
  stages: SankeyStageNode[];
  flows: SankeyFlow[];
  conversionRates: SankeyConversionRate[];
  periodLabel?: string;
  activeFilter: { type: 'all' | 'pipeline' | 'scope'; id?: string; label: string };
  availableFilters: {
    pipelines: string[];
    scopes: Array<{ id: string; name: string }>;
  };
}

export interface SectionContent {
  section_id: string;
  title: string;
  narrative: string;
  metrics?: MetricCard[];
  table?: {
    headers: string[];
    rows: TableRow[];
  };
  deal_cards?: DealCard[];
  action_items?: ActionItem[];
  chart_data?: SankeyChartData;
  source_skills: string[];
  data_freshness: string;
  confidence: number;
}
