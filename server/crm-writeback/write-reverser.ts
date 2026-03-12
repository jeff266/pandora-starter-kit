import { query } from '../db.js';
import { logger } from '../logger.js';

export interface WriteReversalResult {
  success: boolean;
  write_log_id: string;
  reversal_log_id?: string;
  error?: string;
  already_reversed?: boolean;
  undo_window_expired?: boolean;
  hours_elapsed?: number;
}

/**
 * Reverse a CRM write by writing the previous value back to the CRM.
 * Creates a reversal log entry and marks the original write as reversed.
 *
 * Shared between route handler and Ask Pandora tool implementation.
 */
export async function reverseWrite(
  workspaceId: string,
  writeLogId: string,
  userId: string
): Promise<WriteReversalResult> {
  const startTime = Date.now();

  try {
    // Get write log entry with undo window settings
    const logResult = await query(
      `SELECT l.*, w.undo_window_hours
       FROM crm_write_log l
       LEFT JOIN workspace_action_settings w ON w.workspace_id = l.workspace_id
       WHERE l.id = $1 AND l.workspace_id = $2`,
      [writeLogId, workspaceId]
    );

    if (logResult.rows.length === 0) {
      return {
        success: false,
        write_log_id: writeLogId,
        error: 'Write log entry not found',
      };
    }

    const logEntry = logResult.rows[0];
    const undoWindowHours = logEntry.undo_window_hours || 24;

    // Check if already reversed
    if (logEntry.reversed_at) {
      return {
        success: false,
        write_log_id: writeLogId,
        error: `This write has already been reversed at ${logEntry.reversed_at}`,
        already_reversed: true,
      };
    }

    // Check if within undo window
    const writeTime = new Date(logEntry.created_at).getTime();
    const now = Date.now();
    const windowMs = undoWindowHours * 60 * 60 * 1000;
    const hoursElapsed = Math.floor((now - writeTime) / (60 * 60 * 1000));

    if (now - writeTime > windowMs) {
      return {
        success: false,
        write_log_id: writeLogId,
        error: `Undo window expired. This write can only be reversed within ${undoWindowHours} hours.`,
        undo_window_expired: true,
        hours_elapsed: hoursElapsed,
      };
    }

    // Check if previous_value exists
    if (!logEntry.previous_value) {
      return {
        success: false,
        write_log_id: writeLogId,
        error: 'No previous value recorded - this write cannot be reversed automatically',
      };
    }

    const previousValue = JSON.parse(logEntry.previous_value);
    const field = logEntry.crm_property_name;
    const crmType = logEntry.crm_type;
    const crmRecordId = logEntry.crm_record_id;

    // Import CRM writers
    const { updateDeal: updateHubSpotDeal } = await import('../connectors/hubspot/hubspot-writer.js');
    const { updateDeal: updateSalesforceDeal } = await import('../connectors/salesforce/salesforce-writer.js');

    try {
      // Write previous value back to CRM
      if (crmType === 'hubspot') {
        await updateHubSpotDeal(workspaceId, crmRecordId, {
          [field]: previousValue,
        });
      } else if (crmType === 'salesforce') {
        await updateSalesforceDeal(workspaceId, crmRecordId, {
          [field]: previousValue,
        });
      } else {
        return {
          success: false,
          write_log_id: writeLogId,
          error: `Unsupported CRM type: ${crmType}`,
        };
      }

      const durationMs = Date.now() - startTime;

      // Create reversal write log entry
      const reversalLogResult = await query(
        `INSERT INTO crm_write_log
          (workspace_id, crm_type, crm_object_type, crm_record_id, crm_property_name,
           value_written, trigger_source, status, duration_ms, reversal_write_log_id,
           previous_value, action_threshold_at_write, initiated_by, source_citation)
         VALUES ($1, $2, $3, $4, $5, $6, 'user_manual', 'success', $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          workspaceId,
          crmType,
          logEntry.crm_object_type,
          crmRecordId,
          field,
          JSON.stringify(previousValue),
          durationMs,
          writeLogId, // Points to original write being reversed
          logEntry.value_written, // The new value becomes the previous value
          logEntry.action_threshold_at_write,
          'user_manual',
          `Reversal of write ${writeLogId} by user`,
        ]
      );

      const reversalLogId = reversalLogResult.rows[0].id;

      // Mark original write as reversed
      await query(
        `UPDATE crm_write_log
         SET reversed_at = NOW(), reversed_by = $1, reversal_write_log_id = $2
         WHERE id = $3`,
        [userId, reversalLogId, writeLogId]
      );

      // Update local deal field (if deal)
      if (logEntry.crm_object_type === 'deal') {
        await query(
          `UPDATE deals
           SET ${field} = $1, updated_at = NOW()
           WHERE crm_id = $2 AND workspace_id = $3`,
          [previousValue, crmRecordId, workspaceId]
        );
      }

      logger.info('CRM write reversed successfully', {
        workspace_id: workspaceId,
        write_log_id: writeLogId,
        reversal_log_id: reversalLogId,
        field,
      });

      return {
        success: true,
        write_log_id: writeLogId,
        reversal_log_id: reversalLogId,
      };
    } catch (error: any) {
      logger.error('Failed to reverse CRM write', {
        workspace_id: workspaceId,
        write_log_id: writeLogId,
        error: error.message,
      });

      // Log the failed reversal attempt
      await query(
        `INSERT INTO crm_write_log
          (workspace_id, crm_type, crm_object_type, crm_record_id, crm_property_name,
           value_written, trigger_source, status, error_message, duration_ms, reversal_write_log_id, initiated_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'user_manual', 'failed', $7, $8, $9, $10)`,
        [
          workspaceId,
          crmType,
          logEntry.crm_object_type,
          crmRecordId,
          field,
          JSON.stringify(previousValue),
          error.message,
          Date.now() - startTime,
          writeLogId,
          'user_manual',
        ]
      );

      return {
        success: false,
        write_log_id: writeLogId,
        error: `Failed to reverse write: ${error.message}`,
      };
    }
  } catch (err: any) {
    logger.error('Failed to process reversal request', {
      workspace_id: workspaceId,
      write_log_id: writeLogId,
      error: err.message,
    });

    return {
      success: false,
      write_log_id: writeLogId,
      error: 'Internal server error',
    };
  }
}
