/**
 * Training Pair Logger
 *
 * Fire-and-forget service for capturing LLM call data as training pairs.
 * Used to build a fine-tuning dataset for Llama 3.1 8B on Fireworks.
 *
 * Every function catches its own errors — training logging must NEVER
 * break skill execution.
 */

import { query } from '../db.js';

// ============================================================================
// Types
// ============================================================================

export interface TrainingPairInput {
  workspaceId: string;
  capability: string;
  provider: string;
  model?: string;
  skillId?: string;
  skillRunId?: string;
  sourceContext?: string;
  systemPrompt?: string;
  userPrompt: string;
  assistantResponse: string;
  inputSchema?: any;
  outputSchema?: any;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Attempt to parse JSON from LLM output text.
 * Tries markdown code block extraction first, then raw parse.
 */
function tryParseJson(text: string): any | null {
  try {
    // Try markdown code block: ```json ... ```
    const codeBlockMatch = text.match(/```json\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      return JSON.parse(codeBlockMatch[1]);
    }

    // Try raw JSON if starts with { or [
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return JSON.parse(trimmed);
    }
  } catch {
    // Intentional: parsing failure is expected for non-JSON responses
  }
  return null;
}

// ============================================================================
// Exported Functions
// ============================================================================

/**
 * Log a single LLM call as a training pair.
 * Auto-detects output_schema by attempting JSON parse of the response.
 */
export async function logTrainingPair(input: TrainingPairInput): Promise<void> {
  try {
    const outputSchema = input.outputSchema ?? tryParseJson(input.assistantResponse);

    await query(
      `INSERT INTO training_pairs
        (workspace_id, capability, provider, model, skill_id, skill_run_id,
         source_context, system_prompt, user_prompt, assistant_response,
         input_schema, output_schema, input_tokens, output_tokens, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        input.workspaceId,
        input.capability,
        input.provider,
        input.model ?? null,
        input.skillId ?? null,
        input.skillRunId ?? null,
        input.sourceContext ?? null,
        input.systemPrompt ?? null,
        input.userPrompt,
        input.assistantResponse,
        input.inputSchema ? JSON.stringify(input.inputSchema) : null,
        outputSchema ? JSON.stringify(outputSchema) : null,
        input.inputTokens ?? null,
        input.outputTokens ?? null,
        input.latencyMs ?? null,
      ]
    );
  } catch (err) {
    console.warn('[TrainingLogger] Failed to log training pair:', (err as Error).message);
  }
}

/**
 * Manually score a training pair.
 */
export async function scoreTrainingPair(
  pairId: string,
  score: number,
  source: string
): Promise<void> {
  try {
    await query(
      `UPDATE training_pairs SET quality_score = $2, quality_source = $3 WHERE id = $1`,
      [pairId, score, source]
    );
  } catch (err) {
    console.warn('[TrainingLogger] Failed to score training pair:', (err as Error).message);
  }
}

/**
 * Auto-score all training pairs from a skill run based on run outcome.
 * Only updates pairs that haven't been manually scored yet.
 */
export async function scoreSkillRunPairs(
  skillRunId: string,
  runStatus: 'completed' | 'failed' | 'partial'
): Promise<void> {
  try {
    let score: number;
    let source: string;

    switch (runStatus) {
      case 'completed':
        score = 3;
        source = 'skill_success';
        break;
      case 'partial':
        score = 2;
        source = 'skill_failure';
        break;
      case 'failed':
        score = 1;
        source = 'skill_failure';
        break;
    }

    await query(
      `UPDATE training_pairs
       SET quality_score = $2, quality_source = $3
       WHERE skill_run_id = $1 AND quality_score IS NULL`,
      [skillRunId, score, source]
    );
  } catch (err) {
    console.warn('[TrainingLogger] Failed to score skill run pairs:', (err as Error).message);
  }
}

/**
 * Log a human override as a high-quality training pair.
 * The assistant_response stores the ORIGINAL output.
 * The override_value stores the CORRECTED output.
 */
export async function logOverride(
  workspaceId: string,
  sourceContext: string,
  originalInput: { systemPrompt?: string; userPrompt: string },
  originalOutput: string,
  correctedOutput: any,
  capability: string,
  provider: string
): Promise<void> {
  try {
    await query(
      `INSERT INTO training_pairs
        (workspace_id, capability, provider, source_context,
         system_prompt, user_prompt, assistant_response,
         override_value, was_overridden,
         quality_score, quality_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, 5, 'human_override')`,
      [
        workspaceId,
        capability,
        provider,
        sourceContext,
        originalInput.systemPrompt ?? null,
        originalInput.userPrompt,
        originalOutput,
        JSON.stringify(correctedOutput),
      ]
    );
  } catch (err) {
    console.warn('[TrainingLogger] Failed to log override:', (err as Error).message);
  }
}
