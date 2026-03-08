/**
 * Sankey Chart Data Builder
 *
 * Converts WaterfallResult into SankeyChartData suitable for the
 * interactive pipeline funnel visualization. Fetches available
 * filter options (CRM pipelines, analysis scopes) so the chart
 * component can render a filter bar without extra API calls.
 */

import { query } from '../db.js';
import type { WaterfallResult } from './waterfall-analysis.js';
import type { SankeyChartData, SankeyStageNode, SankeyFlow, SankeyConversionRate } from '../reports/types.js';

// ============================================================================
// buildSankeyChartData
// ============================================================================

export async function buildSankeyChartData(
  workspaceId: string,
  current: WaterfallResult,
  previous?: WaterfallResult,
  activeFilter?: { type: 'all' | 'pipeline' | 'scope'; id?: string; label: string }
): Promise<SankeyChartData> {

  // 1. Fetch raw→normalized stage name mapping for this workspace
  const rawStageRows = await query<{ raw: string; normalized: string }>(
    `SELECT DISTINCT stage AS raw, COALESCE(stage_normalized, stage) AS normalized
     FROM deal_stage_history
     WHERE workspace_id = $1`,
    [workspaceId]
  ).then(r => r.rows).catch(() => [] as Array<{ raw: string; normalized: string }>);

  // Map normalized → set of distinct raw names
  const rawByNormalized = new Map<string, Set<string>>();
  for (const row of rawStageRows) {
    if (!rawByNormalized.has(row.normalized)) rawByNormalized.set(row.normalized, new Set());
    rawByNormalized.get(row.normalized)!.add(row.raw);
  }

  // 2. Build stage nodes from current result
  const stages: SankeyStageNode[] = current.stages
    .filter(s => s.endOfPeriod > 0 || s.startOfPeriod > 0 || s.won > 0)
    .map(s => {
      const formattedLabel = formatStageName(s.stage);
      const rawSet = rawByNormalized.get(s.stage);
      // Only set rawLabel when it differs from the formatted label
      const rawNames = rawSet ? [...rawSet] : [];
      const rawLabel = rawNames.length > 0 && rawNames.join(' / ') !== formattedLabel
        ? rawNames.join(' / ')
        : undefined;
      return {
        id: s.stage,
        label: formattedLabel,
        rawLabel,
        deals: s.endOfPeriod,
        value: s.endOfPeriodValue,
        won: s.won,
        wonValue: s.wonValue,
        lostCount: s.fellOut,
        lostValue: s.fellOutValue,
      };
    });

  // 3. Build flows from pairwise stage flow data
  const flows: SankeyFlow[] = current.flows.map(f => ({
    fromId: f.fromStage,
    toId: f.toStage,
    deals: f.count,
    value: f.value,
  }));

  // 3. Build conversion rates (with WoW deltas if previous is available)
  //    Map previous stage data for quick lookup
  const prevStageMap = new Map(
    (previous?.stages ?? []).map(s => [s.stage, s])
  );

  const conversionRates: SankeyConversionRate[] = stages.slice(0, -1).map((fromStage, i) => {
    const toStage = stages[i + 1];
    const curr = current.stages.find(s => s.stage === fromStage.id);
    const denominator = (curr?.startOfPeriod ?? 0) + (curr?.entered ?? 0);
    const rate = denominator > 0
      ? Math.round(((curr?.advanced ?? 0) / denominator) * 100)
      : 0;

    let delta: number | undefined;
    if (previous) {
      const prev = prevStageMap.get(fromStage.id);
      const prevDenominator = (prev?.startOfPeriod ?? 0) + (prev?.entered ?? 0);
      const prevRate = prevDenominator > 0
        ? Math.round(((prev?.advanced ?? 0) / prevDenominator) * 100)
        : 0;
      delta = rate - prevRate;
    }

    return {
      fromLabel: fromStage.label,
      toLabel: toStage.label,
      rate,
      ...(delta !== undefined ? { delta } : {}),
    };
  });

  // 4. Fetch available filter options
  const [pipelineRows, scopeRows] = await Promise.all([
    // Distinct CRM pipeline names from deals
    query<{ pipeline: string }>(
      `SELECT DISTINCT pipeline
       FROM deals
       WHERE workspace_id = $1
         AND pipeline IS NOT NULL
         AND pipeline != ''
       ORDER BY pipeline`,
      [workspaceId]
    ).then(r => r.rows).catch(() => [] as Array<{ pipeline: string }>),

    // Confirmed analysis scopes (excluding default)
    query<{ id: string; name: string }>(
      `SELECT scope_id AS id, name
       FROM analysis_scopes
       WHERE workspace_id = $1
         AND confirmed = true
         AND scope_id != 'default'
       ORDER BY name`,
      [workspaceId]
    ).then(r => r.rows).catch(() => [] as Array<{ id: string; name: string }>),
  ]);

  // 5. Build period label
  const periodLabel = buildPeriodLabel(current.periodStart, current.periodEnd);

  return {
    type: 'sankey',
    stages,
    flows,
    conversionRates,
    periodLabel,
    activeFilter: activeFilter ?? { type: 'all', label: 'All Deals' },
    availableFilters: {
      pipelines: pipelineRows.map(r => r.pipeline),
      scopes: scopeRows,
    },
  };
}

// ============================================================================
// Helpers
// ============================================================================

function formatStageName(stage: string): string {
  return stage
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function buildPeriodLabel(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}`;
}
