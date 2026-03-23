/**
 * Filter Summary Generator
 *
 * Converts BusinessDimension filter definitions into plain English descriptions.
 * Used for WBR/QBR section labels and tooltips.
 */

import type { BusinessDimension, FilterCondition, DimensionFilter } from './data-dictionary.js';

function conditionToEnglish(c: FilterCondition): string {
  const field = c.field_label || c.field;

  switch (c.operator) {
    case 'equals':
      return `${field} = ${c.value_label || c.value}`;

    case 'not_equals':
      return `${field} ≠ ${c.value_label || c.value}`;

    case 'in':
      if (Array.isArray(c.value)) {
        const values = c.value.map((v: any) => formatValue(v)).join(', ');
        return `${field} in [${values}]`;
      }
      return `${field} = ${c.value_label || c.value}`;

    case 'not_in':
      if (Array.isArray(c.value)) {
        const values = c.value.map((v: any) => formatValue(v)).join(', ');
        return `${field} not in [${values}]`;
      }
      return `${field} ≠ ${c.value_label || c.value}`;

    case 'contains':
      return `${field} contains "${c.value}"`;

    case 'not_contains':
      return `${field} does not contain "${c.value}"`;

    case 'greater_than':
      return `${field} > ${formatValue(c.value)}`;

    case 'less_than':
      return `${field} < ${formatValue(c.value)}`;

    case 'greater_than_or_equal':
      return `${field} ≥ ${formatValue(c.value)}`;

    case 'less_than_or_equal':
      return `${field} ≤ ${formatValue(c.value)}`;

    case 'is_null':
      return `${field} is empty`;

    case 'is_not_null':
      return `${field} is not empty`;

    case 'this_quarter':
      return `${field} this quarter`;

    case 'last_quarter':
      return `${field} last quarter`;

    case 'next_quarter':
      return `${field} next quarter`;

    case 'trailing_30d':
      return `${field} last 30 days`;

    case 'trailing_90d':
      return `${field} last 90 days`;

    case 'custom_date_range':
      if (c.value?.start && c.value?.end) {
        return `${field} between ${formatDate(c.value.start)} and ${formatDate(c.value.end)}`;
      }
      if (c.value?.start) {
        return `${field} after ${formatDate(c.value.start)}`;
      }
      if (c.value?.end) {
        return `${field} before ${formatDate(c.value.end)}`;
      }
      return field;

    default:
      return `${field} = ${c.value_label || c.value}`;
  }
}

function formatValue(value: any): string {
  if (typeof value === 'number') {
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}K`;
    }
    return `$${value}`;
  }
  return String(value);
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function filterToEnglish(filter: DimensionFilter, depth = 0): string {
  const parts: string[] = [];

  for (const condition of filter.conditions) {
    if ('operator' in condition && 'conditions' in condition) {
      // Nested filter
      const nested = filterToEnglish(condition as DimensionFilter, depth + 1);
      parts.push(`(${nested})`);
    } else {
      // Leaf condition
      parts.push(conditionToEnglish(condition as FilterCondition));
    }
  }

  const connector = filter.operator === 'AND' ? ' and ' : ' or ';
  return parts.join(connector);
}

export async function buildFilterSummary(dim: BusinessDimension): Promise<string> {
  const filterText = filterToEnglish(dim.filter_definition);

  // Add value field note if not standard amount
  const valueNote = dim.value_field !== 'amount'
    ? ` (using ${dim.value_field_label})`
    : '';

  // Capitalize first letter
  const summary = filterText.charAt(0).toUpperCase() + filterText.slice(1);

  return summary + valueNote;
}
