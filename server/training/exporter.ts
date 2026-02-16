/**
 * Training Data Exporter
 *
 * Exports captured training pairs as Fireworks-compatible JSONL
 * for fine-tuning Llama 3.1 8B on GTM classification tasks.
 *
 * Also provides stats and cost estimation for monitoring
 * the training data pipeline.
 */

import { query } from '../db.js';

// ============================================================================
// Types
// ============================================================================

export interface ExportOptions {
  capability: string;
  minQuality?: number;
  includeOverrides?: boolean;
  excludeWorkspaces?: string[];
  limit?: number;
}

export interface ExportResult {
  jsonl: string;
  pairCount: number;
  tokenEstimate: number;
}

export interface TrainingStats {
  byCapability: Array<{
    capability: string;
    total_pairs: number;
    quality_pairs: number;
    override_pairs: number;
    exported_pairs: number;
    ready_to_export: number;
    avg_input_tokens: number;
    avg_output_tokens: number;
  }>;
  total: number;
  readyToExport: number;
}

// ============================================================================
// Export Functions
// ============================================================================

/**
 * Export training pairs as Fireworks-compatible JSONL for fine-tuning.
 *
 * - Overridden pairs use the corrected output (override_value), not the original
 * - Marks all exported rows with exported_at and export_batch
 * - Returns empty result if no qualifying pairs exist
 */
export async function exportTrainingData(
  options: ExportOptions
): Promise<ExportResult> {
  const minQuality = options.minQuality ?? 3;
  const includeOverrides = options.includeOverrides ?? true;

  const conditions: string[] = [
    'capability = $1',
    'quality_score >= $2',
    'exported_at IS NULL',
  ];
  const params: any[] = [options.capability, minQuality];
  let paramIdx = 3;

  if (!includeOverrides) {
    conditions.push('was_overridden = FALSE');
  }

  if (options.excludeWorkspaces && options.excludeWorkspaces.length > 0) {
    conditions.push(`workspace_id != ALL($${paramIdx}::uuid[])`);
    params.push(options.excludeWorkspaces);
    paramIdx++;
  }

  let limitClause = '';
  if (options.limit) {
    limitClause = `LIMIT $${paramIdx}`;
    params.push(options.limit);
  }

  const result = await query<{
    id: string;
    system_prompt: string | null;
    user_prompt: string;
    assistant_response: string;
    was_overridden: boolean;
    override_value: any;
    input_tokens: number | null;
    output_tokens: number | null;
  }>(
    `SELECT id, system_prompt, user_prompt, assistant_response,
            was_overridden, override_value, input_tokens, output_tokens
     FROM training_pairs
     WHERE ${conditions.join(' AND ')}
     ORDER BY was_overridden DESC, quality_score DESC, created_at ASC
     ${limitClause}`,
    params
  );

  if (result.rows.length === 0) {
    return { jsonl: '', pairCount: 0, tokenEstimate: 0 };
  }

  const lines: string[] = [];
  let tokenEstimate = 0;
  const ids: string[] = [];

  for (const row of result.rows) {
    const messages: Array<{ role: string; content: string }> = [];

    if (row.system_prompt) {
      messages.push({ role: 'system', content: row.system_prompt });
    }

    messages.push({ role: 'user', content: row.user_prompt });

    // For overridden pairs, use the corrected output
    const assistantContent = row.was_overridden && row.override_value
      ? (typeof row.override_value === 'string'
          ? row.override_value
          : JSON.stringify(row.override_value))
      : row.assistant_response;

    messages.push({ role: 'assistant', content: assistantContent });

    lines.push(JSON.stringify({ messages }));
    ids.push(row.id);
    tokenEstimate += (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
  }

  // Mark exported rows
  const batchName = `${options.capability}-${new Date().toISOString().split('T')[0]}`;
  await query(
    `UPDATE training_pairs
     SET exported_at = NOW(), export_batch = $2
     WHERE id = ANY($1::uuid[])`,
    [ids, batchName]
  );

  return {
    jsonl: lines.join('\n'),
    pairCount: lines.length,
    tokenEstimate,
  };
}

/**
 * Get aggregate statistics about captured training pairs.
 */
export async function getTrainingStats(): Promise<TrainingStats> {
  const result = await query<{
    capability: string;
    total_pairs: string;
    quality_pairs: string;
    override_pairs: string;
    exported_pairs: string;
    ready_to_export: string;
    avg_input_tokens: string | null;
    avg_output_tokens: string | null;
  }>(
    `SELECT
      capability,
      COUNT(*) AS total_pairs,
      COUNT(*) FILTER (WHERE quality_score >= 3) AS quality_pairs,
      COUNT(*) FILTER (WHERE was_overridden) AS override_pairs,
      COUNT(*) FILTER (WHERE exported_at IS NOT NULL) AS exported_pairs,
      COUNT(*) FILTER (WHERE exported_at IS NULL AND quality_score >= 3) AS ready_to_export,
      ROUND(AVG(input_tokens)) AS avg_input_tokens,
      ROUND(AVG(output_tokens)) AS avg_output_tokens
     FROM training_pairs
     GROUP BY capability
     ORDER BY capability`
  );

  let total = 0;
  let readyToExport = 0;

  const byCapability = result.rows.map(row => {
    const entry = {
      capability: row.capability,
      total_pairs: parseInt(row.total_pairs, 10),
      quality_pairs: parseInt(row.quality_pairs, 10),
      override_pairs: parseInt(row.override_pairs, 10),
      exported_pairs: parseInt(row.exported_pairs, 10),
      ready_to_export: parseInt(row.ready_to_export, 10),
      avg_input_tokens: parseInt(row.avg_input_tokens ?? '0', 10),
      avg_output_tokens: parseInt(row.avg_output_tokens ?? '0', 10),
    };
    total += entry.total_pairs;
    readyToExport += entry.ready_to_export;
    return entry;
  });

  return { byCapability, total, readyToExport };
}

/**
 * Estimate the cost of fine-tuning on Fireworks with the available data.
 *
 * Uses Llama 3.1 8B pricing: ~$0.50 per 1M training tokens.
 */
export async function getFineTuningCostEstimate(
  capability: string,
  epochs: number = 3
): Promise<{
  pairsAvailable: number;
  estimatedTokens: number;
  trainingTokens: number;
  estimatedCost: number;
  modelSize: string;
}> {
  const result = await query<{
    pair_count: string;
    total_tokens: string;
  }>(
    `SELECT
      COUNT(*) AS pair_count,
      COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) AS total_tokens
     FROM training_pairs
     WHERE capability = $1 AND quality_score >= 3`,
    [capability]
  );

  const row = result.rows[0];
  const pairsAvailable = parseInt(row.pair_count, 10);
  const estimatedTokens = parseInt(row.total_tokens, 10);
  const trainingTokens = estimatedTokens * epochs;
  const estimatedCost = (trainingTokens / 1_000_000) * 0.50;

  return {
    pairsAvailable,
    estimatedTokens,
    trainingTokens,
    estimatedCost,
    modelSize: 'llama-3.1-8b',
  };
}
