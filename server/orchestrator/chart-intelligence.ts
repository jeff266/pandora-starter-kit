/**
 * Chart Intelligence - DeepSeek-powered chart specification generator
 *
 * Decides which reasoning nodes should have charts, what type, what title
 * (as conclusion), and which data points prove the argument.
 *
 * Rules:
 * - Only chart 'cause' and 'action' layer nodes (not second_order or third_order)
 * - Max 2 charts per section
 * - Titles are conclusion-first ("Nate carries 89% of pipeline" not "Pipeline by rep")
 * - Semantic colors: dead=red, at-risk=amber, healthy=teal
 * - Orientation: labels >12 chars → horizontal_bar
 * - Non-fatal: if DeepSeek fails, continue without chart
 */

import { callLLM } from '../utils/llm-router.js';
import {
  ReasoningNode,
  ChartNodeSpec,
  ChartDataPoint,
  SkillSummary,
  AtRiskDeal,
  StaleDeal,
} from './types.js';

interface ChartDecision {
  node_index: number;
  should_chart: boolean;
  rationale: string;
  chart_type?: 'bar' | 'horizontalBar' | 'line' | 'doughnut';
  conclusion_title?: string;
  why_insight?: string;  // 1-2 sentence mechanism — WHY this data pattern exists; must NOT repeat section prose
  data_points?: Array<{
    label: string;
    value: number;
    color_hint?: 'dead' | 'at_risk' | 'healthy' | 'neutral';
  }>;
}

/**
 * Generates chart specifications for reasoning nodes using DeepSeek classification.
 * Non-fatal - returns empty array if generation fails.
 */
export async function generateChartSpecs(
  sectionId: string,
  reasoningNodes: ReasoningNode[],
  skillSummaries: SkillSummary[],
  workspaceId: string
): Promise<Map<number, ChartNodeSpec>> {

  const results = new Map<number, ChartNodeSpec>();

  // Only chart 'cause' and 'action' layer nodes
  const chartableNodes = reasoningNodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.layer === 'cause' || node.layer === 'action');

  if (chartableNodes.length === 0) {
    return results;
  }

  // Build evidence context for DeepSeek
  const evidenceContext = buildEvidenceContext(skillSummaries);
  const nodeDescriptions = chartableNodes.map(({ node, index }) => ({
    index,
    layer: node.layer,
    question: node.question,
    answer: node.answer,
    evidence_skill: node.evidence_skill,
  }));

  const systemPrompt = `
You are a data visualization expert for revenue operations reports.
Your job is to decide which reasoning nodes should have charts,
and generate complete chart specifications with conclusion-first titles.

RULES:
1. Only chart nodes where data exists to prove the claim
2. Max 2 charts total - choose the most impactful
3. Titles MUST state the conclusion, not describe the data:
   - GOOD: "Nate carries 89% of pipeline"
   - BAD: "Pipeline by rep"
4. Chart types:
   - horizontalBar: comparing named entities (reps, deals, accounts) by dollar amount — ALWAYS use this for rep pipeline comparisons
   - bar: short abstract labels (stage names, months, quarters)
   - line: trends over time
   - doughnut: ONLY for whole-pipeline composition between two abstract buckets (e.g., "Won vs At-Risk pipeline") — NEVER use for rep comparisons even if there are only 2 reps
5. Orientation:
   - Use horizontalBar for any rep, deal, or account comparison regardless of label length
   - Use horizontalBar if any label > 12 characters
   - Use bar for short labels (stage names, months)
6. Color hints:
   - dead: deals lost, stale >30 days, zero activity
   - at_risk: high risk scores, approaching deadline, stalled
   - healthy: won deals, on track, strong signals
   - neutral: time periods, stages, aggregate metrics
7. why_insight: Write 1-2 sentences explaining the MECHANISM behind the data pattern — the structural reason WHY it exists. Do not restate what the chart shows. Write at the level of diagnosis, not description. Example: "Quarter-end psychology: reps have mentally closed Q1 and shifted focus to Q2 pipeline, leaving in-flight deals without coverage at the moment they need it most."

OUTPUT: Valid JSON only. No preamble.

{
  "decisions": [
    {
      "node_index": number,
      "should_chart": boolean,
      "rationale": "string - why this node does/doesn't need a chart",
      "chart_type": "bar|horizontalBar|line|doughnut or null",
      "conclusion_title": "string - conclusion-first title or null",
      "why_insight": "string - 1-2 sentence mechanism behind the pattern, NOT a restatement of the data",
      "data_points": [
        {
          "label": "string",
          "value": number,
          "color_hint": "dead|at_risk|healthy|neutral or null"
        }
      ] or null
    }
  ]
}
`.trim();

  const userMessage = `
SECTION: ${sectionId}

REASONING NODES:
${JSON.stringify(nodeDescriptions, null, 2)}

AVAILABLE EVIDENCE:
${evidenceContext}

Generate chart specifications. Remember: max 2 charts,
conclusion-first titles, only chart if data exists to prove the claim.
`.trim();

  try {
    const response = await callLLM(workspaceId, 'classify', {
      systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 2000,
      temperature: 0.1,
      _tracking: {
        workspaceId,
        skillId: 'chart-intelligence',
        phase: 'synthesize',
        stepName: `chart-${sectionId}`,
      },
    });

    const tokensUsed =
      (response.usage?.input || 0) +
      (response.usage?.output || 0);

    console.log(
      `[ChartIntelligence] ${sectionId}: ${tokensUsed} tokens`
    );

    const raw = response.content
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();

    const parsed = JSON.parse(raw);
    const decisions: ChartDecision[] = parsed.decisions || [];

    // Apply max 2 charts limit
    const approvedCharts = decisions
      .filter(d => d.should_chart && d.chart_type && d.data_points)
      .slice(0, 2);

    for (const decision of approvedCharts) {
      const spec = buildChartNodeSpec(decision);
      if (spec) {
        results.set(decision.node_index, spec);
      }
    }

    console.log(
      `[ChartIntelligence] ${sectionId}: Generated ${results.size} charts`
    );

  } catch (err) {
    console.error(
      `[ChartIntelligence] Failed for ${sectionId}:`, err
    );
    // Non-fatal - continue without charts
  }

  return results;
}

