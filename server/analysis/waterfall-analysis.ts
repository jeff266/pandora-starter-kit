/**
 * Pipeline Waterfall Analysis
 *
 * Computes stage-by-stage pipeline flow showing where deals enter,
 * advance, stall, and fall out of each stage.
 */

import { query } from '../db.js';
import { getStageTransitionsInWindow, getStageConversionRates, getAverageTimeInStage } from './stage-history-queries.js';
import { getScopeWhereClause, type ActiveScope } from '../config/scope-loader.js';

export interface WaterfallStageFlow {
  stage: string;
  startOfPeriod: number;         // Deals in this stage at period start
  entered: number;                // Deals that transitioned INTO this stage
  advanced: number;               // Deals that moved to a later stage
  fellBack: number;               // Deals that moved to an earlier stage
  fellOut: number;                // Deals that closed-lost from this stage
  won: number;                    // Deals that closed-won from this stage
  endOfPeriod: number;            // Deals in this stage at period end
  endOfPeriodValue: number;       // $ sum of open deals in this stage at period end
  netChange: number;              // endOfPeriod - startOfPeriod
  enteredValue: number;           // $ sum of deals entered
  advancedValue: number;          // $ sum of deals advanced
  fellOutValue: number;           // $ sum of deals that fell out
  wonValue: number;               // $ sum of deals won
}

export interface WaterfallFlow {
  fromStage: string;
  toStage: string;
  count: number;
  value: number;
}

export interface WaterfallResult {
  stages: WaterfallStageFlow[];
  flows: WaterfallFlow[];
  summary: {
    newPipelineCreated: { count: number; value: number };
    closedWon: { count: number; value: number };
    closedLost: { count: number; value: number };
    netPipelineChange: number;
    totalOpenStart: number;
    totalOpenEnd: number;
  };
  periodStart: Date;
  periodEnd: Date;
}

export interface WaterfallFilterParams {
  scopeId?: string;
  pipeline?: string;
  raw?: boolean;   // When true, use raw (unnormalized) CRM stage names throughout
}

/**
 * Get ordered list of pipeline stages
 *
 * Always infers order from actual deal flow data instead of trusting potentially
 * incorrect HubSpot metadata. Uses MIN position per deal to avoid inflation from
 * duplicate stage IDs that normalize to the same value.
 */
