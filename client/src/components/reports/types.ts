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
  source_skills: string[];
  data_freshness: string;
  confidence: number;
}
