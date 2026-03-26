import { query } from '../db.js';
import { previewFilter } from './dimension-executor.js';
import { confirmDimension, updateCalibrationStatus } from './data-dictionary.js';
import type { DimensionFilter } from './data-dictionary.js';
import { NORMALIZED_STAGE_LABELS } from './stage-mapping-interview.js';

export type InterviewStep =
  | 'stage_mapping'
  | 'active_pipeline'
  | 'pipeline_coverage'
  | 'win_rate'
  | 'at_risk'
  | 'commit'
  | 'forecast_rollup'
  | 'complete';

const STEP_ORDER: InterviewStep[] = [
  'stage_mapping',
  'active_pipeline',
  'pipeline_coverage',
  'win_rate',
  'at_risk',
  'commit',
  'forecast_rollup',
  'complete',
];

export const STEP_LABELS: Record<InterviewStep, string> = {
  stage_mapping:     'Stage mapping',
  active_pipeline:   'Active pipeline definition',
  pipeline_coverage: 'Pipeline coverage ratio',
  win_rate:          'Win rate benchmark',
  at_risk:           'At-risk deal definition',
  commit:            'Commit / forecast categories',
  forecast_rollup:   'Forecast rollup method',
  complete:          'Complete',
};

export interface InterviewState {
  workspace_id:    string;
  current_step:    InterviewStep;
  completed_steps: InterviewStep[];
  started_at:      string;
  last_updated_at: string;
}

const DEFAULT_FILTERS: Record<string, DimensionFilter> = {
  active_pipeline: {
    operator: 'AND',
    conditions: [
      { field: 'stage', field_type: 'standard', field_label: 'Stage', operator: 'not_in', value: ['closed_won', 'closed_lost'] },
      { field: 'close_date', field_type: 'standard', field_label: 'Close Date', operator: 'this_quarter', value: null },
    ],
  },
  at_risk: {
    operator: 'OR',
    conditions: [
      { field: 'days_since_activity', field_type: 'standard', field_label: 'Days Since Activity', operator: 'greater_than', value: 30 },
    ],
  },
  commit: {
    operator: 'AND',
    conditions: [
      { field: 'forecast_category', field_type: 'custom', field_label: 'Forecast Category', operator: 'in', value: ['Commit', 'commit', 'Best Case', 'best_case'] },
      { field: 'stage', field_type: 'standard', field_label: 'Stage', operator: 'not_in', value: ['closed_won', 'closed_lost'] },
    ],
  },
};

export async function getInterviewState(
  workspaceId: string
): Promise<InterviewState> {
  const result = await query(
    `SELECT workspace_config->'calibration'->'interview_state' AS interview_state
     FROM workspaces WHERE id = $1`,
    [workspaceId]
  );

  const raw = result.rows[0]?.interview_state;
  if (raw) {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      workspace_id:    workspaceId,
      current_step:    parsed.current_step ?? 'stage_mapping',
      completed_steps: parsed.completed_steps ?? [],
      started_at:      parsed.started_at ?? new Date().toISOString(),
      last_updated_at: parsed.last_updated_at ?? new Date().toISOString(),
    };
  }

  const now = new Date().toISOString();
  return {
    workspace_id:    workspaceId,
    current_step:    'stage_mapping',
    completed_steps: [],
    started_at:      now,
    last_updated_at: now,
  };
}

export async function advanceInterview(
  workspaceId: string,
  completedStep: InterviewStep
): Promise<InterviewStep> {
  const state = await getInterviewState(workspaceId);
  const completedSteps = [...new Set([...state.completed_steps, completedStep])];

  const currentIndex = STEP_ORDER.indexOf(completedStep);
  const nextStep: InterviewStep = STEP_ORDER[currentIndex + 1] ?? 'complete';

  const now = new Date().toISOString();
  const updatedState = {
    current_step:    nextStep,
    completed_steps: completedSteps,
    started_at:      state.started_at,
    last_updated_at: now,
  };

  await query(
    `UPDATE workspaces
     SET workspace_config = COALESCE(workspace_config, '{}'::jsonb)
         || jsonb_build_object(
              'calibration',
              COALESCE(workspace_config->'calibration', '{}'::jsonb)
              || jsonb_build_object('interview_state', $2::jsonb)
            )
     WHERE id = $1`,
    [workspaceId, JSON.stringify(updatedState)]
  );

  if (nextStep === 'complete') {
    await updateCalibrationStatus(workspaceId, 'complete');
  } else if (state.current_step === 'stage_mapping' && nextStep === 'active_pipeline') {
    await updateCalibrationStatus(workspaceId, 'in_progress');
  }

  return nextStep;
}