async function getStageOrdering(workspaceId: string, raw = false, pipeline?: string): Promise<string[]> {
  // Infer order by computing average sequence position of each stage across all deals.
  // Stages that appear earlier in deal timelines (lower avg position) sort first.
  // When raw=true, use the literal CRM stage name; otherwise use the normalized name.
  const TERMINAL_RAW = new Set([
    'closed_won', 'closedwon', 'closed won',
    'closed_lost', 'closedlost', 'closed lost',
  ]);

  // When viewing raw stages for a specific pipeline, use stage_configs which contains
  // the CRM-assigned display_order — far more reliable than inferring order from deal
  // flow heuristics which can be skewed by multi-pipeline data.
  if (raw && pipeline) {
    const scResult = await query<{ stage_id: string }>(
      `SELECT stage_id
       FROM stage_configs
       WHERE workspace_id = $1
         AND pipeline_name = $2
         AND is_active = true
         AND LOWER(stage_id) NOT IN ('closedwon','closedlost','closed_won','closed_lost')
       ORDER BY display_order`,
      [workspaceId, pipeline]
    ).catch(() => ({ rows: [] as Array<{ stage_id: string }> }));

    if (scResult.rows.length > 0) {
      return scResult.rows.map(r => r.stage_id);
    }
  }

  const stageExpr = raw
    ? 'stage'
    : 'COALESCE(stage_normalized, stage)';

  const positionResult = await query<{ norm_stage: string; avg_first_position: number }>(
    `WITH positioned AS (
       SELECT
         deal_id,
         ${stageExpr} AS norm_stage,
         ROW_NUMBER() OVER (PARTITION BY deal_id ORDER BY entered_at) AS rn
       FROM deal_stage_history
       WHERE workspace_id = $1
     ),
     first_per_deal AS (
       SELECT deal_id, norm_stage, MIN(rn) AS first_position
       FROM positioned
       GROUP BY deal_id, norm_stage
     )
     SELECT
       norm_stage,
       AVG(first_position) AS avg_first_position,
       COUNT(DISTINCT deal_id) AS deal_count
     FROM first_per_deal
     WHERE LOWER(norm_stage) NOT IN (
       'closed_won','closed_lost','closedwon','closedlost','closed won','closed lost'
     )
     GROUP BY norm_stage
     HAVING COUNT(DISTINCT deal_id) >= 2
     ORDER BY avg_first_position`,
    [workspaceId]
  );

  if (raw) {
    // In raw mode without a pipeline filter, use stage_configs ordering weighted by
    // deal count per pipeline. The primary pipeline (most deals) dominates the ordering,
    // and each stage_id is only included once (first pipeline that has it wins).
    // This avoids the multi-pipeline position-averaging skew from pure empirical ordering.
    const configRows = await query<{ stage_id: string; deal_count: number }>(
      `SELECT sc.stage_id, COALESCE(COUNT(d.id), 0)::int AS deal_count
       FROM stage_configs sc
       LEFT JOIN deals d ON d.workspace_id = sc.workspace_id AND d.pipeline = sc.pipeline_name
       WHERE sc.workspace_id = $1
         AND sc.is_active = true
         AND LOWER(sc.stage_id) NOT IN ('closedwon','closedlost','closed_won','closed_lost')
       GROUP BY sc.stage_id, sc.pipeline_name, sc.display_order
       ORDER BY COALESCE(COUNT(d.id), 0) DESC, sc.display_order ASC`,
      [workspaceId]
    ).catch(() => ({ rows: [] as Array<{ stage_id: string; deal_count: number }> }));

    if (configRows.rows.length > 0) {
      const seen = new Set<string>();
      const ordered: string[] = [];
      for (const row of configRows.rows) {
        if (!seen.has(row.stage_id)) {
          seen.add(row.stage_id);
          ordered.push(row.stage_id);
        }
      }
      // Append empirically-discovered stage IDs not found in stage_configs (custom stages)
      // filtering out purely numeric IDs which have no readable label.
      const empiricalExtras = positionResult.rows
        .filter(r => !TERMINAL_RAW.has(r.norm_stage.toLowerCase()))
        .filter(r => /[a-zA-Z]/.test(r.norm_stage))
        .filter(r => !seen.has(r.norm_stage))
        .sort((a, b) => a.avg_first_position - b.avg_first_position)
        .map(r => r.norm_stage);
      return [...ordered, ...empiricalExtras];
    }

    // Ultimate fallback: pure empirical ordering (no stage_configs in this workspace)
    return positionResult.rows
      .filter(r => !TERMINAL_RAW.has(r.norm_stage.toLowerCase()))
      .filter(r => /[a-zA-Z]/.test(r.norm_stage))
      .sort((a, b) => a.avg_first_position - b.avg_first_position)
      .map(r => r.norm_stage);
  }

  // Normalized mode: canonical order for standard stage names, empirical for custom ones.
  const CANONICAL_STAGE_ORDER: Record<string, number> = {
    'awareness':     1,
    'discovery':     2,
    'qualification': 3,
    'evaluation':    4,
    'decision':      5,
    'proposal':      6,
    'negotiation':   7,
  };
  const CANONICAL_MAX = 7;

  return positionResult.rows
    .filter(r => !TERMINAL_RAW.has(r.norm_stage))
    .sort((a, b) => {
      const posA = CANONICAL_STAGE_ORDER[a.norm_stage] ?? (CANONICAL_MAX + a.avg_first_position);
      const posB = CANONICAL_STAGE_ORDER[b.norm_stage] ?? (CANONICAL_MAX + b.avg_first_position);
      return posA - posB;
    })
    .map(r => r.norm_stage);
}

/**
 * Reconstruct which stage each deal was in at a specific timestamp.
 * When raw=true, returns raw (unnormalized) CRM stage names.
 */
