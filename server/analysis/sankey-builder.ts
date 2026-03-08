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
  activeFilter?: { type: 'all' | 'pipeline' | 'scope'; id?: string; label: string },
  raw = false
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

  // 1b. In raw mode for a specific pipeline, fetch CRM display names from stage_configs.
  //     stage_configs.stage_name is the human-readable label (e.g. "Demo Conducted")
  //     while stage_configs.stage_id is the raw CRM key (e.g. "decisionmakerboughtin").
  const stageNameMap = new Map<string, string>();
  if (raw && activeFilter?.type === 'pipeline' && activeFilter.id) {
    const scRows = await query<{ stage_id: string; stage_name: string }>(
      `SELECT stage_id, stage_name
       FROM stage_configs
       WHERE workspace_id = $1
         AND pipeline_name = $2`,
      [workspaceId, activeFilter.id]
    ).then(r => r.rows).catch(() => [] as Array<{ stage_id: string; stage_name: string }>);
    for (const row of scRows) {
      if (row.stage_name) stageNameMap.set(row.stage_id, row.stage_name);
    }
  }

  // 2. Build stage nodes from current result.
  // Keep stages that have any historical activity (entered OR endOfPeriod OR won),
  // so the funnel includes stages that were actively traversed during the period.
  const stages: SankeyStageNode[] = current.stages
    .filter(s => s.entered > 0 || s.endOfPeriod > 0 || s.startOfPeriod > 0 || s.won > 0)
    .map(s => {
      // Use stage_configs display name when available (raw+pipeline mode), otherwise format the key.
      const formattedLabel = stageNameMap.get(s.stage) ?? formatStageName(s.stage);

      // In raw mode the stage IS the raw CRM name — no rawLabel needed.
      // In normalized mode, rawLabel surfaces the original CRM stage names that
      // collapsed into this normalized bucket (e.g. "Appt Scheduled / Qualified").
      let rawLabel: string | undefined;
      if (!raw) {
        const rawSet = rawByNormalized.get(s.stage);
        // Only set rawLabel when it is a human-readable value that differs from
        // the normalized label. Filter out:
        //   - Purely numeric IDs (e.g. HubSpot stage IDs like 1027734847)
        //   - All-lowercase concatenated keys with no word boundaries
        //     (e.g. 'contractsent', 'appointmentscheduled') — these are internal
        //     CRM keys, not display labels. A readable raw value must contain at
        //     least one underscore, space, or uppercase letter.
        const rawNames = rawSet
          ? [...rawSet].filter(r => {
              if (!/[a-zA-Z]/.test(r)) return false;
              if (!/[_\s]/.test(r) && !/[A-Z]/.test(r)) return false;
              return true;
            })
          : [];
        const formattedRawNames = rawNames.map(r => formatStageName(r));
        const rawLabelStr = [...new Set(formattedRawNames)].join(' / ');
        rawLabel = rawLabelStr && rawLabelStr !== formattedLabel ? rawLabelStr : undefined;
      }

      return {
        id: s.stage,
        label: formattedLabel,
        rawLabel,
        deals: s.endOfPeriod,
        value: s.endOfPeriodValue,
        entered: s.entered,
        enteredValue: s.enteredValue,
        won: s.won,
        wonValue: s.wonValue,
        lostCount: s.fellOut,
        lostValue: s.fellOutValue,
      };
    });

  // Drop leading stages that have fewer historical entries than the next stage.
  // These are bypass-able pre-funnel stages (e.g. 'Awareness' with 3 deals
  // while 'Qualification' has 38) that would create an inverted funnel start.
  while (stages.length >= 2 && stages[0].entered < stages[1].entered) {
    stages.shift();
  }

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
      numerator: curr?.advanced ?? 0,
      denominator,
      startOfPeriod: curr?.startOfPeriod ?? 0,
      entered: curr?.entered ?? 0,
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
    // Split camelCase: 'contractSent' → 'contract Sent'
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // Split PascalCase starts: 'ContractSent' → 'Contract Sent'
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function buildPeriodLabel(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}`;
}
