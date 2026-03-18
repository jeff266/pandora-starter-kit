/**
 * Value Resolver - Economic value calculation for deals
 *
 * This is the ONLY place deal value is calculated.
 * All skills call resolveValue() instead of d.amount.
 *
 * Resolves the economic value of a deal based on the pipeline's
 * value_field and value_formula config. Non-fatal: if field missing
 * or formula errors, falls back to deal.amount or 0.
 */

import { PipelineConfig } from '../types/workspace-config.js';

/**
 * Resolves the economic value of a deal based on
 * the pipeline's value_field and value_formula config.
 *
 * Non-fatal: if field missing or formula errors,
 * falls back to deal.amount or 0.
 */
export function resolveValue(
  deal: Record<string, any>,
  pipelineConfig: Pick<PipelineConfig, 'value_field' | 'value_formula'>
): number {

  try {
    // Formula takes precedence over field
    if (pipelineConfig.value_formula) {
      return evaluateFormula(deal, pipelineConfig.value_formula);
    }

    // Field lookup — supports dot notation
    const value = getNestedField(deal, pipelineConfig.value_field);

    if (value !== null && value !== undefined) {
      const num = Number(value);
      if (!isNaN(num)) return num;
    }

    // Fallback to amount
    const fallback = Number(deal.amount || deal.properties?.amount || 0);
    return isNaN(fallback) ? 0 : fallback;

  } catch (err) {
    console.warn('[ValueResolver] Failed to resolve value:', err);
    return Number(deal.amount || 0) || 0;
  }
}

/**
 * Supported formula variables:
 *   {amount}, {arr_value}, {acv_amount},
 *   {contract_months}, {mrr}, {arr}
 *
 * Supported operators: + - * / || (coalesce)
 * No eval() — explicit safe parser only.
 */
function evaluateFormula(
  deal: Record<string, any>,
  formula: string
): number {

  // Coalesce operator: '{acv_amount} || {amount}'
  // Returns first non-zero value
  if (formula.includes('||')) {
    const parts = formula.split('||').map(p => p.trim());
    for (const part of parts) {
      const val = evaluateFormula(deal, part);
      if (val > 0) return val;
    }
    return 0;
  }

  // Substitute variables
  let expr = formula;
  const VARS = [
    'amount', 'arr_value', 'acv_amount',
    'contract_months', 'mrr', 'arr',
  ];

  for (const varName of VARS) {
    const pattern = new RegExp(`\\{${varName}\\}`, 'g');
    const value = getNestedField(deal, varName) || 0;
    expr = expr.replace(pattern, String(Number(value)));
  }

  // Safe arithmetic evaluation
  // Only allow: numbers, spaces, + - * / ( )
  if (!/^[\d\s\+\-\*\/\(\)\.]+$/.test(expr)) {
    throw new Error(`Unsafe formula after substitution: ${expr}`);
  }

  // Use Function constructor instead of eval
  // eslint-disable-next-line no-new-func
  const result = Function(`"use strict"; return (${expr})`)();

  return isNaN(result) || !isFinite(result) ? 0 : result;
}

function getNestedField(
  obj: Record<string, any>,
  path: string
): any {
  return path.split('.').reduce(
    (o, k) => (o != null ? o[k] : null), obj
  );
}

/**
 * Convenience: resolve value with workspace config
 * lookup included. Finds the right pipeline config
 * for a deal and resolves its value.
 */
export function resolveValueWithPipeline(
  deal: Record<string, any>,
  pipelines: PipelineConfig[]
): number {

  // Find which pipeline this deal belongs to
  const pipeline = findDealPipeline(deal, pipelines);
  if (!pipeline) {
    // No pipeline match — use amount as fallback
    return Number(deal.amount || 0) || 0;
  }

  return resolveValue(deal, pipeline);
}

function findDealPipeline(
  deal: Record<string, any>,
  pipelines: PipelineConfig[]
): PipelineConfig | null {

  for (const pipeline of pipelines) {
    if (!pipeline.filter?.field || !pipeline.filter?.values?.length) {
      continue;
    }

    const dealFieldValue = getNestedField(deal, pipeline.filter.field);

    if (pipeline.filter.values.includes(String(dealFieldValue))) {
      return pipeline;
    }
  }

  // Return first pipeline as fallback
  return pipelines[0] || null;
}
