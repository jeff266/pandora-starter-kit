export type AnnotationSeverity = 'critical' | 'warning' | 'positive' | 'info';
export type AnnotationActionability = 'immediate' | 'strategic' | 'monitor';

export type AnnotationType =
  | 'forecast_divergence'
  | 'deal_risk'
  | 'attainment_pace'
  | 'confidence_band_shift'
  | 'rep_forecast_bias'
  | 'rep_upside_signal'
  | 'coverage_gap'
  | 'pipegen_trend'
  | 'concentration_risk'
  | 'category_migration'
  | 'stalled_commit'
  | 'close_date_cluster';

export interface ForecastAnnotation {
  id: string; // deterministic: ${type}-${entityId}-${snapshotDate}
  type: AnnotationType;
  severity: AnnotationSeverity;
  actionability: AnnotationActionability;

  title: string;
  body: string;
  impact: string | null;
  recommendation: string | null;

  anchor: AnnotationAnchor;

  evidence: {
    deal_ids: string[];
    deal_names: string[];
    metric_values: Record<string, number>;
    comparison_basis: string | null;
  };

  snapshot_date: string;
  dismissed_at: string | null;
  snoozed_until: string | null;
  created_at: string;
}

export type AnnotationAnchor =
  | { type: 'chart'; week: number }
  | { type: 'metric'; metric: string }
  | { type: 'deal'; deal_id: string; deal_name: string }
  | { type: 'rep'; rep_email: string; rep_name: string }
  | { type: 'coverage'; period: string }
  | { type: 'global' };

export interface RawAnnotation {
  type: AnnotationType;
  raw_data: Record<string, any>;
}
