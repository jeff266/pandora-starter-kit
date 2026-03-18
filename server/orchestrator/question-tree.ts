/**
 * Question Tree Generator - McKinsey-style reasoning layers
 *
 * Transforms section conclusions into full arguments:
 * conclusion → causes → 2nd order implications → 3rd order questions → actions
 *
 * Each section gets 2-4 reasoning nodes based on available evidence.
 * Non-fatal - if generation fails, section renders without tree.
 */

import { callLLM } from '../utils/llm-router.js';
import { ReportSection, ReasoningNode, SkillSummary } from './types.js';

/**
 * Generates a reasoning tree for one section.
 * One Claude call per section, run in parallel.
 * Non-fatal — if it fails, section renders without tree.
 */
export async function generateReasoningTree(
  section: ReportSection,
  skillSummaries: SkillSummary[],
  workspaceId: string,
  workspaceContext: {
    company_name: string;
    days_remaining_in_quarter: number;
    has_quota: boolean;
  }
): Promise<ReasoningNode[]> {

  // Only build trees for sections with real content
  if (!section.content || section.content.length < 100) {
    return [];
  }

  // Find skills that contributed to this section
  const relevantSkills = skillSummaries.filter(s =>
    section.source_skills.includes(s.skill_id) ||
    section.content.toLowerCase().includes(
      s.skill_id.replace(/-/g, ' ')
    )
  );

  // Build evidence block from relevant skill summaries
  const evidenceBlock = relevantSkills.map(s => {
    const parts: string[] = [
      `### ${s.skill_id}`,
      `Key metrics: ${JSON.stringify(s.key_metrics, null, 0)}`,
      `Top findings:`,
      s.top_findings.map(f => `- ${f}`).join('\n'),
    ];

    // Add at-risk deals if present
    if (s.at_risk_deals?.length) {
      parts.push(`At-risk deals (${s.at_risk_deals.length}): ${s.at_risk_deals.map(d =>
        `${d.name} $${Math.round(d.amount / 1000)}K risk:${d.risk_score} — ${d.risk_factors[0]}`
      ).join(', ')}`);
    }

    // Add stale deals if present
    if (s.stale_deals?.length) {
      parts.push(`Stale deals: ${s.stale_deals.slice(0, 3).map(d =>
        `${d.name} $${Math.round(d.amount / 1000)}K ${d.days_stale}d dark`
      ).join(', ')}`);
    }

    return parts.join('\n');
  }).join('\n\n');

  const systemPrompt = `
You are a McKinsey-trained revenue operations analyst.
Your job is to deepen a report section by building a
reasoning tree — cause analysis, second-order implications,
third-order strategic questions, and concrete actions.

RULES:
- Each node answers ONE question clearly and completely
- Every answer must be grounded in the evidence provided
- If evidence is insufficient for a layer, set data_gap: true
  and explain what data would answer it
- Actions must be specific: named person or named deal,
  not generic recommendations
- Maximum 4 nodes per section — quality over completeness
- Questions should be the questions a smart VP would ask
  after reading the section conclusion
- chart_hint: only suggest if the data exists in evidence
  to actually build that chart

COMPANY: ${workspaceContext.company_name}
QUARTER POSITION: ${workspaceContext.days_remaining_in_quarter} days remaining
QUOTA CONFIGURED: ${workspaceContext.has_quota}

OUTPUT: Valid JSON only. No preamble.

{
  "reasoning_tree": [
    {
      "layer": "cause|second_order|third_order|action",
      "question": "string",
      "answer": "string — 2-4 sentences, specific",
      "evidence_skill": "skill_id or null",
      "data_gap": false,
      "urgency": "today|this_week|this_month or null",
      "chart_hint": {
        "type": "bar|horizontalBar|line|doughnut",
        "title": "string",
        "data_description": "string"
      } or null
    }
  ]
}
`.trim();

  const userMessage = `
SECTION TITLE: ${section.title}

SECTION CONCLUSION:
${section.content}

AVAILABLE EVIDENCE:
${evidenceBlock || 'No skill evidence available for this section.'}

Generate the reasoning tree for this section.
Start with the most important cause question,
then second-order implications, then either a
third-order strategic question OR a concrete action
(whichever is more useful given the evidence).

If evidence is thin, fewer nodes is better than
nodes with weak answers.
`.trim();

  try {
    const response = await callLLM(workspaceId, 'reason', {
      systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 1500,
      temperature: 0.2,
      _tracking: {
        workspaceId,
        skillId: 'question-tree',
        phase: 'synthesize',
        stepName: `tree-${section.id}`,
      },
    });

    const tokensUsed =
      (response.usage?.input || 0) +
      (response.usage?.output || 0);

    console.log(
      `[QuestionTree] ${section.id}: ${tokensUsed} tokens`
    );

    const raw = response.content
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();

    const parsed = JSON.parse(raw);
    const nodes: ReasoningNode[] =
      parsed.reasoning_tree || [];

    // Validate structure
    return nodes.filter(n =>
      n.layer && n.question && n.answer
    );

  } catch (err) {
    console.error(
      `[QuestionTree] Failed for ${section.id}:`, err
    );
    return [];
  }
}

/**
 * Runs question tree generation for all sections in parallel.
 * Non-fatal — sections without trees render normally.
 */
export async function generateAllReasoningTrees(
  sections: ReportSection[],
  skillSummaries: SkillSummary[],
  workspaceId: string,
  workspaceContext: {
    company_name: string;
    days_remaining_in_quarter: number;
    has_quota: boolean;
  }
): Promise<Map<string, ReasoningNode[]>> {

  const results = new Map<string, ReasoningNode[]>();

  // Run all sections in parallel — independent calls
  await Promise.all(
    sections.map(async section => {
      try {
        const tree = await generateReasoningTree(
          section, skillSummaries,
          workspaceId, workspaceContext
        );
        if (tree.length > 0) {
          results.set(section.id, tree);
        }
      } catch (err) {
        console.error(
          `[QuestionTree] Failed for ${section.id}:`, err
        );
        // Non-fatal
      }
    })
  );

  console.log(
    `[QuestionTree] Generated trees for ` +
    `${results.size}/${sections.length} sections`
  );

  return results;
}
