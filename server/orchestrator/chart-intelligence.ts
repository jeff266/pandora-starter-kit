/**
 * Chart Intelligence — Two-Step Haiku + Rules Architecture
 *
 * Step 1: Claude Haiku reasons about what decision-forcing question
 *         a chart must answer for the VP to act today.
 *         Output: ChartQuestion (structured JSON)
 *
 * Step 2: Rules resolve ChartQuestion → ChartNodeSpec deterministically.
 *         No model variance. Fully testable.
 *
 * DeepSeek is removed entirely from chart intelligence.
 *
 * Rules:
 * - Only chart 'cause' and 'action' layer nodes
 * - Max 2 charts per section
 * - Titles are conclusion-first ("Nate carries 89% of pipeline")
 * - Semantic colors: dead=red, at_risk=amber, healthy/actual=teal, target=gray
 * - Orientation: labels >12 chars → horizontalBar (enforced by rule, not model)
 * - Non-fatal: if Haiku fails, node gets no chart, report continues
 */

import { callLLM } from '../utils/llm-router.js';
import {
  ReasoningNode,
  ChartNodeSpec,
  ChartDataPoint,
  SkillSummary,
  AtRiskDeal,
  StaleDeal,
  ChartQuestion,
} from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface AvailableDataSummary {
  atRiskDeals: AtRiskDeal[];
  staleDeals: StaleDeal[];
  repData: { name: string; pipeline: number }[];
  keyMetrics: { key: string; value: string | number }[];
  hasNumericData: boolean;
}

/**
 * Aggregate all skill evidence into a flat, queryable summary.
 * Called once per node (data is small; aggregation cost is negligible).
 */
function buildAvailableDataBlock(
  skillSummaries: SkillSummary[]
): AvailableDataSummary {
  const atRiskDeals: AtRiskDeal[] = [];
  const staleDeals: StaleDeal[] = [];
  const keyMetrics: { key: string; value: string | number }[] = [];
  const repData: { name: string; pipeline: number }[] = [];

  for (const skill of skillSummaries) {
    // At-risk deals
    if (skill.at_risk_deals?.length) {
      atRiskDeals.push(...skill.at_risk_deals);
    }

    // Stale deals
    if (skill.stale_deals?.length) {
      staleDeals.push(...skill.stale_deals);
    }

    // Key metrics
    for (const [key, value] of Object.entries(skill.key_metrics)) {
      keyMetrics.push({ key: `${skill.skill_id}.${key}`, value });
    }

    // Rep/owner pipeline from key_metrics
    for (const [key, val] of Object.entries(skill.key_metrics)) {
      if ((key.includes('rep') || key.includes('owner'))
          && key.includes('pipeline')
          && !key.includes('total')) {
        const name = key
          .replace(/_pipeline|_open/g, '')
          .replace(/_/g, ' ')
          .trim();
        const value = Number(val);
        if (value > 0 && name.length > 0) {
          repData.push({ name, pipeline: value });
        }
      }
    }
  }

  // Deduplicate rep entries by name, keeping highest pipeline value
  const repMap = new Map<string, number>();
  for (const r of repData) {
    repMap.set(r.name, Math.max(repMap.get(r.name) ?? 0, r.pipeline));
  }
  const repDataDeduped = Array.from(repMap.entries())
    .map(([name, pipeline]) => ({ name, pipeline }))
    .sort((a, b) => b.pipeline - a.pipeline)
    .slice(0, 4);

  const hasNumericData =
    atRiskDeals.length > 0 ||
    staleDeals.length > 0 ||
    repDataDeduped.length > 0 ||
    keyMetrics.some(m => typeof m.value === 'number' && (m.value as number) > 0);

  return {
    atRiskDeals,
    staleDeals,
    repData: repDataDeduped,
    keyMetrics,
    hasNumericData,
  };
}

// ---------------------------------------------------------------------------
// Step 1: Haiku reasoning
// ---------------------------------------------------------------------------

/**
 * Step 1: Haiku reasons about what question the chart must answer
 * for the VP to act. This is the ONLY LLM call in chart intelligence.
 *
 * Routes via 'reason' capability (Claude Sonnet by default;
 * configure workspace routing to 'anthropic/claude-haiku-4-5-20251001'
 * for cost-optimal chart intelligence — ~$0.0001 per node vs ~$0.0008).
 */
