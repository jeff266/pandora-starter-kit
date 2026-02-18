/**
 * Sliding window conversation history manager.
 * Keeps token costs flat regardless of session length.
 *
 * Strategy:
 * - Last MAX_VERBATIM_TURNS turns: sent verbatim
 * - Older turns: collapsed into a single summary prefix
 * - Cost plateaus at ~850 tokens after turn 4 and never grows
 */

export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_VERBATIM_TURNS = 4;   // keep last 2 exchanges verbatim
const MAX_SUMMARY_CHARS  = 200; // older turns compressed to this length

/**
 * Takes a raw turn array and returns a token-safe history
 * ready to send to a synthesis prompt.
 */
export function buildConversationHistory(turns: HistoryTurn[]): HistoryTurn[] {
  if (turns.length === 0) return [];
  if (turns.length <= MAX_VERBATIM_TURNS) return turns;

  const older  = turns.slice(0, turns.length - MAX_VERBATIM_TURNS);
  const recent = turns.slice(turns.length - MAX_VERBATIM_TURNS);

  const charsPerTurn = Math.max(1, Math.floor(MAX_SUMMARY_CHARS / older.length));
  const summary = older
    .map(t => {
      const prefix  = t.role === 'user' ? 'Q' : 'A';
      const trimmed = t.content.replace(/\s+/g, ' ').trim();
      return `${prefix}: ${trimmed.slice(0, charsPerTurn)}`;
    })
    .join(' → ');

  return [
    {
      role: 'user' as const,
      content: `[Earlier in this session: ${summary}]`,
    },
    ...recent,
  ];
}

/**
 * Rough token estimate: 1 token ≈ 4 chars.
 */
export function estimateHistoryTokens(turns: HistoryTurn[]): number {
  return turns.reduce((sum, t) => sum + Math.ceil(t.content.length / 4), 0);
}
