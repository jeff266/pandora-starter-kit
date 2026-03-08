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
}

/**
 * Get ordered list of pipeline stages
 */
async function getStageOrdering(workspaceId: string): Promise<string[]> {
  try {
    const configResult = await query<{ metadata: any }>(
      `SELECT metadata FROM connections
       WHERE workspace_id = $1 AND connector_name = 'hubspot'
       LIMIT 1`,
      [workspaceId]
    );

    if (configResult.rows.length > 0 && configResult.rows[0].metadata?.stages) {
      const stages = configResult.rows[0].metadata.stages as Array<{ name: string; display_order: number }>;
      return stages
        .sort((a, b) => a.display_order - b.display_order)
        .map(s => s.name);
    }
  } catch {
  }

  // Fallback: infer order from deal progression patterns
  // stage_normalized is a column; from_stage_normalized must be computed via LAG in a subquery
  const transitionResult = await query<{ from_stage_normalized: string; to_stage_normalized: string; count: number }>(
    `SELECT from_stage_normalized, to_stage_normalized, COUNT(*) as count
     FROM (
       SELECT
         LAG(COALESCE(stage_normalized, stage)) OVER (PARTITION BY deal_id ORDER BY entered_at) AS from_stage_normalized,
         COALESCE(stage_normalized, stage) AS to_stage_normalized
       FROM deal_stage_history
       WHERE workspace_id = $1
     ) sub
     WHERE from_stage_normalized IS NOT NULL
       AND to_stage_normalized IS NOT NULL
       AND to_stage_normalized NOT IN ('closed_won', 'closedwon', 'closed won', 'closed_lost', 'closedlost', 'closed lost')
     GROUP BY from_stage_normalized, to_stage_normalized
     ORDER BY count DESC`,
    [workspaceId]
  );

  // Build a stage graph and topologically sort
  const stageGraph = new Map<string, Set<string>>();
  const allStages = new Set<string>();

  for (const row of transitionResult.rows) {
    allStages.add(row.from_stage_normalized);
    allStages.add(row.to_stage_normalized);

    if (!stageGraph.has(row.from_stage_normalized)) {
      stageGraph.set(row.from_stage_normalized, new Set());
    }
    stageGraph.get(row.from_stage_normalized)!.add(row.to_stage_normalized);
  }

  // Topological sort (simple approach: stages with no outbound edges go last)
  const ordered: string[] = [];
  const remaining = new Set(allStages);

  while (remaining.size > 0) {
    let found = false;
    for (const stage of remaining) {
      const outbound = stageGraph.get(stage) || new Set();
      const hasUnprocessedOutbound = Array.from(outbound).some(s => remaining.has(s));

      if (!hasUnprocessedOutbound) {
        ordered.push(stage);
        remaining.delete(stage);
        found = true;
        break;
      }
    }

    if (!found) {
      // Cycle detected or no more stages - add remaining alphabetically
      const rest = Array.from(remaining).sort();
      ordered.push(...rest);
      break;
    }
  }

  // Reverse to get early stages first
  return ordered.reverse();
}

/**
 * Reconstruct which stage each deal was in at a specific timestamp
 */
async function getDealsAtTimestamp(
  workspaceId: string,
  timestamp: Date
): Promise<Map<string, { stage: string; amount: number; dealId: string; dealName: string }>> {
  const result = await query<{
    deal_id: string;
    deal_name: string;
    amount: number;
    stage_at_time: string;
  }>(
    `WITH latest_transition AS (
      SELECT DISTINCT ON (deal_id)
        deal_id,
        COALESCE(stage_normalized, stage) AS stage_at_time
      FROM deal_stage_history
      WHERE workspace_id = $1
        AND entered_at < $2
      ORDER BY deal_id, entered_at DESC
    )
    SELECT
      d.id as deal_id,
      d.name as deal_name,
      d.amount,
      COALESCE(lt.stage_at_time, d.stage_normalized) as stage_at_time
    FROM deals d
    LEFT JOIN latest_transition lt ON lt.deal_id = d.id
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

  // 1. Get ordered stages
  const orderedStages = await getStageOrdering(workspaceId);

  // 2. Get deals at start and end of period
  const dealsAtStartRaw = await getDealsAtTimestamp(workspaceId, periodStart);
  const dealsAtEndRaw = await getDealsAtTimestamp(workspaceId, periodEnd);

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

  for (const t of transitions) {
    const amount = dealAmounts.get(t.dealId) || 0;
    const fromStage = t.fromStageNormalized;
    const toStage = t.toStageNormalized;

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

    // Closed won
    if (toStage === 'closed_won') {
      closedWonCount++;
      closedWonValue += amount;
      const fromFlow = stageFlows.get(fromStage);
      if (fromFlow) {
        fromFlow.won++;
        fromFlow.wonValue += amount;
      }
      continue;
    }

    // Closed lost
    if (toStage === 'closed_lost') {
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

      if (toFlow) {
        toFlow.entered++;
        toFlow.enteredValue += amount;
      }

      if (fromFlow) {
        if (toIndex > fromIndex) {
          // Advanced to later stage — track pairwise flow
          fromFlow.advanced++;
          fromFlow.advancedValue += amount;

          const flowKey = `${fromStage}→${toStage}`;
          const existing = pairwiseFlows.get(flowKey);
          if (existing) {
            existing.count++;
            existing.value += amount;
          } else {
            pairwiseFlows.set(flowKey, { fromStage, toStage: toStage!, count: 1, value: amount });
          }
        } else {
          // Fell back to earlier stage
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

  // 11. Return result
  return {
    stages: Array.from(stageFlows.values()),
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
