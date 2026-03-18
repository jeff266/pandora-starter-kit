/**
 * Chart Trigger — Ask Pandora response chart generator
 *
 * After Ask Pandora generates a text response, this module
 * inspects the tool call results for chartable numeric data
 * and, if found, runs Chart Intelligence to decide whether
 * a chart should be generated and what it should show.
 *
 * Non-fatal: if anything fails, the text response is returned
 * unchanged without a chart.
 */

import type { ChartNodeSpec, SkillSummary, ReasoningNode, AtRiskDeal, StaleDeal } from '../orchestrator/types.js';
import { generateChartSpecs } from '../orchestrator/chart-intelligence.js';
import { renderChartFromSpec } from '../orchestrator/chart-renderer.js';
import type { PandoraToolCall } from './pandora-agent.js';

export interface ResponseChart {
  spec: ChartNodeSpec;
  png_base64: string;
  suggested_section_id?: string;
}

/**
 * Detects whether an Ask Pandora response contains chartable
 * data and, if so, generates a chart via Chart Intelligence.
 *
 * Called after the response text is assembled. Non-fatal.
 */
export async function maybeGenerateResponseChart(
  question: string,
  responseText: string,
  toolTrace: PandoraToolCall[],
  workspaceId: string
): Promise<ResponseChart | null> {
  try {
    const toolResults = toolTrace.map(t => t.result);

    const chartableData = extractChartableData(question, responseText, toolResults);
    if (!chartableData) return null;

    const suggestedSectionId = suggestSectionId(question);

    const syntheticNode: ReasoningNode = {
      layer: 'cause',
      question,
      answer: responseText.slice(0, 500),
      data_gap: false,
    };

    const syntheticSummaries = buildSyntheticSummaries(toolResults, chartableData);

    const specs = await generateChartSpecs(
      suggestedSectionId,
      [syntheticNode],
      syntheticSummaries,
      workspaceId
    );

    if (!specs.has(0)) return null;

    const spec = specs.get(0)!;

    const pngBuffer = await renderChartFromSpec(spec);

    console.log(`[AskPandora] Generated chart: "${spec.title}"`);

    return {
      spec,
      png_base64: pngBuffer.toString('base64'),
      suggested_section_id: suggestedSectionId,
    };
  } catch (err) {
    console.error('[AskPandora] Chart generation failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Chartable data extraction
// ---------------------------------------------------------------------------

interface ChartableDeals {
  type: 'deals';
  deals: any[];
}

interface ChartableMetrics {
  type: 'metrics';
  metrics: Record<string, number>;
}

type ChartableData = ChartableDeals | ChartableMetrics;

function extractChartableData(
  question: string,
  responseText: string,
  toolResults: any[]
): ChartableData | null {
  for (const result of toolResults) {
    if (!result) continue;

    // query_deals result: { deals: [...], total_count, total_amount }
    if (Array.isArray(result.deals) && result.deals.length >= 2) {
      return { type: 'deals', deals: result.deals.slice(0, 8) };
    }

    // Raw array of deal-shaped objects
    if (Array.isArray(result) && result.length >= 2 && result[0]?.amount !== undefined) {
      return { type: 'deals', deals: result.slice(0, 8) };
    }

    // Aggregated numeric map
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      const numericEntries = Object.entries(result).filter(
        ([, v]) => typeof v === 'number' && (v as number) > 0
      );
      if (numericEntries.length >= 2) {
        return {
          type: 'metrics',
          metrics: Object.fromEntries(numericEntries) as Record<string, number>,
        };
      }
    }
  }

  // Heuristic: response mentions 3+ dollar amounts
  const dollarAmounts = responseText.match(/\$[\d,]+[KMB]?/g);
  if (dollarAmounts && dollarAmounts.length >= 3) {
    // Not enough structured data — let Chart Intelligence decide based on text
    // Return null; text-only heuristic is too unreliable for chart generation
    return null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Synthetic SkillSummary builder
// ---------------------------------------------------------------------------

function buildSyntheticSummaries(
  toolResults: any[],
  chartableData: ChartableData
): SkillSummary[] {
  const now = new Date().toISOString();

  if (chartableData.type === 'deals') {
    const deals = chartableData.deals;

    const atRiskDeals: AtRiskDeal[] = deals
      .filter((d: any) => d.amount > 0)
      .map((d: any) => ({
        name: d.name || d.deal_name || 'Unknown',
        amount: Number(d.amount) || 0,
        owner: d.owner_email || d.owner || '',
        stage: d.stage_normalized || d.stage || '',
        risk_score: d.deal_risk ?? d.risk_score ?? 50,
        risk_factors: d.deal_risk_factors || [],
        days_in_stage: d.days_in_stage || 0,
        close_date: d.close_date || '',
        recommended_action: d.recommended_action,
      }));

    const staleDeals: StaleDeal[] = deals
      .filter((d: any) => (d.days_since_activity ?? d.days_stale ?? 0) > 14)
      .map((d: any) => ({
        name: d.name || 'Unknown',
        amount: Number(d.amount) || 0,
        owner: d.owner_email || '',
        stage: d.stage_normalized || '',
        days_stale: d.days_since_activity ?? d.days_stale ?? 0,
        last_activity_date: d.last_activity_date || '',
      }));

    const totalPipeline = deals.reduce(
      (s: number, d: any) => s + Number(d.amount || 0), 0
    );

    return [{
      skill_id: 'ask-pandora-query',
      ran_at: now,
      headline: `${deals.length} deals totaling $${Math.round(totalPipeline / 1000)}K`,
      data_age_hours: 0,
      has_signal: true,
      top_findings: [],
      top_actions: [],
      key_metrics: {
        total_deals: deals.length,
        total_pipeline: totalPipeline,
      },
      at_risk_deals: atRiskDeals.length > 0 ? atRiskDeals : undefined,
      stale_deals: staleDeals.length > 0 ? staleDeals : undefined,
    }];
  }

  if (chartableData.type === 'metrics') {
    const entries = Object.entries(chartableData.metrics);
    const headline = entries
      .slice(0, 2)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');

    return [{
      skill_id: 'ask-pandora-query',
      ran_at: now,
      headline,
      data_age_hours: 0,
      has_signal: true,
      top_findings: [],
      top_actions: [],
      key_metrics: chartableData.metrics,
    }];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Section heuristic
// ---------------------------------------------------------------------------

function suggestSectionId(question: string): string {
  const q = question.toLowerCase();

  if (q.includes('close') || q.includes('forecast') ||
      q.includes('quarter') || q.includes('target'))
    return 'node-deal-execution';

  if (q.includes('stage') || q.includes('progress') ||
      q.includes('stall') || q.includes('stuck') ||
      q.includes('pipeline'))
    return 'node-pipeline-conv';

  if (q.includes('rep') || q.includes('nate') ||
      q.includes('sara') || q.includes('team') ||
      q.includes('attainment'))
    return 'node-team-execution';

  if (q.includes('q2') || q.includes('next quarter') ||
      q.includes('coverage') || q.includes('future'))
    return 'node-forward-look';

  return 'node-deal-execution';
}
