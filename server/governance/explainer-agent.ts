/**
 * Explainer Agent
 *
 * Produces human-language explanations of proposed changes for admin review.
 * Answers: "What does this do, in words a VP Sales would understand?"
 */

import Anthropic from '@anthropic-ai/sdk';
import { getGovernanceRecord } from './db.js';
import type { SkillGovernanceRecord } from './db.js';

export interface Explanation {
  summary: string;
  detail: string;
  impact: string;
  supersedes?: string;
  rollback_note: string;
}

export async function explainProposedChange(
  workspaceId: string,
  governanceRecord: SkillGovernanceRecord
): Promise<Explanation> {
  const fallback: Explanation = {
    summary: `Pandora will ${governanceRecord.change_description.toLowerCase()}`,
    detail: governanceRecord.change_description,
    impact: 'This change will affect how Pandora responds to related questions.',
    rollback_note: "If this doesn't work, you can undo it with one click in Settings → Changes.",
  };

  try {
    let supersededDescription = '';
    if (governanceRecord.supersedes_id) {
      const previous = await getGovernanceRecord(governanceRecord.supersedes_id);
      supersededDescription = previous?.explanation_summary ||
        `an existing ${previous?.change_type || 'configuration'}`;
    }

    const prompt = `You are explaining a system change to a non-technical RevOps leader or VP of Sales. They need to understand what is changing, why, and what will be different.

## Change Details
Type: ${governanceRecord.change_type}
Technical description: ${governanceRecord.change_description}

## Change payload (for your understanding — do NOT reference internal field names in your response):
${JSON.stringify(governanceRecord.change_payload, null, 2)}

${supersededDescription
  ? `## What This Replaces\nThis change will supersede: ${supersededDescription}`
  : '## New Addition\nThis is a net-new capability, not replacing anything existing.'}

## Source
This change was proposed because ${governanceRecord.source_feedback_ids?.length || 0} users gave negative feedback or repeated questions that suggest the current behavior needs improvement.

Write for someone who has NEVER seen code, does not know what "resolver patterns" or "context injection" are, and cares only about: "will my team's RevOps assistant get smarter?"

Rules:
- "summary" MUST start with "Pandora will..."
- No technical jargon, no internal system references
- Be concrete — use examples if helpful
- rollback_note must be exactly: "If this doesn't work, you can undo it with one click in Settings → Changes."

Respond with JSON only (no markdown, no backticks):
{
  "summary": "Pandora will...",
  "detail": "One paragraph explaining what changes and why, with concrete examples",
  "impact": "One paragraph explaining what the admin should expect to be different day-to-day",
  "supersedes": "If replacing something: 'This replaces the current behavior where...' — or null if new",
  "rollback_note": "If this doesn't work, you can undo it with one click in Settings → Changes."
}`;

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== 'text') return fallback;

    const cleaned = content.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);

    return {
      summary: parsed.summary || fallback.summary,
      detail: parsed.detail || fallback.detail,
      impact: parsed.impact || fallback.impact,
      supersedes: parsed.supersedes || undefined,
      rollback_note: "If this doesn't work, you can undo it with one click in Settings → Changes.",
    };
  } catch (err) {
    console.error('[ExplainerAgent] Failed:', err);
    return fallback;
  }
}