async function getDealsAtTimestamp(
  workspaceId: string,
  timestamp: Date,
  raw = false
): Promise<Map<string, { stage: string; amount: number; dealId: string; dealName: string }>> {
  const stageExpr = raw
    ? 'stage'
    : 'COALESCE(stage_normalized, stage)';
  const fallbackExpr = raw
    ? 'd.stage'
    : 'd.stage_normalized';

  // In raw mode, deals with no stage_history fall back to d.stage (human-readable name,
  // e.g. "Proposal Reviewed"). But stageFlows is keyed on CRM IDs ("proposalreviewed").
  // We LATERAL-join stage_configs to map the human-readable name back to its CRM stage_id
  // so the deal is counted in the correct startOfPeriod bucket.
  const rawFallbackJoin = raw
    ? `LEFT JOIN LATERAL (
         SELECT stage_id
         FROM stage_configs
         WHERE workspace_id = $1
           AND stage_name = d.stage
         LIMIT 1
       ) sc ON lt.stage_at_time IS NULL`
    : '';
  const rawFallbackCoalesce = raw
    ? 'COALESCE(lt.stage_at_time, sc.stage_id, d.stage)'
    : `COALESCE(lt.stage_at_time, ${fallbackExpr})`;

  const result = await query<{
    deal_id: string;
    deal_name: string;
    amount: number;
    stage_at_time: string;
  }>(
    `WITH latest_transition AS (
      SELECT DISTINCT ON (deal_id)
        deal_id,
        ${stageExpr} AS stage_at_time
      FROM deal_stage_history
      WHERE workspace_id = $1
        AND entered_at < $2
      ORDER BY deal_id, entered_at DESC
    )
    SELECT
      d.id as deal_id,
      d.name as deal_name,
      d.amount,
      ${rawFallbackCoalesce} as stage_at_time
    FROM deals d
    LEFT JOIN latest_transition lt ON lt.deal_id = d.id
    ${rawFallbackJoin}
    WHERE d.workspace_id = $1
      AND d.created_at < $2
      AND (d.close_date IS NULL OR d.close_date >= $2)
      AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')`,
    [workspaceId, timestamp]
  );

  const dealMap = new Map();
  for (const row of result.rows) {
    dealMap.set(row.deal_id, {
      stage: row.stage_at_time,
      amount: Number(row.amount) || 0,
      dealId: row.deal_id,
      dealName: row.deal_name,
    });
  }

  return dealMap;
}

/**
 * Main waterfall analysis function
 */
