// Throttled Fetch Utilities
// Prevents rate limit errors by throttling outbound requests
// Source: SYNC_FIELD_GUIDE.md Section 2

/**
 * Configuration for throttled fetcher
 */
export interface ThrottleConfig {
  /** Max requests per window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Optional: minimum delay between requests in ms (use for Search API) */
  minDelayMs?: number;
}

/**
 * Creates a throttled fetch wrapper that respects rate limits.
 *
 * WHEN TO USE:
 * - Any connector doing paginated fetches (10+ pages expected)
 * - Any sync that runs against the Search API
 * - Multi-workspace syncs sharing an OAuth app
 *
 * WHEN TO SKIP:
 * - Single API calls (testConnection, health checks)
 * - Bulk/export API calls (they have their own concurrency model)
 *
 * @param config - Throttle configuration
 * @returns Throttled fetch function
 */
export function createThrottledFetcher(config: ThrottleConfig) {
  const timestamps: number[] = [];

  return async function throttledFetch(
    url: string,
    options?: RequestInit
  ): Promise<Response> {
    const now = Date.now();

    // Remove timestamps outside the current window
    while (timestamps.length > 0 && timestamps[0] < now - config.windowMs) {
      timestamps.shift();
    }

    // If at capacity, wait until the oldest request exits the window
    if (timestamps.length >= config.maxRequests) {
      const oldestTimestamp = timestamps[0];
      const waitMs = oldestTimestamp + config.windowMs - now + 50; // +50ms buffer

      if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }

      // Clean up again after waiting
      const nowAfterWait = Date.now();
      while (timestamps.length > 0 && timestamps[0] < nowAfterWait - config.windowMs) {
        timestamps.shift();
      }
    }

    // Optional minimum delay between requests (for APIs with per-second limits)
    if (config.minDelayMs && timestamps.length > 0) {
      const lastTimestamp = timestamps[timestamps.length - 1];
      const sinceLast = now - lastTimestamp;

      if (sinceLast < config.minDelayMs) {
        const delayNeeded = config.minDelayMs - sinceLast;
        await new Promise(resolve => setTimeout(resolve, delayNeeded));
      }
    }

    // Record this request timestamp
    timestamps.push(Date.now());

    // Execute the fetch
    return fetch(url, options);
  };
}

/**
 * Pre-configured throttled fetcher for HubSpot REST API.
 *
 * HubSpot Rate Limit: 100 requests per 10 seconds
 * We use 90 to leave headroom for other integrations sharing the OAuth app.
 *
 * USE THIS FOR:
 * - /crm/v3/objects/deals, /contacts, /companies (paginated fetches)
 * - /crm/v3/pipelines
 * - /crm/v3/properties
 */
export const hubspotFetch = createThrottledFetcher({
  maxRequests: 90,    // 90 of 100 limit (leave 10% headroom)
  windowMs: 10_000,   // 10 seconds
});

/**
 * Pre-configured throttled fetcher for HubSpot Search API.
 *
 * HubSpot Search API Rate Limit: 4 requests per second
 * We use 3 req/sec with 300ms spacing for safety.
 *
 * USE THIS FOR:
 * - /crm/v3/objects/{objectType}/search (incremental sync)
 * - Any search with filters
 *
 * NOTE: Search API has a TIGHTER limit than REST API.
 */
export const hubspotSearchFetch = createThrottledFetcher({
  maxRequests: 3,     // 3 of 4/sec limit
  windowMs: 1_000,    // 1 second
  minDelayMs: 300,    // Space out search calls (300ms between requests)
});

/**
 * Pre-configured throttled fetcher for Gong API.
 *
 * Gong Rate Limit: 100 requests per minute
 * We use 90 to leave headroom.
 *
 * USE THIS FOR:
 * - /v2/calls (paginated call fetches)
 * - /v2/calls/{id}/transcript
 */
export const gongFetch = createThrottledFetcher({
  maxRequests: 90,
  windowMs: 60_000,   // 60 seconds (1 minute)
});

/**
 * Pre-configured throttled fetcher for Monday.com API.
 *
 * Monday Rate Limit: 60 requests per minute (GraphQL)
 * We use 50 to be conservative.
 *
 * USE THIS FOR:
 * - GraphQL queries to Monday API
 */
export const mondayFetch = createThrottledFetcher({
  maxRequests: 50,
  windowMs: 60_000,
});

/**
 * Retry-on-429 wrapper for throttled fetchers.
 *
 * USE AS A SAFETY NET: Even with throttling, you can still hit 429s if
 * other integrations share the same OAuth app. This provides retry logic.
 *
 * DO NOT use this as a substitute for throttling - retry alone will hammer the API.
 *
 * @param fetchFn - Function that performs the fetch
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @returns Response
 */
export async function fetchWithRateLimitRetry(
  fetchFn: () => Promise<Response>,
  maxRetries: number = 3
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetchFn();

    if (response.status === 429) {
      // If this was the last retry, return the 429 response
      if (attempt === maxRetries) {
        return response;
      }

      // Respect Retry-After header if present
      const retryAfter = response.headers.get('Retry-After');
      const waitMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : Math.pow(2, attempt + 1) * 1000; // Exponential: 2s, 4s, 8s

      console.warn(
        `[Rate Limit] 429 received, waiting ${waitMs}ms before retry ${attempt + 1}/${maxRetries}`
      );

      await new Promise(resolve => setTimeout(resolve, waitMs));
      continue;
    }

    // Success or non-429 error - return immediately
    return response;
  }

  // Unreachable, but TypeScript requires it
  throw new Error('fetchWithRateLimitRetry: Unreachable code');
}