export async function resetInterviewState(workspaceId: string): Promise<void> {
  const now = new Date().toISOString();
  const emptyState = {
    current_step:    'stage_mapping',
    completed_steps: [] as InterviewStep[],
    started_at:      now,
    last_updated_at: now,
  };

  await query(
    `UPDATE workspaces
     SET workspace_config = COALESCE(workspace_config, '{}'::jsonb)
         || jsonb_build_object(
              'calibration',
              COALESCE(workspace_config->'calibration', '{}'::jsonb)
              || jsonb_build_object('interview_state', $2::jsonb)
            )
     WHERE id = $1`,
    [workspaceId, JSON.stringify(emptyState)]
  );

  await updateCalibrationStatus(workspaceId, 'not_started');
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

async function buildActivePipelineQuestion(workspaceId: string): Promise<string> {
  const filter = DEFAULT_FILTERS.active_pipeline;
  const preview = await previewFilter(workspaceId, filter, 'amount', 'standard');

  const samples = preview.sample_deals.slice(0, 3).map(d =>
    `- **${d.name}**: ${formatCurrency(d.amount)} in ${d.stage ?? 'unknown stage'} (${d.owner ?? 'unassigned'})`
  ).join('\n');

  return `**Step 1 of 6: Active Pipeline Definition**

Using the most common definition — all open deals closing this quarter — I find **${preview.deal_count} deals worth ${formatCurrency(preview.total_value)}**.

Sample deals included:
${samples || '- (no deals found with this filter)'}

Does this match what your team counts as active pipeline? If not, tell me what to change:
- Different stages to include or exclude?
- A different date range (e.g. rolling 90 days instead of this quarter)?
- A minimum deal size?
- A custom field filter (e.g. segment, product line)?`;
}

async function buildPipelineCoverageQuestion(workspaceId: string): Promise<string> {
  const [preview, pipelineResult] = await Promise.all([
    previewFilter(workspaceId, DEFAULT_FILTERS.active_pipeline, 'amount', 'standard'),
    query(
      `SELECT ARRAY_AGG(DISTINCT NULLIF(TRIM(pipeline), ''))
         FILTER (WHERE pipeline IS NOT NULL AND TRIM(pipeline) != '') AS pipelines
       FROM deals
       WHERE workspace_id = $1`,
      [workspaceId]
    ),
  ]);

  const pipelineVal = formatCurrency(preview.total_value);
  const pipelines: string[] = (pipelineResult.rows[0]?.pipelines ?? []).filter(Boolean);
  const hasMultiplePipelines = pipelines.length > 1;

  const pipelineSection = hasMultiplePipelines
    ? `\nYou have **${pipelines.length} pipelines**: ${pipelines.map(p => `*${p}*`).join(', ')}.

Do you want one coverage target for all pipelines, or a separate target for each?

- **Global** — one coverage ratio across all pipelines (most common)
- **Per pipeline** — separate targets per pipeline (useful when pipelines have very different win rates or cycle times)

Most teams use a global target. If you want per-pipeline, tell me and I'll ask for each pipeline's quota separately.\n`
    : '';

  return `**Step 2 of 6: Pipeline Coverage Ratio**

Pipeline coverage is typically calculated as: **Active Pipeline ÷ Quarterly Quota**.

Based on your active pipeline definition, you have ${pipelineVal} in pipeline.${pipelineSection}
What is your team's quarterly quota? (Or if you have it set in your CRM, tell me where to find it.)

Once I know your quota, I can track coverage automatically and alert you when it drops below your target.`;
}

async function buildWinRateQuestion(workspaceId: string): Promise<string> {
  const trailingFilter: DimensionFilter = {
    operator: 'AND',
    conditions: [
      { field: 'stage', field_type: 'standard', field_label: 'Stage', operator: 'in', value: ['closed_won', 'closed_lost'] },
      { field: 'close_date', field_type: 'standard', field_label: 'Close Date', operator: 'trailing_90d', value: null },
    ],
  };

  const wonFilter: DimensionFilter = {
    operator: 'AND',
    conditions: [
      { field: 'stage', field_type: 'standard', field_label: 'Stage', operator: 'in', value: ['closed_won'] },
      { field: 'close_date', field_type: 'standard', field_label: 'Close Date', operator: 'trailing_90d', value: null },
    ],
  };

  const [all, won] = await Promise.all([
    previewFilter(workspaceId, trailingFilter, 'amount', 'standard'),
    previewFilter(workspaceId, wonFilter, 'amount', 'standard'),
  ]);

  const rate = all.deal_count > 0 ? Math.round((won.deal_count / all.deal_count) * 100) : 0;

  return `**Step 3 of 6: Win Rate Definition**

Using the standard definition — closed won ÷ (closed won + closed lost), trailing 90 days — I calculate a **${rate}% win rate** (${won.deal_count} won out of ${all.deal_count} closed).

Is that how your team tracks win rate? Common variations:
- Count-based (number of deals) vs value-based (dollar value)
- Different time window (full year, last quarter)
- Excluding certain deal types (trials, renewals)`;
}

async function buildAtRiskQuestion(workspaceId: string): Promise<string> {
  const preview = await previewFilter(workspaceId, DEFAULT_FILTERS.at_risk, 'amount', 'standard');
  const samples = preview.sample_deals.slice(0, 3).map(d =>
    `- **${d.name}**: ${formatCurrency(d.amount)} — ${d.stage ?? 'unknown stage'} (${d.owner ?? 'unassigned'})`
  ).join('\n');

  return `**Step 4 of 6: At-Risk Deal Definition**

Using the default definition — no activity in the last 30 days OR close date past due — I find **${preview.deal_count} at-risk deals worth ${formatCurrency(preview.total_value)}**.

${samples || '- (no at-risk deals found)'}

Does this match how your team defines "at risk"? Alternatives:
- Different inactivity threshold (14 days, 45 days)?
- Close date past due by N days, not just any past-due?
- Stage-specific rules (e.g. only Proposal+ stages)?`;
}

async function buildCommitQuestion(workspaceId: string): Promise<string> {
  let preview = { deal_count: 0, total_value: 0, sample_deals: [] as any[] };
  try {
    preview = await previewFilter(workspaceId, DEFAULT_FILTERS.commit, 'amount', 'standard');
  } catch {
    // forecast_category may not exist — silently fall through
  }

  const valueStr = formatCurrency(preview.total_value);
  const commitNote = preview.deal_count > 0
    ? `I found **${preview.deal_count} deals worth ${valueStr}** with a Commit or Best Case forecast category.`
    : `I couldn't find a "forecast_category" field in your CRM data. You may call this "Commit Stage" or use a stage name like "Negotiation" to represent committed deals.`;

  return `**Step 5 of 6: Commit / Forecast Definition**

${commitNote}

How do you define your Commit? Common options:
- A CRM forecast category field (Commit, Best Case, Pipeline)
- A specific stage name ("Contract Sent", "Negotiation")
- A custom field on the deal record`;
}

async function buildForecastRollupQuestion(workspaceId: string): Promise<string> {
  const preview = await previewFilter(workspaceId, DEFAULT_FILTERS.active_pipeline, 'amount', 'standard');

  return `**Step 6 of 6: Forecast Rollup**

Your full forecast rollup is the weekly number your leadership reviews — typically broken down by rep, with Commit, Best Case, and total Pipeline.

Based on your active pipeline of ${formatCurrency(preview.total_value)}, how do you calculate your forecast number?

- Commit only (most conservative)?
- Commit + a percentage of Best Case?
- Full pipeline adjusted by your ${Math.round(preview.total_value > 0 ? 30 : 25)}% historical win rate?

Once confirmed, I'll use this formula for all forecast-related reporting.`;
}

export async function buildInterviewPrompt(
  workspaceId: string,
  step: InterviewStep
): Promise<string> {
  switch (step) {
    case 'active_pipeline':   return buildActivePipelineQuestion(workspaceId);
    case 'pipeline_coverage': return buildPipelineCoverageQuestion(workspaceId);
    case 'win_rate':          return buildWinRateQuestion(workspaceId);
    case 'at_risk':           return buildAtRiskQuestion(workspaceId);
    case 'commit':            return buildCommitQuestion(workspaceId);
    case 'forecast_rollup':   return buildForecastRollupQuestion(workspaceId);
    case 'complete':
      return buildCompletionSummary(workspaceId);
    default:
      return `Let's continue calibrating your pipeline definitions.`;
  }
}

export async function buildCompletionSummary(workspaceId: string): Promise<string> {
  const [stateResult, dimensionsResult, confirmedStageMappingsResult] = await Promise.all([
    getInterviewState(workspaceId),
    query(
      `SELECT workspace_config->'calibration'->'dimensions' AS dimensions,
              workspace_config->'calibration'->'stage_mappings' AS stage_mappings
       FROM workspaces WHERE id = $1`,
      [workspaceId]
    ),
    // Authoritative count: read confirmed stage entries from stage_mappings table
    query(
      `SELECT raw_stage, normalized_stage, display_order
       FROM stage_mappings
       WHERE workspace_id = $1 AND source = 'calibration'
       ORDER BY display_order`,
      [workspaceId]
    ),
  ]);

  const dimensions = dimensionsResult.rows[0]?.dimensions
    ? (typeof dimensionsResult.rows[0].dimensions === 'string'
        ? JSON.parse(dimensionsResult.rows[0].dimensions)
        : dimensionsResult.rows[0].dimensions)
    : {};

  // Workspace config holds raw CRM name → funnel position (for human-readable labels)
  const stageMappings: Record<string, string> =
    dimensionsResult.rows[0]?.stage_mappings
      ? (typeof dimensionsResult.rows[0].stage_mappings === 'string'
          ? JSON.parse(dimensionsResult.rows[0].stage_mappings)
          : dimensionsResult.rows[0].stage_mappings)
      : {};

  // Authoritative count from stage_mappings table (source='calibration')
  const confirmedTableCount = confirmedStageMappingsResult.rows.length;

  const lines: string[] = [
    `**Calibration Complete! All 6 definitions are now confirmed.**`,
    ``,
    `Here's a summary of what Pandora will use going forward:`,
    ``,
  ];

  // Show stage mappings: prefer workspace_config (has funnel position labels),
  // fall back to stage_mappings table entries if workspace_config is stale/empty.
  const configEntries = Object.entries(stageMappings).filter(([, v]) => v);
  if (configEntries.length > 0 || confirmedTableCount > 0) {
    lines.push(`**Stage Mappings** (${confirmedTableCount} stage${confirmedTableCount !== 1 ? 's' : ''} confirmed)`);
    if (configEntries.length > 0) {
      for (const [rawStage, funnelPosition] of configEntries) {
        const label = NORMALIZED_STAGE_LABELS[funnelPosition as keyof typeof NORMALIZED_STAGE_LABELS] ?? funnelPosition;
        lines.push(`- ${rawStage} → ${label}`);
      }
    } else {
      // Fallback: show raw_stage from table (funnel position not available here, use normalized)
      for (const row of confirmedStageMappingsResult.rows) {
        const label = NORMALIZED_STAGE_LABELS[row.normalized_stage as keyof typeof NORMALIZED_STAGE_LABELS] ?? row.normalized_stage;
        lines.push(`- ${row.raw_stage} → ${label}`);
      }
    }
    lines.push('');
  }

  const stepLabels: Partial<Record<string, string>> = {
    active_pipeline:   'Active Pipeline',
    pipeline_coverage: 'Pipeline Coverage',
    win_rate:          'Win Rate',
    at_risk:           'At-Risk Deals',
    commit:            'Commit / Forecast',
    forecast_rollup:   'Forecast Rollup',
  };

  const completed = stateResult.completed_steps.filter(s => s !== 'stage_mapping' && s !== 'complete');
  if (completed.length > 0) {
    lines.push(`**Confirmed Definitions**`);
    for (const step of completed) {
      const label = stepLabels[step] ?? step;
      const dim = dimensions[step];
      if (dim?.confirmed_value !== undefined) {
        const val = dim.confirmed_value >= 1_000_000
          ? `$${(dim.confirmed_value / 1_000_000).toFixed(1)}M`
          : dim.confirmed_value >= 1_000
            ? `$${Math.round(dim.confirmed_value / 1_000)}K`
            : `$${Math.round(dim.confirmed_value)}`;
        lines.push(`- **${label}**: ${val} across ${dim.confirmed_count ?? '?'} deals (confirmed via interview)`);
      } else {
        lines.push(`- **${label}**: confirmed via interview`);
      }
    }
    lines.push('');
  }

  lines.push(`Pandora will use these definitions for all pipeline, coverage, win rate, and forecast calculations. You can re-run calibration any time from Settings → Calibration.`);

  return lines.join('\n');
}

/** Per-step dimension configuration used to UPSERT business_dimensions rows. */
const STEP_DIMENSION_CONFIG: Partial<Record<InterviewStep, {
  key: string;
  label: string;
  description: string;
  filter: DimensionFilter;
}>> = {
  active_pipeline: {
    key: 'active_pipeline',
    label: 'Active Pipeline',
    description: 'Open deals with close dates in the current quarter, excluding terminal stages',
    filter: DEFAULT_FILTERS.active_pipeline,
  },
  at_risk: {
    key: 'at_risk',
    label: 'At-Risk Deals',
    description: 'Deals with no activity in the last 30 days or a past-due close date',
    filter: DEFAULT_FILTERS.at_risk,
  },
  commit: {
    key: 'commit',
    label: 'Commit / Forecast',
    description: 'Deals in Commit or Best Case forecast category, excluding closed stages',
    filter: DEFAULT_FILTERS.commit,
  },
  forecast_rollup: {
    key: 'forecast_rollup',
    label: 'Forecast Rollup',
    description: 'Total forecasted pipeline value used in weekly leadership rollup',
    filter: DEFAULT_FILTERS.active_pipeline,
  },
};

/**
 * Advances the interview state AND writes the confirmed dimension to both
 * business_dimensions and data_dictionary. Replaces bare advanceInterview()
 * calls in the dimension interview phase so writes actually persist.
 */
export async function advanceAndConfirmStep(
  workspaceId: string,
  step: InterviewStep
): Promise<InterviewStep> {
  const config = STEP_DIMENSION_CONFIG[step];

  if (config) {
    // Resolve preview data (best-effort — don't block advance on failure)
    let confirmedValue = 0;
    let confirmedCount = 0;
    try {
      const preview = await previewFilter(workspaceId, config.filter, 'amount', 'standard');
      confirmedValue = preview.total_value;
      confirmedCount = preview.deal_count;
    } catch (err: any) {
      console.warn(`[CalibrationStep] previewFilter failed for ${step}:`, err.message);
    }

    // UPSERT the dimension row so confirmDimension has something to update
    try {
      await query(
        `INSERT INTO business_dimensions
           (workspace_id, dimension_key, label, description, filter_definition,
            value_field, value_field_label, value_field_type,
            confirmed, confirmed_at, confirmed_value, confirmed_deal_count,
            calibration_source)
         VALUES ($1, $2, $3, $4, $5, 'amount', 'Amount', 'standard',
                 TRUE, NOW(), $6, $7, 'interview')
         ON CONFLICT (workspace_id, dimension_key) DO UPDATE SET
           label                = EXCLUDED.label,
           description          = EXCLUDED.description,
           filter_definition    = EXCLUDED.filter_definition,
           confirmed            = TRUE,
           confirmed_at         = NOW(),
           confirmed_value      = EXCLUDED.confirmed_value,
           confirmed_deal_count = EXCLUDED.confirmed_deal_count,
           calibration_source   = 'interview',
           updated_at           = NOW()`,
        [
          workspaceId, config.key, config.label, config.description,
          JSON.stringify(config.filter), confirmedValue, confirmedCount,
        ]
      );
      console.log(`[CalibrationStep] Upserted business_dimension "${config.key}" (${confirmedCount} deals, $${Math.round(confirmedValue)})`);
    } catch (err: any) {
      console.error(`[CalibrationStep] business_dimensions upsert failed for ${step}:`, err.message);
    }

    // confirmDimension now finds the row and writes through to data_dictionary
    try {
      await confirmDimension(workspaceId, config.key, confirmedValue, confirmedCount, 'interview');
    } catch (err: any) {
      console.error(`[CalibrationStep] confirmDimension failed for ${step}:`, err.message);
    }
  }

  return advanceInterview(workspaceId, step);
}

export async function confirmInterviewStep(
  workspaceId: string,
  step: InterviewStep,
  filter: DimensionFilter,
  confirmedValue: number,
  confirmedCount: number,
  filterSummary: string
): Promise<void> {
  const dimensionKeyMap: Partial<Record<InterviewStep, string>> = {
    active_pipeline:   'active_pipeline',
    at_risk:           'at_risk',
    commit:            'commit',
    forecast_rollup:   'forecast_rollup',
  };

  const dimKey = dimensionKeyMap[step];
  if (dimKey) {
    await confirmDimension(workspaceId, dimKey, confirmedValue, confirmedCount, 'interview');
  }

  await advanceInterview(workspaceId, step);
}
