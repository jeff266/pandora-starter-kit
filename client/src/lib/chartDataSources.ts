export interface DataSourceField {
  key: string;
  label: string;
  type: 'currency' | 'number' | 'string' | 'date' | 'category';
  parse?: 'float' | 'int';
  colorSemantic?: 'severity' | 'stale' | 'category';
}

export interface DataSourceDef {
  id: string;
  skillId: string;
  label: string;
  description: string;
  recordPath: string;
  nameField: string;
  fields: DataSourceField[];
  defaultXField: string;
  defaultChartType: 'bar' | 'horizontal_bar' | 'line' | 'donut';
  defaultSort: { field: string; dir: 'asc' | 'desc' };
  defaultColorScheme: 'semantic' | 'uniform' | 'categorical';
  warnings?: string[];
}

export const DATA_SOURCES: DataSourceDef[] = [
  {
    id: 'at_risk_deals',
    skillId: 'deal-risk-review',
    label: 'At-risk deals',
    description: 'Deals flagged by risk assessment',
    recordPath: '',
    nameField: 'entity_name',
    fields: [
      { key: 'fields.amount', label: 'Deal amount ($K)', type: 'currency', parse: 'float' },
      { key: 'fields.risk_score', label: 'Risk score', type: 'number', parse: 'int', colorSemantic: 'severity' },
      { key: 'fields.days_since_activity', label: 'Days since last activity', type: 'number', colorSemantic: 'stale' },
      { key: 'severity', label: 'Severity', type: 'category', colorSemantic: 'severity' },
      { key: 'owner_name', label: 'Owner', type: 'string' },
      { key: 'fields.stage', label: 'Stage', type: 'string' },
    ],
    defaultXField: 'fields.amount',
    defaultChartType: 'horizontal_bar',
    defaultSort: { field: 'fields.risk_score', dir: 'desc' },
    defaultColorScheme: 'semantic',
  },
  {
    id: 'stale_deals',
    skillId: 'pipeline-hygiene',
    label: 'Stale deals',
    description: 'Deals with no recent activity',
    recordPath: '',
    nameField: 'entity_name',
    fields: [
      { key: 'fields.amount', label: 'Deal amount ($K)', type: 'currency' },
      { key: 'fields.days_since_activity', label: 'Days dark', type: 'number', colorSemantic: 'stale' },
      { key: 'fields.stage', label: 'Stage', type: 'string' },
      { key: 'flags.stale_flag', label: 'Stale status', type: 'category', colorSemantic: 'severity' },
    ],
    defaultXField: 'fields.days_since_activity',
    defaultChartType: 'horizontal_bar',
    defaultSort: { field: 'fields.days_since_activity', dir: 'desc' },
    defaultColorScheme: 'semantic',
    warnings: [],
  },
  {
    id: 'pipeline_by_rep',
    skillId: 'pipeline-coverage',
    label: 'Pipeline by rep',
    description: 'Open pipeline and closed-won by rep',
    recordPath: '',
    nameField: 'entity_name',
    fields: [
      { key: 'fields.open_pipeline', label: 'Open pipeline ($K)', type: 'currency' },
      { key: 'fields.closed_won', label: 'Closed-won ($K)', type: 'currency' },
      { key: 'fields.deal_count', label: 'Deal count', type: 'number' },
    ],
    defaultXField: 'fields.open_pipeline',
    defaultChartType: 'bar',
    defaultSort: { field: 'fields.open_pipeline', dir: 'desc' },
    defaultColorScheme: 'uniform',
    warnings: ['Revenue targets not configured — coverage ratio and quota gap will show 0'],
  },
  {
    id: 'forecast_pipeline',
    skillId: 'forecast-rollup',
    label: 'Forecast pipeline',
    description: 'Deals by forecast category',
    recordPath: '',
    nameField: 'entity_name',
    fields: [
      { key: 'fields.amount', label: 'Deal amount ($K)', type: 'currency' },
      { key: 'fields.weighted_amount', label: 'Weighted amount ($K)', type: 'currency' },
      { key: 'fields.forecast_category', label: 'Forecast category', type: 'category', colorSemantic: 'category' },
      { key: 'fields.probability', label: 'Probability (%)', type: 'number' },
      { key: 'owner_name', label: 'Owner', type: 'string' },
    ],
    defaultXField: 'fields.amount',
    defaultChartType: 'donut',
    defaultSort: { field: 'fields.amount', dir: 'desc' },
    defaultColorScheme: 'categorical',
    warnings: [],
  },
];

export function extractField(
  record: any,
  fieldKey: string,
  fieldDef: DataSourceField
): string | number {
  const val = fieldKey.split('.').reduce((obj: any, key: string) => obj?.[key], record);

  if (val === null || val === undefined) return 0;

  if (fieldDef.parse === 'float') return parseFloat(String(val)) || 0;
  if (fieldDef.parse === 'int') return parseInt(String(val), 10) || 0;
  if (fieldDef.type === 'currency' || fieldDef.type === 'number') return Number(val) || 0;
  return String(val);
}