function buildChartNodeSpec(decision: ChartDecision): ChartNodeSpec | null {
  if (!decision.chart_type || !decision.data_points || !decision.conclusion_title) {
    return null;
  }

  // Determine color scheme based on color hints
  const hasSemanticHints = decision.data_points.some(dp =>
    dp.color_hint && ['dead', 'at_risk', 'healthy'].includes(dp.color_hint)
  );
  const color_scheme = hasSemanticHints ? 'semantic' : 'categorical';

  // Validate and normalize data points
  const data_points: ChartDataPoint[] = decision.data_points
    .filter(dp => dp.label && typeof dp.value === 'number')
    .map(dp => ({
      label: dp.label,
      value: dp.value,
      color_hint: dp.color_hint || undefined,
    }));

  if (data_points.length === 0) {
    return null;
  }

  // Apply orientation rules
  let chart_type = decision.chart_type;
  let orientation_rationale: string | undefined;

  if (chart_type === 'bar' || chart_type === 'horizontalBar') {
    const maxLabelLength = Math.max(...data_points.map(dp => dp.label.length));
    if (maxLabelLength > 12 && chart_type === 'bar') {
      chart_type = 'horizontalBar';
      orientation_rationale = 'Horizontal orientation for long labels';
    }
  }

  // Named-entity comparison override:
  // Doughnut loses absolute dollar values. When ALL data points have neutral
  // color hints (rep names, account names, territory names — not risk buckets),
  // force horizontalBar so dollar amounts are visible on the x-axis.
  // Semantic doughnuts (at_risk vs healthy) are kept as doughnuts.
  if (chart_type === 'doughnut') {
    const allNeutral = data_points.every(
      dp => !dp.color_hint || dp.color_hint === 'neutral'
    );
    if (allNeutral) {
      chart_type = 'horizontalBar';
      orientation_rationale = 'Horizontal bar for named-entity comparison — dollar amounts matter more than percentages';
    }
  }

  return {
    chart_type,
    title: decision.conclusion_title,
    data_points,
    color_scheme,
    orientation_rationale,
    insight: decision.why_insight || undefined,
  };
}

function buildEvidenceContext(skillSummaries: SkillSummary[]): string {
  const parts: string[] = [];

  for (const summary of skillSummaries) {
    const lines: string[] = [`### ${summary.skill_id}`];

    // Key metrics
    if (Object.keys(summary.key_metrics).length > 0) {
      lines.push(`Metrics: ${JSON.stringify(summary.key_metrics)}`);
    }

    // At-risk deals
    if (summary.at_risk_deals && summary.at_risk_deals.length > 0) {
      lines.push(`At-risk deals (${summary.at_risk_deals.length}):`);
      for (const deal of summary.at_risk_deals.slice(0, 3)) {
        lines.push(
          `  ${deal.name}: $${Math.round(deal.amount / 1000)}K, ` +
          `risk ${deal.risk_score}, owner ${deal.owner}`
        );
      }
    }

    // Stale deals
    if (summary.stale_deals && summary.stale_deals.length > 0) {
      lines.push(`Stale deals (${summary.stale_deals.length}):`);
      for (const deal of summary.stale_deals.slice(0, 3)) {
        lines.push(
          `  ${deal.name}: $${Math.round(deal.amount / 1000)}K, ` +
          `${deal.days_stale}d dark, owner ${deal.owner}`
        );
      }
    }

    parts.push(lines.join('\n'));
  }

  if (parts.length === 0) {
    return 'No skill evidence available for charting.';
  }

  return parts.join('\n\n');
}
