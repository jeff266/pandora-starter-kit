/**
 * Inbound Webhook Handler
 *
 * Processes enrichment data received from third-party tools (Clay, Zapier, Make, etc.).
 * Implements idempotency via pandora_batch_id deduplication and 207 Multi-Status responses.
 */

import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { normalizeWebhookRecord, validateInboundPayload, type WebhookRecord } from './webhook-normalizer.js';
import { calculateConfidenceScore } from './confidence-scorer.js';
import { matchEnrichedAccount } from './account-matcher.js';

const logger = createLogger('Webhook Inbound');

export interface InboundPayload {
  pandora_batch_id: string;
  records: WebhookRecord[];
}

export interface ProcessingResult {
  status: 'success' | 'partial' | 'error';
  status_code: number;
  records_received: number;
  records_processed: number;
  records_matched: number;
  records_failed: number;
  errors: Array<{
    record_index: number;
    domain?: string;
    company_name?: string;
    error: string;
  }>;
  duplicate_batch?: boolean;
}

/**
 * Process inbound webhook payload.
 * Returns 207 Multi-Status for partial success, 200 for full success.
 */
export async function processInboundWebhook(
  workspaceId: string,
  payload: InboundPayload
): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    status: 'success',
    status_code: 200,
    records_received: payload.records?.length || 0,
    records_processed: 0,
    records_matched: 0,
    records_failed: 0,
    errors: [],
  };

  try {
    // Validate payload structure
    const validation = validateInboundPayload(payload);
    if (!validation.valid) {
      logger.warn('Invalid inbound payload', {
        workspace_id: workspaceId,
        errors: validation.errors,
      });
      return {
        status: 'error',
        status_code: 400,
        records_received: 0,
        records_processed: 0,
        records_matched: 0,
        records_failed: 0,
        errors: validation.errors.map((error, index) => ({
          record_index: -1,
          error,
        })),
      };
    }

    // Check for duplicate batch_id (idempotency)
    const isDuplicate = await checkDuplicateBatch(workspaceId, payload.pandora_batch_id);
    if (isDuplicate) {
      logger.info('Duplicate batch_id detected, skipping processing', {
        workspace_id: workspaceId,
        batch_id: payload.pandora_batch_id,
      });
      return {
        status: 'success',
        status_code: 200,
        records_received: payload.records.length,
        records_processed: 0,
        records_matched: 0,
        records_failed: 0,
        errors: [],
        duplicate_batch: true,
      };
    }

    // Process each record
    for (let i = 0; i < payload.records.length; i++) {
      const record = payload.records[i];

      try {
        // Normalize record
        const { data, errors: normErrors } = normalizeWebhookRecord(record);

        if (normErrors.length > 0) {
          result.errors.push({
            record_index: i,
            domain: record.domain || undefined,
            company_name: record.company_name || undefined,
            error: normErrors.join('; '),
          });
          result.records_failed++;
          continue;
        }

        // Match to CRM account
        const match = await matchEnrichedAccount(workspaceId, data.domain ?? null, data.company_name ?? null);

        if (match.match_type === 'none' || !match.crm_account_id) {
          result.errors.push({
            record_index: i,
            domain: data.domain || undefined,
            company_name: data.company_name || undefined,
            error: 'No matching CRM account found',
          });
          result.records_failed++;
          continue;
        }

        // Calculate confidence score
        const confidenceScore = calculateConfidenceScore(data);

        // Save enriched account
        await saveEnrichedAccount(
          workspaceId,
          match.crm_account_id,
          data,
          confidenceScore,
          payload.pandora_batch_id
        );

        result.records_processed++;
        result.records_matched++;

        logger.debug('Webhook record processed', {
          workspace_id: workspaceId,
          domain: data.domain,
          company_name: data.company_name,
          crm_account_id: match.crm_account_id,
          match_type: match.match_type,
          confidence: confidenceScore,
        });
      } catch (error) {
        logger.error('Failed to process webhook record', {
          workspace_id: workspaceId,
          record_index: i,
          error: error instanceof Error ? error.message : String(error),
        });
        result.errors.push({
          record_index: i,
          domain: record.domain || undefined,
          company_name: record.company_name || undefined,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        result.records_failed++;
      }
    }

    // Log inbound processing
    await logInboundProcessing(workspaceId, payload.pandora_batch_id, result);

    // Determine status
    if (result.records_failed > 0 && result.records_matched > 0) {
      result.status = 'partial';
      result.status_code = 207; // Multi-Status
    } else if (result.records_failed === result.records_received) {
      result.status = 'error';
      result.status_code = 422; // Unprocessable Entity
    }

    logger.info('Inbound webhook processing complete', {
      workspace_id: workspaceId,
      batch_id: payload.pandora_batch_id,
      status: result.status,
      status_code: result.status_code,
      received: result.records_received,
      matched: result.records_matched,
      failed: result.records_failed,
    });

    return result;
  } catch (error) {
    logger.error('Inbound webhook processing error', {
      workspace_id: workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Check if batch_id has already been processed (idempotency).
 */
async function checkDuplicateBatch(workspaceId: string, batchId: string): Promise<boolean> {
  const existing = await query(
    `SELECT id FROM webhook_inbound_log
     WHERE workspace_id = $1
       AND batch_id = $2
     LIMIT 1`,
    [workspaceId, batchId]
  );

  return existing.rows.length > 0;
}

/**
 * Log inbound processing result.
 */
async function logInboundProcessing(
  workspaceId: string,
  batchId: string,
  result: ProcessingResult
): Promise<void> {
  await query(
    `INSERT INTO webhook_inbound_log
     (workspace_id, batch_id, records_received, records_processed, records_matched, records_failed, error_details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (workspace_id, batch_id) DO NOTHING`,
    [
      workspaceId,
      batchId,
      result.records_received,
      result.records_processed,
      result.records_matched,
      result.records_failed,
      JSON.stringify(result.errors),
    ]
  );
}

/**
 * Save enriched account to database.
 */
async function saveEnrichedAccount(
  workspaceId: string,
  crmAccountId: string,
  data: any,
  confidenceScore: number,
  batchId: string
): Promise<void> {
  try {
    // Check if record already exists
    const existing = await query(
      `SELECT id FROM enriched_accounts
       WHERE workspace_id = $1
         AND crm_account_id = $2
         AND enrichment_source = 'webhook'
         AND pandora_batch_id = $3`,
      [workspaceId, crmAccountId, batchId]
    );

    if (existing.rows.length > 0) {
      // Update existing record
      await query(
        `UPDATE enriched_accounts
         SET domain = $1,
             company_name = $2,
             industry = $3,
             employee_count = $4,
             employee_range = $5,
             revenue_range = $6,
             funding_stage = $7,
             hq_country = $8,
             hq_state = $9,
             hq_city = $10,
             tech_stack = $11,
             growth_signal = $12,
             founded_year = $13,
             public_or_private = $14,
             confidence_score = $15,
             enriched_at = NOW(),
             updated_at = NOW()
         WHERE id = $16`,
        [
          data.domain,
          data.company_name,
          data.industry,
          data.employee_count,
          data.employee_range,
          data.revenue_range,
          data.funding_stage,
          data.hq_country,
          data.hq_state,
          data.hq_city,
          data.tech_stack,
          data.growth_signal,
          data.founded_year,
          data.public_or_private,
          confidenceScore,
          existing.rows[0].id,
        ]
      );

      logger.debug('Updated existing webhook enrichment record', {
        record_id: existing.rows[0].id,
        crm_account_id: crmAccountId,
      });
    } else {
      // Insert new record
      await query(
        `INSERT INTO enriched_accounts (
           workspace_id,
           crm_account_id,
           domain,
           company_name,
           industry,
           employee_count,
           employee_range,
           revenue_range,
           funding_stage,
           hq_country,
           hq_state,
           hq_city,
           tech_stack,
           growth_signal,
           founded_year,
           public_or_private,
           enrichment_source,
           confidence_score,
           pandora_batch_id,
           enriched_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'webhook', $17, $18, NOW())`,
        [
          workspaceId,
          crmAccountId,
          data.domain,
          data.company_name,
          data.industry,
          data.employee_count,
          data.employee_range,
          data.revenue_range,
          data.funding_stage,
          data.hq_country,
          data.hq_state,
          data.hq_city,
          data.tech_stack,
          data.growth_signal,
          data.founded_year,
          data.public_or_private,
          confidenceScore,
          batchId,
        ]
      );

      logger.debug('Inserted new webhook enrichment record', {
        crm_account_id: crmAccountId,
      });
    }
  } catch (error) {
    logger.error('Failed to save enriched account', {
      crm_account_id: crmAccountId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get inbound processing history for a workspace.
 */
export async function getInboundHistory(
  workspaceId: string,
  limit: number = 50
): Promise<Array<{
  batch_id: string;
  records_received: number;
  records_processed: number;
  records_matched: number;
  records_failed: number;
  received_at: Date;
  error_details?: any;
}>> {
  try {
    const result = await query<{
      batch_id: string;
      records_received: number;
      records_processed: number;
      records_matched: number;
      records_failed: number;
      received_at: Date;
      error_details: any;
    }>(
      `SELECT batch_id, records_received, records_processed, records_matched, records_failed, received_at, error_details
       FROM webhook_inbound_log
       WHERE workspace_id = $1
       ORDER BY received_at DESC
       LIMIT $2`,
      [workspaceId, limit]
    );

    return result.rows;
  } catch (error) {
    logger.error('Failed to get inbound history', {
      workspace_id: workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
