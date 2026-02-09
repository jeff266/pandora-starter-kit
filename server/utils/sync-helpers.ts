// Sync Helper Utilities
// Record-level error handling for resilient syncs
// Source: SYNC_FIELD_GUIDE.md Section 5

/**
 * Result of a sync operation with per-record error tracking
 */
export interface SyncResult<T> {
  /** Records that were successfully transformed/processed */
  succeeded: T[];
  /** Records that failed with error details */
  failed: Array<{
    record: unknown;
    error: string;
    recordId?: string; // Optional: extracted ID for logging
  }>;
  /** Total number of records attempted */
  totalAttempted: number;
}

/**
 * Transform an array of records with per-record error capture.
 *
 * WHEN TO USE:
 * - Processing arrays of records from any connector
 * - Transforming raw API data to database rows
 * - Anywhere one bad record shouldn't kill the entire batch
 *
 * WHEN NOT TO USE:
 * - Single record operations (just let them throw)
 * - API-level errors (those should be retried, not skipped)
 *
 * @param records - Array of raw records to transform
 * @param transformFn - Function that transforms a single record
 * @param label - Label for logging (e.g., "HubSpot Deals")
 * @param extractId - Optional function to extract record ID for logging
 * @returns SyncResult with succeeded and failed arrays
 *
 * @example
 * ```typescript
 * const result = transformWithErrorCapture(
 *   rawDeals,
 *   (deal) => transformDeal(deal, workspaceId),
 *   'HubSpot Deals',
 *   (deal) => deal.id
 * );
 *
 * await insertDeals(result.succeeded);
 * logErrors(result.failed);
 * ```
 */
export function transformWithErrorCapture<TInput, TOutput>(
  records: TInput[],
  transformFn: (record: TInput) => TOutput,
  label: string,
  extractId?: (record: TInput) => string
): SyncResult<TOutput> {
  const result: SyncResult<TOutput> = {
    succeeded: [],
    failed: [],
    totalAttempted: records.length,
  };

  for (const record of records) {
    try {
      const transformed = transformFn(record);
      result.succeeded.push(transformed);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const recordId = extractId ? extractId(record) : undefined;

      result.failed.push({
        record,
        error: errorMessage,
        recordId,
      });
    }
  }

  // Log warning if any records failed
  if (result.failed.length > 0) {
    const failureRate = ((result.failed.length / result.totalAttempted) * 100).toFixed(1);

    console.warn(
      `[${label}] ${result.failed.length}/${result.totalAttempted} records failed transform (${failureRate}%). ` +
      `First error: ${result.failed[0].error}` +
      (result.failed[0].recordId ? ` (ID: ${result.failed[0].recordId})` : '')
    );

    // If failure rate is high, log more details
    if (result.failed.length > 10 || result.failed.length / result.totalAttempted > 0.1) {
      console.error(
        `[${label}] High failure rate detected. First 5 errors:`,
        result.failed.slice(0, 5).map(f => ({
          id: f.recordId,
          error: f.error,
        }))
      );
    }
  }

  return result;
}

/**
 * Batch process records with per-record error handling.
 *
 * Similar to transformWithErrorCapture, but for async operations like database inserts.
 *
 * WHEN TO USE:
 * - Batch database inserts where one bad record shouldn't fail the batch
 * - Async API calls for each record
 * - Any async operation on an array of items
 *
 * @param records - Array of records to process
 * @param processFn - Async function that processes a single record
 * @param label - Label for logging
 * @param extractId - Optional function to extract record ID
 * @returns SyncResult with succeeded and failed arrays
 *
 * @example
 * ```typescript
 * const result = await processWithErrorCapture(
 *   deals,
 *   async (deal) => await db.insertDeal(deal),
 *   'Deal Insert',
 *   (deal) => deal.source_id
 * );
 * ```
 */
export async function processWithErrorCapture<TInput, TOutput>(
  records: TInput[],
  processFn: (record: TInput) => Promise<TOutput>,
  label: string,
  extractId?: (record: TInput) => string
): Promise<SyncResult<TOutput>> {
  const result: SyncResult<TOutput> = {
    succeeded: [],
    failed: [],
    totalAttempted: records.length,
  };

  for (const record of records) {
    try {
      const output = await processFn(record);
      result.succeeded.push(output);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const recordId = extractId ? extractId(record) : undefined;

      result.failed.push({
        record,
        error: errorMessage,
        recordId,
      });
    }
  }

  // Log warning if any records failed
  if (result.failed.length > 0) {
    const failureRate = ((result.failed.length / result.totalAttempted) * 100).toFixed(1);

    console.warn(
      `[${label}] ${result.failed.length}/${result.totalAttempted} records failed processing (${failureRate}%). ` +
      `First error: ${result.failed[0].error}` +
      (result.failed[0].recordId ? ` (ID: ${result.failed[0].recordId})` : '')
    );
  }

  return result;
}

/**
 * Combines transform and process with error capture.
 *
 * Common pattern: Transform raw data → Insert to database, with error handling at both stages.
 *
 * @param records - Raw records from API
 * @param transformFn - Synchronous transform function
 * @param processFn - Async process function (e.g., database insert)
 * @param label - Label for logging
 * @param extractId - Optional ID extractor for raw records
 * @returns Combined sync result
 */
export async function transformAndProcess<TInput, TTransformed, TOutput>(
  records: TInput[],
  transformFn: (record: TInput) => TTransformed,
  processFn: (transformed: TTransformed) => Promise<TOutput>,
  label: string,
  extractId?: (record: TInput) => string
): Promise<{
  transformResult: SyncResult<TTransformed>;
  processResult: SyncResult<TOutput>;
}> {
  // Step 1: Transform with error capture
  const transformResult = transformWithErrorCapture(
    records,
    transformFn,
    `${label} Transform`,
    extractId
  );

  // Step 2: Process transformed records with error capture
  const processResult = await processWithErrorCapture(
    transformResult.succeeded,
    processFn,
    `${label} Process`,
    // For transformed records, we don't have the original ID extraction
  );

  return {
    transformResult,
    processResult,
  };
}

/**
 * Calculate success rate for a sync result
 */
export function calculateSuccessRate<T>(result: SyncResult<T>): number {
  if (result.totalAttempted === 0) return 100;
  return (result.succeeded.length / result.totalAttempted) * 100;
}

/**
 * Check if a sync result is acceptable (>95% success rate)
 */
export function isSyncAcceptable<T>(result: SyncResult<T>, threshold: number = 95): boolean {
  return calculateSuccessRate(result) >= threshold;
}
