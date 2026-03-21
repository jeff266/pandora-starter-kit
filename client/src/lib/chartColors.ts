import type { DataSourceDef } from './chartDataSources';

export const SEMANTIC_COLORS = {
  critical: '#EF4444',
  warning:  '#F59E0B',
  healthy:  '#0D9488',
  high:     '#EF4444',
  medium:   '#F59E0B',
  low:      '#0D9488',
  stale:    '#EF4444',
  fresh:    '#0D9488',
  closed:     '#0D9488',
  commit:     '#0D9488',
  best_case:  '#F59E0B',
  pipeline:   '#CBD5E1',
  omitted:    '#94A3B8',
  uniform:  '#0D9488',
  fallback: '#CBD5E1',
  // Deliberation panel roles
  'bull':        '#F59E0B',   // amber — optimistic
  'bear':        '#94A3B8',   // muted gray — skeptical
  'skeptic':     '#94A3B8',   // same as bear
  'advocate':    '#14B8A6',   // teal — supportive
  'prosecutor':  '#F97316',   // coral — adversarial
  'defense':     '#14B8A6',   // teal — protective
  'synthesis':   '#6366F1',   // indigo — resolution
  'verdict':     '#6366F1',   // indigo — conclusion
  // Forecast landing zones (used in forecast charts)
  'bear case':   '#94A3B8',
  'base case':   '#14B8A6',
  'bull case':   '#F59E0B',
  'upside':      '#F59E0B',
  'downside':    '#F97316',
} as const;

export const COLOR_HINT_MAP = {
  'bull':              '#F59E0B',
  'bear':              '#94A3B8',
  'prosecutor':        '#F97316',
  'defense':           '#14B8A6',
  'synthesis':         '#6366F1',
  'optimistic':        '#F59E0B',
  'pessimistic':       '#94A3B8',
  'stress_test':       '#F97316',
} as const;

export function resolveColor(
  record: any,
  colorScheme: string,
  _dataSource: DataSourceDef,
  uniformColor = '#0D9488'
): string {
  if (colorScheme === 'uniform') return uniformColor;

  if (colorScheme === 'semantic') {
    const severity = record.severity || record.flags?.risk_level || record.flags?.stale_flag;
    if (severity && SEMANTIC_COLORS[severity as keyof typeof SEMANTIC_COLORS]) {
      return SEMANTIC_COLORS[severity as keyof typeof SEMANTIC_COLORS];
    }
    const days = record.fields?.days_since_activity;
    if (typeof days === 'number') {
      if (days > 100) return SEMANTIC_COLORS.critical;
      if (days > 30) return SEMANTIC_COLORS.warning;
      return SEMANTIC_COLORS.healthy;
    }
  }

  if (colorScheme === 'categorical') {
    const cat = record.fields?.forecast_category;
    if (cat && SEMANTIC_COLORS[cat as keyof typeof SEMANTIC_COLORS]) {
      return SEMANTIC_COLORS[cat as keyof typeof SEMANTIC_COLORS];
    }
  }

  return uniformColor;
}
