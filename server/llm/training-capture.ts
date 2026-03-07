import { query } from '../db.js';

/**
 * Captures a classification pair where a contradiction was detected.
 * This signals that the original classification might have been wrong or led to a poor response.
 */
export async function captureContradictionClassificationPair(
  workspaceId: string,
  originalClassification: any,
  correctedClassification: any,
  systemPromptUsed: string
) {
  try {
    const userMessage = originalClassification.userMessage || '';
    const rawOutput = JSON.stringify(originalClassification);
    const correctedOutput = JSON.stringify(correctedClassification);

    await query(
      `INSERT INTO document_training_pairs 
       (workspace_id, pair_type, quality_label, edit_distance, correction_signal, 
        prompt_text, raw_output, corrected_output, template_type, section_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, NULL)`,
      [
        workspaceId,
        'classification',
        'poor',
        1.0,
        'contradiction_handler',
        systemPromptUsed + "\n\nUser: " + userMessage,
        rawOutput,
        correctedOutput
      ]
    );
  } catch (err) {
    console.error('[training-capture] Failed to capture contradiction pair:', err);
  }
}

/**
 * Captures a classification pair that was successful (no contradiction).
 */
export async function captureSuccessfulClassificationPair(
  workspaceId: string,
  classification: any,
  systemPromptUsed: string
) {
  try {
    const userMessage = classification.userMessage || '';
    const rawOutput = JSON.stringify(classification);

    await query(
      `INSERT INTO document_training_pairs 
       (workspace_id, pair_type, quality_label, edit_distance, 
        prompt_text, raw_output, corrected_output, template_type, section_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL)`,
      [
        workspaceId,
        'classification',
        'good',
        0.0,
        systemPromptUsed + "\n\nUser: " + userMessage,
        rawOutput,
        rawOutput
      ]
    );
  } catch (err) {
    console.error('[training-capture] Failed to capture successful pair:', err);
  }
}

/**
 * Captures a classification pair that led to a strategic routing miss.
 */
export async function captureStrategicRoutingMiss(
  workspaceId: string,
  originalClassification: any,
  systemPromptUsed: string
) {
  try {
    const userMessage = originalClassification.userMessage || '';
    const rawOutput = JSON.stringify(originalClassification);

    await query(
      `INSERT INTO document_training_pairs 
       (workspace_id, pair_type, quality_label, edit_distance, correction_signal, 
        prompt_text, raw_output, template_type, section_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL)`,
      [
        workspaceId,
        'classification',
        'poor',
        1.0,
        'strategic_routing_miss',
        systemPromptUsed + "\n\nUser: " + userMessage,
        rawOutput
      ]
    );
  } catch (err) {
    console.error('[training-capture] Failed to capture routing miss pair:', err);
  }
}
