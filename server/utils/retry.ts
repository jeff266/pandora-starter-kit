export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay?: number;
  backoffFactor: number;
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  backoffFactor: 2,
  onRetry: (attempt, error, delayMs) => {
    console.log(
      `[Retry] Attempt ${attempt} failed: ${error.message}. Retrying in ${delayMs}ms...`,
    );
  },
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
): Promise<T> {
  const cfg: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= cfg.maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt > cfg.maxRetries) {
        throw lastError;
      }

      let delay = cfg.baseDelay * Math.pow(cfg.backoffFactor, attempt - 1);

      if (cfg.maxDelay && delay > cfg.maxDelay) {
        delay = cfg.maxDelay;
      }

      if (cfg.onRetry) {
        cfg.onRetry(attempt, lastError, delay);
      }

      await sleep(delay);
    }
  }

  throw lastError || new Error("Retry failed");
}

export async function paginatedFetchWithRetry<T>(
  fetchPage: (pageNumber: number) => Promise<T[]>,
  options: {
    maxPages?: number;
    pageDelay?: number;
    retryConfig?: Partial<RetryConfig>;
    consecutiveErrorLimit?: number;
    onProgress?: (totalFetched: number, pageNumber: number) => void;
  } = {},
): Promise<T[]> {
  const {
    maxPages = 20,
    pageDelay = 200,
    retryConfig = {},
    consecutiveErrorLimit = 3,
    onProgress,
  } = options;

  const allResults: T[] = [];
  let pageNum = 0;
  let consecutiveErrors = 0;

  while (pageNum < maxPages) {
    let pageResults: T[] | null = null;

    try {
      pageResults = await withRetry(
        async () => await fetchPage(pageNum),
        retryConfig,
      );

      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors++;
      console.error(
        `[PaginatedFetch] Error fetching page ${pageNum} (consecutive errors: ${consecutiveErrors}):`,
        error instanceof Error ? error.message : error,
      );

      if (consecutiveErrors >= consecutiveErrorLimit) {
        console.error(
          `[PaginatedFetch] Consecutive error limit (${consecutiveErrorLimit}) reached. Stopping pagination with ${allResults.length} results.`,
        );
        break;
      }

      pageNum++;
      continue;
    }

    if (!pageResults || pageResults.length === 0) {
      console.log(
        `[PaginatedFetch] Reached end of data at page ${pageNum}`,
      );
      break;
    }

    allResults.push(...pageResults);
    pageNum++;

    if (onProgress) {
      onProgress(allResults.length, pageNum);
    }

    console.log(
      `[PaginatedFetch] Fetched page ${pageNum}: ${pageResults.length} results (total: ${allResults.length})`,
    );

    if (pageNum < maxPages && pageResults.length > 0) {
      await sleep(pageDelay);
    }
  }

  console.log(
    `[PaginatedFetch] Pagination complete: ${allResults.length} total results`,
  );
  return allResults;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RateLimiter {
  private queue: Array<() => void> = [];
  private tokens: number;
  private lastRefill: number;

  constructor(
    private maxRequests: number,
    private windowMs: number,
  ) {
    this.tokens = maxRequests;
    this.lastRefill = Date.now();
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.waitForToken();
    return fn();
  }

  private async waitForToken(): Promise<void> {
    this.refillTokens();

    if (this.tokens > 0) {
      this.tokens--;
      return;
    }

    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.scheduleRefill();
    });
  }

  private refillTokens() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;

    if (elapsed >= this.windowMs) {
      this.tokens = this.maxRequests;
      this.lastRefill = now;

      while (this.tokens > 0 && this.queue.length > 0) {
        this.tokens--;
        const resolve = this.queue.shift();
        if (resolve) resolve();
      }
    }
  }

  private scheduleRefill() {
    const now = Date.now();
    const timeUntilRefill = this.windowMs - (now - this.lastRefill);

    if (timeUntilRefill > 0) {
      setTimeout(() => {
        this.refillTokens();
      }, timeUntilRefill);
    }
  }
}
