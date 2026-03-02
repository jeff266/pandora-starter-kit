/**
 * Comparison Engine
 *
 * Runs before/after test cases to prove a proposed change is better.
 * Answers: "Is this provably better than what we have?"
 */

import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db.js';
import { loadExistingResolvers } from './shape-validator.js';
import type { SkillGovernanceRecord } from './db.js';

export interface ComparisonTestCase {
  input: string;
  before: { response: string; source: string };
  after: { response: string; source: string };
  verdict: 'improved' | 'unchanged' | 'degraded' | 'ambiguous';
  verdict_reason: string;
}

export interface ComparisonResult {
  test_cases: ComparisonTestCase[];
  overall_improvement: number;
  recommendation: 'deploy' | 'hold' | 'reject';
  summary: string;
}

export async function compareBeforeAfter(
  workspaceId: string,
  governanceRecord: SkillGovernanceRecord
): Promise<ComparisonResult> {
  const testInputs = await buildTestInputs(workspaceId, governanceRecord);

  if (testInputs.length === 0) {
    return {
      test_cases: [],
      overall_improvement: 0,
      recommendation: 'hold',
      summary: 'No test cases available — manual review required',
    };
  }

  const results: ComparisonTestCase[] = [];
  const existingResolvers = await loadExistingResolvers(workspaceId);

  for (const input of testInputs) {
    const before = simulateBefore(input, governanceRecord.change_type, existingResolvers);
    const after = simulateAfter(input, governanceRecord.change_type, governanceRecord.change_payload);
    const verdict = await judgeImprovement(input, before, after);
    results.push({ input, before, after, ...verdict });
  }

  const improved = results.filter(r => r.verdict === 'improved').length;
  const degraded = results.filter(r => r.verdict === 'degraded').length;
  const total = results.length;
  const overallImprovement = (improved - degraded) / Math.max(total, 1);

  let recommendation: 'deploy' | 'hold' | 'reject';
  if (degraded > 0) {
    recommendation = 'reject';
  } else if (improved > total / 2) {
    recommendation = 'deploy';
  } else {
    recommendation = 'hold';
  }

  const unchanged = results.filter(r => r.verdict === 'unchanged').length;
  const ambiguous = results.filter(r => r.verdict === 'ambiguous').length;

  return {
    test_cases: results,
    overall_improvement: overallImprovement,
    recommendation,
    summary: `${improved} of ${total} test cases improved, ${unchanged} unchanged, ${degraded} degraded, ${ambiguous} ambiguous`,
  };
}

async function buildTestInputs(
  workspaceId: string,
  record: SkillGovernanceRecord
): Promise<string[]> {
  const inputs: string[] = [];

  // From change_payload test_inputs
  for (const input of (record.change_payload?.test_inputs || [])) {
    inputs.push(input);
  }

  // From source feedback original questions
  if (record.source_feedback_ids?.length) {
    try {
      const result = await query(
        `SELECT metadata FROM agent_feedback WHERE id = ANY($1::uuid[])`,
        [record.source_feedback_ids]
      );
      for (const row of result.rows) {
        const q = row.metadata?.original_question;
        if (q && typeof q === 'string') inputs.push(q);
      }
    } catch { /* non-fatal */ }
  }

  // Deduplicate, max 10
  const seen = new Set<string>();
  return inputs
    .filter(i => {
      const key = i.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
}

function simulateBefore(
  input: string,
  changeType: string,
  existingResolvers: Array<{ pattern: RegExp; intent: string }>
): { response: string; source: string } {
  if (changeType === 'resolver_pattern') {
    const match = existingResolvers.find(r => r.pattern.test(input));
    if (match) {
      return { response: `Handled by existing resolver: ${match.intent}`, source: 'existing_resolver' };
    }
    return { response: 'Would route to LLM investigation', source: 'llm' };
  }
  return { response: 'Current behavior without this context/filter', source: 'current_system' };
}

function simulateAfter(
  input: string,
  changeType: string,
  payload: any
): { response: string; source: string } {
  switch (changeType) {
    case 'resolver_pattern': {
      try {
        const regex = new RegExp(payload.pattern, payload.pattern_flags || '');
        if (regex.test(input)) {
          return {
            response: payload.response_template || `Pattern matches — would respond with template for intent: ${payload.intent}`,
            source: 'new_resolver',
          };
        }
        return { response: 'Pattern does not match — falls through to LLM', source: 'llm' };
      } catch {
        return { response: 'Invalid pattern — falls through to LLM', source: 'llm' };
      }
    }
    case 'workspace_context':
      return {
        response: `Context would be injected into LLM: "${payload.context_value}"`,
        source: 'context_enriched_llm',
      };
    case 'named_filter':
      return {
        response: `Pre-computed filter applied: ${payload.filter_name} — ${payload.description || 'filters data before LLM query'}`,
        source: 'named_filter',
      };
    default:
      return { response: 'Change applied', source: 'modified_system' };
  }
}

async function judgeImprovement(
  input: string,
  before: { response: string },
  after: { response: string }
): Promise<{ verdict: 'improved' | 'unchanged' | 'degraded' | 'ambiguous'; verdict_reason: string }> {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = `Compare these two responses to the same RevOps question.

Question: "${input}"

Response A (CURRENT):
${before.response.substring(0, 500)}

Response B (PROPOSED):
${after.response.substring(0, 500)}

Which response better answers the question? Consider:
- Accuracy and specificity
- Actionability (does it tell the user what to do?)
- Directness (does it answer the actual question?)

Respond with JSON only:
{
  "verdict": "A_better | B_better | tie | unclear",
  "reason": "One sentence explaining why"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== 'text') return { verdict: 'ambiguous', verdict_reason: 'Could not get LLM judgment' };

    const cleaned = content.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const verdictMap: Record<string, 'improved' | 'unchanged' | 'degraded' | 'ambiguous'> = {
      A_better: 'degraded',
      B_better: 'improved',
      tie: 'unchanged',
      unclear: 'ambiguous',
    };

    return {
      verdict: verdictMap[parsed.verdict] || 'ambiguous',
      verdict_reason: parsed.reason || '',
    };
  } catch {
    return { verdict: 'ambiguous', verdict_reason: 'Judgment failed' };
  }
}
