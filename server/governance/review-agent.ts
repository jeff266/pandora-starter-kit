/**
 * Review Agent
 *
 * LLM-based quality review of proposed governance changes.
 * Answers: "Is this good enough to ship?"
 */

import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db.js';
import { configLoader } from '../config/workspace-config-loader.js';
import type { SkillGovernanceRecord } from './db.js';

export interface ReviewResult {
  recommendation: 'approve' | 'reject' | 'needs_revision';
  score: number;
  concerns: string[];
  strengths: string[];
  revision_suggestions?: string;
  dimension_scores: Record<string, number>;
}

export async function getRecentFeedback(
  workspaceId: string,
  days: number
): Promise<{ thumbsDown: number; thumbsUp: number; repeats: number; total: number }> {
  try {
    const result = await query(
      `SELECT
         COUNT(*) FILTER (WHERE signal = 'thumbs_down') as thumbs_down,
         COUNT(*) FILTER (WHERE signal = 'thumbs_up') as thumbs_up,
         COUNT(*) FILTER (WHERE signal = 'repeated_question') as repeats,
         COUNT(*) as total
       FROM agent_feedback
       WHERE workspace_id = $1
         AND created_at > NOW() - ($2 || ' days')::INTERVAL`,
      [workspaceId, days]
    );
    const row = result.rows[0];
    return {
      thumbsDown: parseInt(row.thumbs_down) || 0,
      thumbsUp: parseInt(row.thumbs_up) || 0,
      repeats: parseInt(row.repeats) || 0,
      total: parseInt(row.total) || 0,
    };
  } catch {
    return { thumbsDown: 0, thumbsUp: 0, repeats: 0, total: 0 };
  }
}

export async function reviewProposedChange(
  workspaceId: string,
  governanceRecord: SkillGovernanceRecord
): Promise<ReviewResult> {
  const fallback: ReviewResult = {
    recommendation: 'needs_revision',
    score: 0.3,
    concerns: ['Could not complete automated review'],
    strengths: [],
    dimension_scores: {},
  };

  try {
    const config = await configLoader.getConfig(workspaceId);
    const feedback = await getRecentFeedback(workspaceId, 30);

    // Count existing deployed resolvers and filters
    const deployedCounts = await query(
      `SELECT change_type, COUNT(*) as cnt
       FROM skill_governance
       WHERE workspace_id = $1 AND status IN ('deployed', 'monitoring')
       GROUP BY change_type`,
      [workspaceId]
    );
    const counts: Record<string, number> = {};
    for (const row of deployedCounts.rows) {
      counts[row.change_type] = parseInt(row.cnt);
    }

    const reps = (config as any).teams?.reps || (config as any).team?.reps || [];
    const pipelines = (config as any).pipelines?.map((p: any) => p.name).join(', ') || 'unknown';

    const prompt = `You are a RevOps platform quality reviewer. A self-healing system has proposed a change to Pandora, a RevOps intelligence assistant. Evaluate whether this change should be deployed.

## Workspace Context
- Team reps: ${reps.length || 'unknown'} reps
- CRM: ${(config as any).crm_type || 'unknown'}
- Pipelines: ${pipelines}

## Proposed Change
Type: ${governanceRecord.change_type}
Description: ${governanceRecord.change_description}

Payload:
${JSON.stringify(governanceRecord.change_payload, null, 2)}

## Shape Validation (already passed structural checks)
${governanceRecord.shape_errors?.length ? 'WARNINGS: ' + governanceRecord.shape_errors.join('; ') : 'Clean — no errors or warnings'}

## Source Feedback Signals
${governanceRecord.source_feedback_ids?.length || 0} feedback signals contributed to this proposal.
Recent workspace feedback (last 30 days): ${feedback.thumbsDown} thumbs down, ${feedback.repeats} repeated questions, ${feedback.thumbsUp} thumbs up.

## Existing Deployed Changes
- Resolver patterns: ${counts['resolver_pattern'] || 0}
- Named filters: ${counts['named_filter'] || 0}
- Workspace context additions: ${counts['workspace_context'] || 0}

## Evaluation Criteria

Score each dimension 0-1:
1. **specificity** — Is this change targeted, or too broad?
2. **evidence_strength** — Is there enough feedback to justify this?
3. **risk** — Could this make things worse? Low risk = new addition; high risk = overwriting existing config.
4. **clarity** — Is the implementation specific enough to deploy without ambiguity?
5. **reversibility** — Can this be easily undone?

Overall score = average of dimension scores.
Auto-reject if overall score < 0.3.

Respond with JSON only (no markdown, no backticks):
{
  "recommendation": "approve | reject | needs_revision",
  "score": 0.0,
  "concerns": ["specific concern"],
  "strengths": ["specific strength"],
  "revision_suggestions": "If needs_revision, describe what should change (or null)",
  "dimension_scores": {
    "specificity": 0.0,
    "evidence_strength": 0.0,
    "risk": 0.0,
    "clarity": 0.0,
    "reversibility": 0.0
  }
}`;

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== 'text') return fallback;

    const cleaned = content.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);

    return {
      recommendation: parsed.recommendation || 'needs_revision',
      score: typeof parsed.score === 'number' ? parsed.score : 0.3,
      concerns: Array.isArray(parsed.concerns) ? parsed.concerns : [],
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
      revision_suggestions: parsed.revision_suggestions || undefined,
      dimension_scores: parsed.dimension_scores || {},
    };
  } catch (err) {
    console.error('[ReviewAgent] Failed:', err);
    return fallback;
  }
}