async function reasonAboutChart(
  node: ReasoningNode,
  availableData: AvailableDataSummary,
  workspaceId: string
): Promise<ChartQuestion> {
  const systemPrompt = `You are advising a VP of Revenue Operations who must make a decision today.

Your job: given a reasoning node from a sales intelligence report, decide what question a chart should answer — if a chart is warranted at all.

A chart is warranted when it makes a specific decision OBVIOUS in 3 seconds. It is NOT warranted when it merely describes a state the VP already knows from reading the text.

The worst charts:
- Show portfolio composition as a default (pie charts showing % closed vs % open)
- Describe history when the VP needs to act now
- Answer a question nobody asked

The best charts for late-quarter deal sections:
- Show which specific deals can close vs cannot
- Show how long deals have been silent
- Show which rep owns the risk

Output ONLY valid JSON. No explanation.`;

  const userMessage = `REASONING NODE:
Layer: ${node.layer}
Question: "${node.question}"
Answer: "${node.answer.slice(0, 400)}"

AVAILABLE DATA:
${availableData.atRiskDeals.length > 0
  ? `At-risk deals (${availableData.atRiskDeals.length}):
${availableData.atRiskDeals.map(d =>
    `  ${d.name} $${Math.round(d.amount / 1000)}K risk:${d.risk_score} ${d.days_in_stage}d in stage`
  ).join('\n')}`
  : 'No at-risk deals'}

${availableData.staleDeals.length > 0
  ? `Stale deals (${availableData.staleDeals.length}):
${availableData.staleDeals.map(d =>
    `  ${d.name} $${Math.round(d.amount / 1000)}K ${d.days_stale}d dark`
  ).join('\n')}`
  : 'No stale deal data'}

${availableData.repData.length > 0
  ? `Rep data:\n${availableData.repData.map(r =>
    `  ${r.name} $${Math.round(r.pipeline / 1000)}K`
  ).join('\n')}`
  : ''}

${availableData.keyMetrics.length > 0
  ? `Key metrics:\n${availableData.keyMetrics
    .slice(0, 6).map(m => `  ${m.key}: ${m.value}`)
    .join('\n')}`
  : ''}

Respond ONLY with JSON:
{
  "vp_decision": "one sentence: what must VP decide?",
  "chart_question": "one sentence: what does chart answer?",
  "question_type": "deal_triage|deal_timing|rep_comparison|pipeline_composition|coverage_gap|trend|metric_comparison|not_chartable",
  "preferred_data": "at_risk_deals|stale_deals|rep_performance|key_metrics|none",
  "reasoning": "one sentence: why this type"
}`;

  // 'reason' routes to Claude Sonnet by default.
  // Configure workspace routing to 'anthropic/claude-haiku-4-5-20251001'
  // for cheapest chart classification (~$0.0001/node).
  const response = await callLLM(workspaceId, 'reason', {
    systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 300,
    temperature: 0.1,
    _tracking: {
      workspaceId,
      skillId: 'chart-intelligence',
      phase: 'reason',
      stepName: `chart-question-${node.layer}`,
    },
  });

  const tokensUsed =
    (response.usage?.input || 0) + (response.usage?.output || 0);

  const raw = response.content
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();

  const parsed = JSON.parse(raw);

  console.log(
    `[ChartIntelligence] node ${node.layer}: ` +
    `${tokensUsed} tokens → ${parsed.question_type} — ${parsed.reasoning}`
  );

  return parsed as ChartQuestion;
}

// ---------------------------------------------------------------------------
// Step 2: Deterministic resolver
// ---------------------------------------------------------------------------

/**
 * Extract rep pipeline data from coverage skill key_metrics.
 */
function buildRepData(
  coverageSkill: SkillSummary | undefined
): { name: string; pipeline: number }[] {
  if (!coverageSkill?.key_metrics) return [];

  const reps: { name: string; pipeline: number }[] = [];
  for (const [key, val] of Object.entries(coverageSkill.key_metrics)) {
    if ((key.includes('rep') || key.includes('owner'))
        && key.includes('pipeline')
        && !key.includes('total')) {
      const name = key
        .replace(/_pipeline|_open/g, '')
        .replace(/_/g, ' ')
        .trim();
      const value = Number(val);
      if (value > 0 && name.length > 0) {
        reps.push({ name, pipeline: value });
      }
    }
  }

  return reps
    .sort((a, b) => b.pipeline - a.pipeline)
    .slice(0, 4);
}

