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
 *
 * Always infers order from actual deal flow data instead of trusting potentially
 * incorrect HubSpot metadata. Uses MIN position per deal to avoid inflation from
 * duplicate stage IDs that normalize to the same value.
 */
async function getStageOrdering(workspaceId: string): Promise<string[]> {
  // Infer order by computing average sequence position of each stage across all deals.
  // Stages that appear earlier in deal timelines (lower avg position) sort first.
  const TERMINAL = new Set([
    'closed_won', 'closedwon', 'closed won',
    'closed_lost', 'closedlost', 'closed lost',
  ]);

  // Use first-occurrence-per-deal to compute avg position.
  // Raw HubSpot data has many numeric IDs that all normalize to the same stage
  // (e.g. 7 IDs → 'qualification'), so a naive AVG(ROW_NUMBER) over all rows
  // inflates that stage's position. Using MIN(rn) per deal per normalized stage
  // gives a clean "when does this stage first appear in this deal's journey".
  const positionResult = await query<{ norm_stage: string; avg_first_position: number }>(
    `WITH positioned AS (
       SELECT
         deal_id,
         COALESCE(stage_normalized, stage) AS norm_stage,
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
     WHERE norm_stage NOT IN (
       'closed_won','closed_lost','closedwon','closedlost','closed won','closed lost'
     )
     GROUP BY norm_stage
     HAVING COUNT(DISTINCT deal_id) >= 2
     ORDER BY avg_first_position`,
    [workspaceId]
  );

  // Canonical pipeline order for standard normalized stage names.
  // Empirical position-based ordering breaks when stages are frequently skipped
  // (e.g. many deals go qualification→decision without evaluation, pulling decision's
  // avg position below evaluation's even though eval is earlier in the pipeline).
  // Stages in this map are always sorted by canonical position; unknown/custom stages
  // append after using their empirical avg_first_position scaled above the max canonical value.
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
    .filter(r => !TERMINAL.has(r.norm_stage))
    .sort((a, b) => {
      const posA = CANONICAL_STAGE_ORDER[a.norm_stage] ?? (CANONICAL_MAX + a.avg_first_position);
      const posB = CANONICAL_STAGE_ORDER[b.norm_stage] ?? (CANONICAL_MAX + b.avg_first_position);
      return posA - posB;
    })
    .map(r => r.norm_stage);
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
          // Advanced to a later stage.
          fromFlow.advanced++;
          fromFlow.advancedValue += amount;

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