export async function waterfallAnalysis(
  workspaceId: string,
  periodStart: Date,
  periodEnd: Date,
  filterParams?: WaterfallFilterParams
): Promise<WaterfallResult> {
  // 0. Resolve filter: build a set of eligible deal IDs if filtering is requested
  let scopedDealIds: Set<string> | null = null;

  if (filterParams?.pipeline) {
    const escaped = filterParams.pipeline.replace(/'/g, "''");
    const filtered = await query<{ id: string }>(
      `SELECT id FROM deals WHERE workspace_id = $1 AND pipeline = '${escaped}'`,
      [workspaceId]
    ).catch(() => ({ rows: [] as Array<{ id: string }> }));
    scopedDealIds = new Set(filtered.rows.map(r => r.id));
  } else if (filterParams?.scopeId && filterParams.scopeId !== 'default') {
    const scopeRow = await query<{
      filter_field: string;
      filter_operator: string;
      filter_values: string[];
      field_overrides: any;
    }>(
      `SELECT filter_field, filter_operator, filter_values, field_overrides
       FROM analysis_scopes
       WHERE workspace_id = $1 AND scope_id = $2
       LIMIT 1`,
      [workspaceId, filterParams.scopeId]
    ).catch(() => ({ rows: [] as any[] }));

    if (scopeRow.rows.length > 0) {
      const scope: ActiveScope = {
        scope_id: filterParams.scopeId,
        name: '',
        filter_field: scopeRow.rows[0].filter_field,
        filter_operator: scopeRow.rows[0].filter_operator || 'in',
        filter_values: scopeRow.rows[0].filter_values || [],
        field_overrides: scopeRow.rows[0].field_overrides || {},
      };
      const whereClause = getScopeWhereClause(scope);
      if (whereClause) {
        const filtered = await query<{ id: string }>(
          `SELECT id FROM deals WHERE workspace_id = $1 AND (${whereClause})`,
          [workspaceId]
        ).catch(() => ({ rows: [] as Array<{ id: string }> }));
        scopedDealIds = new Set(filtered.rows.map(r => r.id));
      }
    }
  }

  const raw = filterParams?.raw ?? false;

  // 1. Get ordered stages (raw or normalized depending on mode)
  const orderedStages = await getStageOrdering(workspaceId, raw, filterParams?.pipeline);

  // 2. Get deals at start and end of period
  const dealsAtStartRaw = await getDealsAtTimestamp(workspaceId, periodStart, raw);
  const dealsAtEndRaw = await getDealsAtTimestamp(workspaceId, periodEnd, raw);

  // Apply scope filter to deal snapshots
  const dealsAtStart = scopedDealIds
    ? new Map(Array.from(dealsAtStartRaw.entries()).filter(([id]) => scopedDealIds!.has(id)))
    : dealsAtStartRaw;
  const dealsAtEnd = scopedDealIds
    ? new Map(Array.from(dealsAtEndRaw.entries()).filter(([id]) => scopedDealIds!.has(id)))
    : dealsAtEndRaw;

  // 3. Get all transitions during the period
  const allTransitions = await getStageTransitionsInWindow(workspaceId, periodStart, periodEnd);
  const transitions = scopedDealIds
    ? allTransitions.filter(t => scopedDealIds!.has(t.dealId))
    : allTransitions;

  // 4. Build transition maps
  const transitionsByDeal = new Map<string, typeof transitions>();
  for (const t of transitions) {
    if (!transitionsByDeal.has(t.dealId)) {
      transitionsByDeal.set(t.dealId, []);
    }
    transitionsByDeal.get(t.dealId)!.push(t);
  }

  // 5. Get deal amounts for value calculations
  const dealAmounts = new Map<string, number>();
  const dealResult = await query<{ id: string; amount: number }>(
    `SELECT id, amount FROM deals WHERE workspace_id = $1`,
    [workspaceId]
  );
  for (const row of dealResult.rows) {
    dealAmounts.set(row.id, Number(row.amount) || 0);
  }

  // 6. Initialize stage flows
  const stageFlows = new Map<string, WaterfallStageFlow>();
  for (const stage of orderedStages) {
    stageFlows.set(stage, {
      stage,
      startOfPeriod: 0,
      entered: 0,
      advanced: 0,
      fellBack: 0,
      fellOut: 0,
      won: 0,
      endOfPeriod: 0,
      endOfPeriodValue: 0,
      netChange: 0,
      enteredValue: 0,
      advancedValue: 0,
      fellOutValue: 0,
      wonValue: 0,
    });
  }

  // 7. Count deals at start of period per stage
  for (const deal of dealsAtStart.values()) {
    const flow = stageFlows.get(deal.stage);
    if (flow) {
      flow.startOfPeriod++;
    }
  }

  // 8. Count deals at end of period per stage (and track open ARR)
  for (const deal of dealsAtEnd.values()) {
    const flow = stageFlows.get(deal.stage);
    if (flow) {
      flow.endOfPeriod++;
      flow.endOfPeriodValue += deal.amount;
    }
  }

  // 9. Classify transitions + track pairwise stage flows
  const stageIndex = new Map(orderedStages.map((s, i) => [s, i]));
  const pairwiseFlows = new Map<string, WaterfallFlow>();
  let newPipelineCount = 0;
  let newPipelineValue = 0;
  let closedWonCount = 0;
  let closedWonValue = 0;
  let closedLostCount = 0;
  let closedLostValue = 0;

  const CLOSED_WON_VALS = new Set(['closed_won', 'closedwon', 'closed won']);
  const CLOSED_LOST_VALS = new Set(['closed_lost', 'closedlost', 'closed lost']);

  for (const t of transitions) {
    const amount = dealAmounts.get(t.dealId) || 0;
    // In raw mode use the literal CRM stage name; otherwise use the normalized version
    const fromStage = raw ? t.fromStage : t.fromStageNormalized;
    const toStage   = raw ? t.toStage   : t.toStageNormalized;

    // Skip self-loop transitions (same stage before and after).
    // These occur when multiple raw CRM stage IDs normalize to the same bucket,
    // making a deal appear to move from e.g. "awareness" → "awareness".
    // Counting them as entered/fellBack inflates both metrics incorrectly.
    if (fromStage && fromStage === toStage) continue;

    // New pipeline created
    if (!fromStage) {
      newPipelineCount++;
      newPipelineValue += amount;
      const toFlow = stageFlows.get(toStage!);
      if (toFlow) {
        toFlow.entered++;
        toFlow.enteredValue += amount;
      }
      continue;
    }

    // Closed won (check both raw and normalized terminal labels)
    if (CLOSED_WON_VALS.has((toStage ?? '').toLowerCase())) {
      closedWonCount++;
      closedWonValue += amount;
      const fromFlow = stageFlows.get(fromStage);
      if (fromFlow) {
        fromFlow.won++;
        fromFlow.wonValue += amount;
      }
      continue;
    }

    // Closed lost (check both raw and normalized terminal labels)
    if (CLOSED_LOST_VALS.has((toStage ?? '').toLowerCase())) {
      closedLostCount++;
      closedLostValue += amount;
      const fromFlow = stageFlows.get(fromStage);
      if (fromFlow) {
        fromFlow.fellOut++;
        fromFlow.fellOutValue += amount;
      }
      continue;
    }

    // Stage progression
    const fromIndex = stageIndex.get(fromStage);
    const toIndex = stageIndex.get(toStage!);

    if (fromIndex !== undefined && toIndex !== undefined) {
      const toFlow = stageFlows.get(toStage!);
      const fromFlow = stageFlows.get(fromStage);

      if (fromFlow) {
        if (toIndex > fromIndex) {
          // Advanced to a later stage — credit destination as entered.
          fromFlow.advanced++;
          fromFlow.advancedValue += amount;

          if (toFlow) {
            toFlow.entered++;
            toFlow.enteredValue += amount;
          }

          if (toIndex === fromIndex + 1) {
            // Direct sequential advance — single pairwise flow
            const flowKey = `${fromStage}→${toStage}`;
            const existing = pairwiseFlows.get(flowKey);
            if (existing) {
              existing.count++;
              existing.value += amount;
            } else {
              pairwiseFlows.set(flowKey, { fromStage, toStage: toStage!, count: 1, value: amount });
            }
          } else {
            // Skipped stages — backfill each intermediate stage sequentially
            for (let k = fromIndex; k < toIndex; k++) {
              const segFrom = orderedStages[k];
              const segTo = orderedStages[k + 1];
              if (!segFrom || !segTo) continue;

              // Credit intermediate stages (not the origin) as entered + advanced
              if (k > fromIndex) {
                const intermediateFlow = stageFlows.get(segFrom);
                if (intermediateFlow) {
                  intermediateFlow.entered++;
                  intermediateFlow.advanced++;
                  intermediateFlow.enteredValue += amount;
                  intermediateFlow.advancedValue += amount;
                }
              }

              // Add sequential pairwise flow for each hop
              const flowKey = `${segFrom}→${segTo}`;
              const existing = pairwiseFlows.get(flowKey);
              if (existing) {
                existing.count++;
                existing.value += amount;
              } else {
                pairwiseFlows.set(flowKey, { fromStage: segFrom, toStage: segTo, count: 1, value: amount });
              }
            }
          }
        } else {
          // Fell back to an earlier stage — do NOT count as entered at destination.
          // Backward moves are already-counted deals regressing; including them in
          // "entered" would inflate earlier-stage counts and distort the funnel.
          fromFlow.fellBack++;
        }
      }
    }
  }

  // 10. Calculate net changes
  let totalOpenStart = 0;
  let totalOpenEnd = 0;

  for (const flow of stageFlows.values()) {
    flow.netChange = flow.endOfPeriod - flow.startOfPeriod;
    totalOpenStart += flow.startOfPeriod;
    totalOpenEnd += flow.endOfPeriod;
  }

  // 11. Return result - preserve stage order from orderedStages
  return {
    stages: orderedStages
      .map(stage => stageFlows.get(stage))
      .filter((flow): flow is WaterfallStageFlow => flow !== undefined),
    flows: Array.from(pairwiseFlows.values()),
    summary: {
      newPipelineCreated: { count: newPipelineCount, value: newPipelineValue },
      closedWon: { count: closedWonCount, value: closedWonValue },
      closedLost: { count: closedLostCount, value: closedLostValue },
      netPipelineChange: totalOpenEnd - totalOpenStart,
      totalOpenStart,
      totalOpenEnd,
    },
    periodStart,
    periodEnd,
  };
}