/**
 * Step 2: Rules resolve ChartQuestion → ChartNodeSpec.
 *
 * question_type drives data source selection.
 * Data shape drives orientation and colors.
 * Guards block nonsensical chart types (line without time series, etc.).
 *
 * Fully deterministic — no model calls.
 */
function resolveChartFromQuestion(
  question: ChartQuestion,
  skillSummaries: SkillSummary[]
): ChartNodeSpec | null {
  const riskSkill = skillSummaries.find(
    s => s.skill_id === 'deal-risk-review'
  );
  const hygieneSkill = skillSummaries.find(
    s => s.skill_id === 'pipeline-hygiene'
  );
  const coverageSkill = skillSummaries.find(
    s => s.skill_id === 'pipeline-coverage'
  );

  switch (question.question_type) {
    case 'deal_triage':
    case 'deal_timing': {
      // Horizontal bar showing named deals sorted by risk score.
      // Color by risk: dead=red, at_risk=amber, healthy=teal.
      // Always horizontal — deal names are long labels.
      const deals = riskSkill?.at_risk_deals || [];
      if (deals.length < 2) return null;

      const dataPoints: ChartDataPoint[] = deals
        .sort((a, b) => b.risk_score - a.risk_score)
        .slice(0, 6)
        .map(d => ({
          label: d.name,
          value: Math.round(d.amount / 1000),
          color_hint: (
            d.risk_score > 80 ? 'dead' :
            d.risk_score > 60 ? 'at_risk' :
            'healthy'
          ) as ChartDataPoint['color_hint'],
        }));

      return {
        chart_type: 'horizontalBar',
        title: question.chart_question,
        data_points: dataPoints,
        color_scheme: 'semantic',
        insight: question.reasoning,
      };
    }

    case 'rep_comparison': {
      // Bar chart: each rep's pipeline.
      // First rep is teal (actual), rest are gray (target/neutral).
      const repData = buildRepData(coverageSkill);
      if (repData.length < 2) return null;

      const dataPoints: ChartDataPoint[] = repData.map((r, i) => ({
        label: r.name,
        value: Math.round(r.pipeline / 1000),
        color_hint: (i === 0 ? 'actual' : 'neutral') as ChartDataPoint['color_hint'],
      }));

      // Short rep names (≤12 chars) → bar; long names → horizontalBar
      const hasLongLabel = dataPoints.some(dp => dp.label.length > 12);

      return {
        chart_type: hasLongLabel ? 'horizontalBar' : 'bar',
        title: question.chart_question,
        data_points: dataPoints,
        color_scheme: 'comparative',
        insight: question.reasoning,
      };
    }

    case 'coverage_gap': {
      // Two-bar: actual pipeline vs coverage target.
      const m = coverageSkill?.key_metrics || {};
      const actual = Number(
        m['pipeline-coverage.total_pipeline'] || m['total_pipeline'] || 0
      );
      const target = Number(
        m['pipeline-coverage.quota'] || m['quota'] || 0
      );
      if (actual === 0 && target === 0) return null;

      return {
        chart_type: 'bar',
        title: question.chart_question,
        data_points: [
          {
            label: 'Open Pipeline',
            value: Math.round(actual / 1000),
            color_hint: 'actual',
          },
          {
            label: 'Coverage Target',
            value: Math.round(target / 1000),
            color_hint: 'target',
          },
        ],
        color_scheme: 'comparative',
        insight: question.reasoning,
      };
    }

    case 'pipeline_composition': {
      // Donut — ONLY when composition IS the argument, not as a default fallback.
      // Haiku must explicitly classify this as pipeline_composition.
      const m = coverageSkill?.key_metrics || {};
      const closed = Number(
        m['forecast-rollup.closed_won'] || m['closed_won'] || 0
      );
      const open = Number(
        m['pipeline-coverage.total_pipeline'] || m['total_pipeline'] || 0
      );
      if (closed === 0 && open === 0) return null;

      return {
        chart_type: 'doughnut',
        title: question.chart_question,
        data_points: [
          {
            label: 'Closed Won',
            value: Math.round(closed / 1000),
            color_hint: 'positive',
          },
          {
            label: 'Open Pipeline',
            value: Math.round(open / 1000),
            color_hint: 'target',
          },
        ],
        color_scheme: 'semantic',
        insight: question.reasoning,
      };
    }

    case 'metric_comparison': {
      // 3+ discrete values compared on same metric.
      // Uniform teal bars — no semantic distinction between items.
      // Pull top key_metrics that look like dollar/count comparisons.
      const m = coverageSkill?.key_metrics || riskSkill?.key_metrics || {};
      const candidates = Object.entries(m)
        .filter(([, v]) => typeof v === 'number' && (v as number) > 0)
        .slice(0, 5);

      if (candidates.length < 2) return null;

      return {
        chart_type: 'bar',
        title: question.chart_question,
        data_points: candidates.map(([key, value]) => ({
          label: key.replace(/^[^.]+\./, '').replace(/_/g, ' '),
          value: Math.round(Number(value) / 1000),
        })),
        color_scheme: 'uniform',
        insight: question.reasoning,
      };
    }

    case 'trend': {
      // Line chart — BLOCKED if < 3 data points.
      // Most single-report nodes won't have time series.
      // Reserved for prior_context week-over-week data (future feature).
      console.log(
        '[ChartIntelligence] Trend chart requested but no time series data available — skipping'
      );
      return null;
    }

    case 'not_chartable':
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Per-node orchestrator
// ---------------------------------------------------------------------------

/**
 * Classify a single reasoning node via two-step Haiku + rules.
 * Non-fatal: returns null if Haiku fails or data is insufficient.
 */
async function classifyChartForNode(
  node: ReasoningNode,
  skillSummaries: SkillSummary[],
  workspaceId: string
): Promise<ChartNodeSpec | null> {
  const availableData = buildAvailableDataBlock(skillSummaries);

  // Short-circuit: no numeric data means no chart is possible
  if (!availableData.hasNumericData) return null;

  // Step 1: Haiku reasons about VP decision
  const question = await reasonAboutChart(node, availableData, workspaceId);

  if (question.question_type === 'not_chartable') {
    console.log(
      `[ChartIntelligence] ${node.layer}: not chartable — ${question.reasoning}`
    );
    return null;
  }

  // Step 2: Rules resolve ChartQuestion → ChartNodeSpec
  const spec = resolveChartFromQuestion(question, skillSummaries);

  if (!spec || spec.data_points.length < 2) {
    return null;
  }

  // Orientation guard: enforce horizontalBar for any long-label non-donut chart
  if (
    spec.chart_type !== 'doughnut' &&
    spec.chart_type !== 'line' &&
    spec.data_points.some(d => d.label.length > 12)
  ) {
    spec.chart_type = 'horizontalBar';
  }

  return spec;
}

// ---------------------------------------------------------------------------
// Public API — called by the orchestrator
// ---------------------------------------------------------------------------

/**
 * Generates chart specifications for reasoning nodes using two-step
 * Haiku + rules architecture.
 *
 * Processes each eligible node independently (cause/action layers only).
 * Max 2 charts per section. Non-fatal — returns empty map if generation fails.
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

  // Process nodes sequentially — Haiku is fast, and sequential order
  // preserves the max-2-charts-per-section limit cleanly.
  for (const { node, index } of chartableNodes) {
    if (results.size >= 2) {
      // Hit section cap — stop processing further nodes
      break;
    }

    try {
      const spec = await classifyChartForNode(node, skillSummaries, workspaceId);
      if (spec) {
        results.set(index, spec);
        console.log(
          `[ChartIntelligence] ${sectionId}[${index}]: ` +
          `${spec.chart_type} chart — "${spec.title}"`
        );
      }
    } catch (err) {
      // Non-fatal: log and continue to next node
      console.error(
        `[ChartIntelligence] Failed for ${sectionId}[${index}]:`, err
      );
    }
  }

  console.log(
    `[ChartIntelligence] ${sectionId}: Generated ${results.size} chart(s)`
  );

  return results;
}
