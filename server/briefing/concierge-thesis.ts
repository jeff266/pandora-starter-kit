/**
 * concierge-thesis.ts
 *
 * Owns the "Pandora's Take" weekly thesis — a 3-paragraph Chief of Staff
 * opening narrative generated from the current brief's findings. Exposed as
 * `getOrGenerateThesis()` so the Concierge assembly path can enrich an
 * already-assembled brief without modifying opening-brief.ts.
 *
 * Cache strategy: content-hash keyed on top-5 finding messages + severity +
 * quarter phase. Cache entry is invalidated whenever findings change, not just
 * after a TTL. TTL acts as a hard ceiling (1 hour) to prevent unbounded growth.
 */

import { generateWeeklyThesis } from './brief-narratives.js';

export type QuarterPhase = 'early' | 'mid' | 'late' | 'final_week';

export interface ThesisInput {
  workspaceId: string;
  topFindings: Array<{ severity: string; message: string; skillName?: string; dealName?: string }>;
  metrics: {
    attainment_pct?: number | null;
    coverage_ratio?: number | null;
    days_remaining?: number | null;
  };
  quarterPhase: QuarterPhase;
  weekOfQuarter?: number;
}

interface ThesisCacheEntry {
  thesis: string | null;
  contentHash: string;
  expiresAt: number;
}

const cache = new Map<string, ThesisCacheEntry>();
const TTL_MS = 60 * 60 * 1000; // 1 hour hard ceiling

function buildContentHash(input: ThesisInput): string {
  const sigFindings = input.topFindings
    .slice(0, 5)
    .map(f => `${f.severity}:${f.message.slice(0, 80)}`)
    .join('|');
  return `${input.quarterPhase}:${input.weekOfQuarter ?? 0}:${sigFindings}`;
}

function pruneStaleCacheEntries(): void {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.expiresAt < now) cache.delete(k);
  }
}

/**
 * Returns a cached or freshly generated weekly thesis.
 * Returns null when findings are insufficient (<3) or generation fails.
 */
export async function getOrGenerateThesis(input: ThesisInput): Promise<string | null> {
  pruneStaleCacheEntries();

  const contentHash = buildContentHash(input);
  const cached = cache.get(input.workspaceId);

  if (cached && cached.contentHash === contentHash && cached.expiresAt > Date.now()) {
    return cached.thesis;
  }

  const thesis = await generateWeeklyThesis(
    input.workspaceId,
    input.topFindings,
    {
      attainment_pct: input.metrics.attainment_pct ?? null,
      coverage_ratio: input.metrics.coverage_ratio ?? null,
      days_remaining: input.metrics.days_remaining ?? undefined,
    },
    input.quarterPhase,
    input.weekOfQuarter
  ).catch(err => {
    console.warn('[concierge-thesis] Generation failed (non-fatal):', err?.message ?? err);
    return null;
  });

  cache.set(input.workspaceId, {
    thesis,
    contentHash,
    expiresAt: Date.now() + TTL_MS,
  });

  return thesis;
}
