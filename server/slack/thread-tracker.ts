/**
 * Pandora Thread Tracker
 *
 * In-memory TTL map that records every Slack message Pandora posts,
 * keyed by `${channel}:${ts}` → { workspaceId, postedAt }.
 *
 * This is a lightweight complement to the DB-based thread_anchors table.
 * It enables instant workspace resolution for thread replies without
 * a DB round-trip, and survives restarts gracefully by falling through
 * to the DB lookup.
 *
 * TTL: 7 days (604800000 ms). Pruning runs on every write.
 */

const THREAD_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface TrackedThread {
  workspaceId: string;
  postedAt: number;
}

export const pandoraThreadMap = new Map<string, TrackedThread>();

/**
 * Record a message Pandora just posted so future thread replies
 * can be routed to the correct workspace.
 */
export function trackPandoraPost(
  channel: string,
  messageTs: string,
  workspaceId: string
): void {
  const key = `${channel}:${messageTs}`;
  pandoraThreadMap.set(key, { workspaceId, postedAt: Date.now() });
  pruneOldEntries();
}

/**
 * Look up which workspace owns a Pandora thread by channel + ts.
 * Returns null if not found (caller should fall through to DB lookup).
 */
export function lookupPandoraThread(
  channel: string,
  threadTs: string
): string | null {
  const key = `${channel}:${threadTs}`;
  const entry = pandoraThreadMap.get(key);
  if (!entry) return null;
  if (Date.now() - entry.postedAt > THREAD_TTL_MS) {
    pandoraThreadMap.delete(key);
    return null;
  }
  return entry.workspaceId;
}

/**
 * Remove entries older than 7 days. Called on every write to avoid
 * unbounded growth.
 */
function pruneOldEntries(): void {
  const cutoff = Date.now() - THREAD_TTL_MS;
  for (const [key, entry] of pandoraThreadMap) {
    if (entry.postedAt < cutoff) {
      pandoraThreadMap.delete(key);
    }
  }
}

/**
 * Error-safe Slack Web API caller.
 *
 * Wraps every Slack API call so failures never throw — they log and
 * return { ok: false, error }. This is critical: Slack event handlers
 * must always return 200 quickly; Slack API failures are non-fatal.
 */
export async function slackPost(
  endpoint: string,
  body: Record<string, any>,
  token: string
): Promise<{ ok: boolean; ts?: string; error?: string }> {
  try {
    const res = await fetch(`https://slack.com/api/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const msg = `HTTP ${res.status} ${res.statusText}`;
      console.error(`[slackPost] ${endpoint} failed: ${msg}`);
      return { ok: false, error: msg };
    }

    const data = (await res.json()) as any;
    if (!data.ok) {
      console.error(`[slackPost] ${endpoint} Slack error: ${data.error}`);
      return { ok: false, error: data.error };
    }

    return { ok: true, ts: data.ts };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.error(`[slackPost] ${endpoint} exception: ${msg}`);
    return { ok: false, error: msg };
  }
}

/**
 * Format an agent text response into compact Block Kit sections.
 *
 * Rules:
 *  - Split on double newlines → separate section blocks (max 3)
 *  - Bold **text** markers preserved as Slack *bold*
 *  - Truncate with "..." if more than 3 paragraphs
 *  - Footer: "_Ask Pandora · [workspaceName]_"
 */
export function formatAgentResponse(
  text: string,
  workspaceName: string
): Array<Record<string, any>> {
  const blocks: Array<Record<string, any>> = [];

  const slackText = text
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/^\s*#{1,3}\s+/gm, '*')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const paragraphs = slackText
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  const shown = paragraphs.slice(0, 3);
  const truncated = paragraphs.length > 3;

  for (const para of shown) {
    const safeText = para.length > 2800 ? para.slice(0, 2797) + '...' : para;
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: safeText },
    });
  }

  if (truncated) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '_... (truncated — open Concierge for the full answer)_' }],
    });
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `_Ask Pandora · ${workspaceName}_` }],
  });

  return blocks;
}
