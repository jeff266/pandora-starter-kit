/**
 * Tool Result Cache
 *
 * 15-minute in-memory cache for tool results.
 * Reduces redundant queries when users ask variations of the same question.
 *
 * Cache key = hash(workspace_id + tool_name + JSON.stringify(params))
 *
 * Never cached:
 * - get_workspace_context (has its own cache)
 * - query_schema (lightweight, changes with config)
 */

interface CacheEntry {
  result: any;
  cachedAt: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const resultCache = new Map<string, CacheEntry>();
let cacheHits = 0;
let cacheMisses = 0;

// Never cache these tools
const NEVER_CACHE = new Set(['get_workspace_context', 'query_schema']);

// ─── Cache API ────────────────────────────────────────────────────────────────

export function getCachedResult(
  workspaceId: string,
  toolName: string,
  params: Record<string, any>
): any | null {
  if (NEVER_CACHE.has(toolName)) {
    return null;
  }

  const key = buildCacheKey(workspaceId, toolName, params);
  const entry = resultCache.get(key);

  if (!entry) {
    cacheMisses++;
    return null;
  }

  const age = Date.now() - entry.cachedAt;
  if (age > CACHE_TTL_MS) {
    resultCache.delete(key);
    cacheMisses++;
    return null;
  }

  cacheHits++;
  const hitRate = ((cacheHits / (cacheHits + cacheMisses)) * 100).toFixed(1);
  console.log(`[ToolCache] HIT for ${toolName} (age: ${Math.round(age / 1000)}s, hit rate: ${hitRate}%)`);

  return entry.result;
}

export function setCachedResult(
  workspaceId: string,
  toolName: string,
  params: Record<string, any>,
  result: any
): void {
  if (NEVER_CACHE.has(toolName)) {
    return;
  }

  // Don't cache error results
  if (result && result.error) {
    return;
  }

  const key = buildCacheKey(workspaceId, toolName, params);
  resultCache.set(key, {
    result,
    cachedAt: Date.now(),
  });
}

// ─── Cache key builder ────────────────────────────────────────────────────────

function buildCacheKey(
  workspaceId: string,
  toolName: string,
  params: Record<string, any>
): string {
  const paramsHash = hashParams(params);
  return `${workspaceId}:${toolName}:${paramsHash}`;
}

function hashParams(params: Record<string, any>): string {
  // Simple deterministic hash of params object
  const normalized = JSON.stringify(sortKeys(params));
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

function sortKeys(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sortKeys);
  }

  const sorted: any = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeys(obj[key]);
  }
  return sorted;
}

// ─── Cleanup interval ─────────────────────────────────────────────────────────

let cleanupTimer: NodeJS.Timeout | null = null;

export function startCacheCleanup(): void {
  if (cleanupTimer) return;

  cleanupTimer = setInterval(() => {
    const now = Date.now();
    let expired = 0;

    for (const [key, entry] of resultCache.entries()) {
      if (now - entry.cachedAt > CACHE_TTL_MS) {
        resultCache.delete(key);
        expired++;
      }
    }

    if (expired > 0) {
      console.log(`[ToolCache] Cleanup: removed ${expired} expired entries, ${resultCache.size} remaining`);
    }
  }, CLEANUP_INTERVAL_MS);

  console.log('[ToolCache] Cleanup interval started (runs every 5 minutes)');
}

export function stopCacheCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    console.log('[ToolCache] Cleanup interval stopped');
  }
}

export function clearCache(): void {
  resultCache.clear();
  cacheHits = 0;
  cacheMisses = 0;
  console.log('[ToolCache] Cache cleared');
}

export function getCacheStats() {
  return {
    size: resultCache.size,
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: cacheHits + cacheMisses > 0
      ? ((cacheHits / (cacheHits + cacheMisses)) * 100).toFixed(1) + '%'
      : '0%',
  };
}

// Start cleanup on module load
startCacheCleanup();
