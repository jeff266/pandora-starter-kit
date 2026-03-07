export type ChartType =
  | 'bar'
  | 'horizontal_bar'
  | 'line'
  | 'stacked_bar'
  | 'waterfall'
  | 'donut';

export interface ChartDataPoint {
  label: string;
  value: number;
  secondaryValue?: number;
  segment?: string;
  annotation?: string;
}

export interface ChartSpec {
  type: 'chart';
  chartType: ChartType;
  title: string;
  subtitle?: string;
  annotation?: string;
  referenceValue?: number;
  data: ChartDataPoint[];
  xAxis?: { label: string };
  yAxis?: { label: string; format: 'currency' | 'number' | 'percent' };
  colorMap?: Record<string, string>;
  source: {
    calculation_id: string;
    run_at: string;
    record_count: number;
  };
}

export interface ChartBlock {
  blockType: 'chart';
  spec: ChartSpec;
}
