export type ChartType =
  | 'bar'
  | 'horizontal_bar'
  | 'line'
  | 'stacked_bar'
  | 'waterfall'
  | 'donut'
  | 'funnel'
  | 'bullet'
  | 'heatmap'
  | 'combo'
  | 'scatter';

export interface ChartDataPoint {
  label: string;
  value: number;
  secondaryValue?: number;  // for combo: line series on secondary axis
  segment?: string;
  annotation?: string;
  x?: number;               // for scatter: explicit x position
  y?: number;               // for scatter: explicit y position (value stays as size/z)
  row?: string;             // for heatmap: Y-axis dimension (e.g. rep name)
  col?: string;             // for heatmap: X-axis dimension (e.g. stage)
}

export interface ChartSpec {
  type: 'chart';
  chartType: ChartType;
  title: string;
  subtitle?: string;
  annotation?: string;
  referenceValue?: number;
  sort?: 'natural' | 'value_desc' | 'value_asc';
  data: ChartDataPoint[];
  xAxis?: { label: string };
  yAxis?: { label: string; format: 'currency' | 'number' | 'percent' };
  colorMap?: Record<string, string>;
  source: {
    calculation_id: string;
    run_at: string;
    record_count: number;
  };
  // Bullet chart bands
  bands?: Array<{
    from: number;
    to: number;
    color: string;          // e.g. '#fee2e2', '#fef9c3', '#dcfce7'
    label?: string;         // e.g. 'Below target', 'On track', 'Exceeding'
  }>;
  targetValue?: number;       // for bullet: target line (distinct from referenceValue)
  comboSeriesLabel?: string;  // for combo: label for line series (secondary axis)

  // Multi-dimension support
  series_field?: string;
  second_y_field?: string;
  second_y_aggregate?: 'COUNT' | 'SUM' | 'AVG' | 'MAX' | 'MIN';

  // Axis formatting
  axis_format?: {
    number_format: 'raw' | 'currency' | 'km' | 'percent';
    decimal_places: 0 | 1 | 2;
    y_min?: number;
    y_max?: number;
    axis_title?: string;
  };

  // Data labels
  data_labels?: {
    enabled: boolean;
    position: 'outside_end' | 'inside_end' | 'center' | 'base';
    number_format: 'raw' | 'currency' | 'km' | 'percent';
    decimal_places: 0 | 1 | 2;
  };

  // Outlier / broken axis
  outlier_mode?: {
    enabled: boolean;
    threshold_multiple: number;
  };

  // Legend
  legend?: {
    enabled: boolean;
    position: 'top' | 'bottom' | 'left' | 'right' | 'none';
  };

  // Color mode
  color_mode?: 'semantic' | 'uniform' | 'categorical';
}

export interface ChartBlock {
  blockType: 'chart';
  spec: ChartSpec;
}
