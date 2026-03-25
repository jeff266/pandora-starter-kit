/**
 * Workspace Knowledge Extraction
 *
 * Pattern-based extraction of business context from conversations.
 * NO LLM calls - pure regex matching. Stores workspace-specific
 * knowledge for future agent context.
 */

import { query } from '../db.js';

export interface ExtractedKnowledge {
  key:   string;
  value: string;
}

export interface WorkspaceKnowledgeItem {
  key:        string;
  value:      string;
  source:     string;
  confidence: number;
  used_count: number;
}

// Patterns that signal workspace-specific knowledge
const KNOWLEDGE_PATTERNS: Array<{
  regex:    RegExp;
  keyFn:    (match: RegExpMatchArray) => string;
  valueFn:  (match: RegExpMatchArray) => string;
}> = [
  // "our X is Y" / "our X are Y"
  {
    regex: /\bour\s+([\w\s]+?)\s+(?:is|are)\s+([^.!?]+)/gi,
    keyFn:   m => `our.${m[1].trim().toLowerCase().replace(/\s+/g, '_')}`,
    valueFn: m => m[0].trim(),
  },
  // "we define X as Y"
  {
    regex: /\bwe\s+define\s+([\w\s]+?)\s+as\s+([^.!?]+)/gi,
    keyFn:   m => `definition.${m[1].trim().toLowerCase().replace(/\s+/g, '_')}`,
    valueFn: m => m[0].trim(),
  },
  // "X because of Y" (causal constraints)
  {
    regex: /\b([\w\s]+?)\s+because\s+of\s+([^.!?]+)/gi,
    keyFn:   m => `constraint.${m[1].trim().toLowerCase().replace(/\s+/g, '_')}`,
    valueFn: m => m[0].trim(),
  },
  // "don't count X as Y" / "exclude X from Y"
  {
    regex: /\b(?:don'?t\s+count|exclude)\s+([\w\s]+?)\s+(?:as|from)\s+([^.!?]+)/gi,
    keyFn:   m => `exclusion.${m[1].trim().toLowerCase().replace(/\s+/g, '_')}`,
    valueFn: m => m[0].trim(),
  },
  // "X takes Y days" (cycle time constraints)
  {
    regex: /\b([\w\s]+?)\s+takes?\s+(\d+)\s+days?\b/gi,
    keyFn:   m => `cycle_time.${m[1].trim().toLowerCase().replace(/\s+/g, '_')}`,
    valueFn: m => m[0].trim(),
  },
];

/**
 * Extract knowledge claims from a message using pattern matching.
 * Returns an array of key-value pairs representing business context.
 */
export function extractKnowledgeClaims(
  message: string
): ExtractedKnowledge[] {
  const results: ExtractedKnowledge[] = [];
  const seen = new Set<string>();

  for (const pattern of KNOWLEDGE_PATTERNS) {
    let match: RegExpMatchArray | null;
    const re = new RegExp(pattern.regex.source, pattern.regex.flags);
    while ((match = re.exec(message)) !== null) {
      const key   = pattern.keyFn(match)
        .slice(0, 200);  // max key length
      const value = pattern.valueFn(match)
        .slice(0, 500);  // max value length

      // Skip very short or very generic keys
      if (key.length < 8 || seen.has(key)) continue;
      seen.add(key);
      results.push({ key, value });
    }
  }

  return results;
}

/**
 * Extract and persist workspace knowledge from a user message.
 * Non-blocking - never throws. Increments confidence on repeated claims.
 */
export async function extractWorkspaceKnowledge(
  message:     string,
  workspaceId: string
): Promise<void> {
  const claims = extractKnowledgeClaims(message);
  if (!claims.length) return;

  // Write all claims in parallel
  await Promise.all(claims.map(claim =>
    query(
      `INSERT INTO workspace_knowledge
         (workspace_id, key, value, source, confidence)
       VALUES ($1, $2, $3, 'conversation', 0.70)
       ON CONFLICT (workspace_id, key) DO UPDATE SET
         value       = EXCLUDED.value,
         confidence  = LEAST(
           workspace_knowledge.confidence + 0.05, 1.0
         ),
         last_used_at = NOW(),
         used_count   = workspace_knowledge.used_count + 1`,
      [workspaceId, claim.key, claim.value]
    )
    .catch(() => {})  // silent — never block response
  ));
}
