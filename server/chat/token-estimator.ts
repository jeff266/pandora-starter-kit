/**
 * Token Estimator
 *
 * Fast, synchronous token estimation for routing decisions.
 * No LLM call - uses character-to-token ratio for quick estimates.
 */

export interface TokenEstimate {
  messageTokens: number;       // tokens in the user's message
  contextTokens: number;       // tokens in conversation history so far
  totalInputTokens: number;    // sum — what would be sent to the LLM
  estimatedOutputTokens: number; // rough estimate based on question type
}

// Rough character-to-token ratio: 4 chars ≈ 1 token (good enough for routing)
const CHARS_PER_TOKEN = 4;

export function estimateTokens(
  message: string,
  conversationHistory: Array<{ role: string; content: string }>,
): TokenEstimate {
  const messageTokens = Math.ceil(message.length / CHARS_PER_TOKEN);

  const contextTokens = conversationHistory.reduce((sum, msg) => {
    const content = typeof msg.content === 'string'
      ? msg.content
      : JSON.stringify(msg.content);
    return sum + Math.ceil(content.length / CHARS_PER_TOKEN);
  }, 0);

  const totalInputTokens = messageTokens + contextTokens;

  // Output estimate: advisory answers ~500 tokens, data synthesis ~1500 tokens
  const estimatedOutputTokens = 800;

  return { messageTokens, contextTokens, totalInputTokens, estimatedOutputTokens };
}

// Size thresholds for routing decisions
export const TOKEN_THRESHOLDS = {
  DEEPSEEK_MAX_INPUT: 8_000,   // Use DeepSeek for classification if input < 8K
  LARGE_CONTEXT: 20_000,       // Flag as large context — compress before proceeding
  TOOL_RESULT_MAX: 5_000,      // Compress any single tool result above this
} as const;
