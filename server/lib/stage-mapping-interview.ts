import { query } from '../db.js';
import { saveStageMappings } from './data-dictionary.js';

export type NormalizedStage =
  | 'prospecting'
  | 'qualification'
  | 'evaluation'
  | 'demo'
  | 'proposal'
  | 'negotiation'
  | 'closed_won'
  | 'closed_lost';

export const NORMALIZED_STAGE_LABELS: Record<NormalizedStage, string> = {
  prospecting:  'Prospecting',
  qualification: 'Qualification',
  evaluation:   'Evaluation',
  demo:         'Demo',
  proposal:     'Proposal',
  negotiation:  'Negotiation',
  closed_won:   'Closed Won',
  closed_lost:  'Closed Lost',
};

export const FUNNEL_ORDER: NormalizedStage[] = [
  'prospecting', 'qualification', 'demo', 'evaluation', 'proposal', 'negotiation', 'closed_won', 'closed_lost',
];

export interface StageMappingQuestion {
  crm_stage_name: string;
  pipeline: string;
  normalized_stage_current: string;
  deal_count: number;
  total_value: number;
  suggested_mapping: NormalizedStage | null;
  confidence: 'high' | 'medium' | 'low';
}

function suggestMapping(stageName: string): { mapping: NormalizedStage | null; confidence: 'high' | 'medium' | 'low' } {
  const lower = stageName.toLowerCase().trim();

  const exactMap: Record<string, NormalizedStage> = {
    'closed won':    'closed_won',
    'closedwon':     'closed_won',
    'closed-won':    'closed_won',
    'won':           'closed_won',
    'closed lost':   'closed_lost',
    'closedlost':    'closed_lost',
    'closed-lost':   'closed_lost',
    'lost':          'closed_lost',
    'dead':          'closed_lost',
    'prospecting':   'prospecting',
    'qualification': 'qualification',
    'qualified':     'qualification',
    'demo':          'demo',
    'demonstration': 'demo',
    'proposal':      'proposal',
    'negotiation':   'negotiation',
    'negotiating':   'negotiation',
    'evaluation':    'evaluation',
  };

  if (exactMap[lower]) return { mapping: exactMap[lower], confidence: 'high' };

  if (lower.includes('won'))  return { mapping: 'closed_won',  confidence: 'high' };
  if (lower.includes('lost') || lower.includes('dead') || lower.includes('churn'))
    return { mapping: 'closed_lost', confidence: 'high' };

  if (lower.includes('demo'))       return { mapping: 'demo',         confidence: 'medium' };
  if (lower.includes('proposal') || lower.includes('quote'))
    return { mapping: 'proposal',   confidence: 'medium' };
  if (lower.includes('negotiat'))   return { mapping: 'negotiation',  confidence: 'medium' };
  if (lower.includes('evaluat') || lower.includes('trial') || lower.includes('poc') || lower.includes('proof'))
    return { mapping: 'evaluation', confidence: 'medium' };
  if (lower.includes('qualif'))     return { mapping: 'qualification', confidence: 'medium' };
  if (lower.includes('prospect') || lower.includes('lead') || lower.includes('discover'))
    return { mapping: 'prospecting', confidence: 'medium' };
  if (lower.includes('pilot'))      return { mapping: 'evaluation',   confidence: 'medium' };
  if (lower.includes('verbal') || lower.includes('commit') || lower.includes('contract'))
    return { mapping: 'negotiation', confidence: 'medium' };

  return { mapping: null, confidence: 'low' };
}

export async function getUnmappedStages(
  workspaceId: string
): Promise<StageMappingQuestion[]> {
  // Check if Setup Interview already classified stages via stage_mappings table
  // (non-calibration source = Setup Interview ran). If so, skip stage mapping.
  const mapped = await query(
    `SELECT COUNT(*) AS count
     FROM stage_mappings
     WHERE workspace_id = $1
       AND normalized_stage IS NOT NULL
       AND source <> 'calibration'`,
    [workspaceId]
  );
  if (parseInt(mapped.rows[0].count) > 0) {
    return [];
  }

  const [stagesResult, configResult] = await Promise.all([
    query(
      `SELECT stage              AS crm_stage_name,
              stage_normalized   AS import_normalized,
              ARRAY_TO_STRING(
                ARRAY_AGG(DISTINCT COALESCE(NULLIF(pipeline, ''), 'Default Pipeline')),
                ', '
              )                  AS pipeline_name,
              COUNT(*)::int      AS deal_count,
              COALESCE(SUM(amount), 0) AS total_value
       FROM deals
       WHERE workspace_id = $1
         AND stage IS NOT NULL
         AND stage <> ''
         AND stage_normalized IS NOT NULL
         AND stage_normalized <> ''
       GROUP BY stage, stage_normalized
       HAVING COUNT(*) > 0
       ORDER BY COUNT(*) DESC`,
      [workspaceId]
    ),
    query(
      `SELECT workspace_config->'calibration'->'stage_mappings' AS stage_mappings
       FROM workspaces WHERE id = $1`,
      [workspaceId]
    ),
  ]);

  const existingMappings: Record<string, string> =
    configResult.rows[0]?.stage_mappings
      ? (typeof configResult.rows[0].stage_mappings === 'string'
          ? JSON.parse(configResult.rows[0].stage_mappings)
          : configResult.rows[0].stage_mappings)
      : {};

  const unmapped: StageMappingQuestion[] = [];

  for (const row of stagesResult.rows) {
    const crmName = row.crm_stage_name as string;
    if (existingMappings[crmName]) continue;

    const { mapping, confidence } = suggestMapping(crmName);
    unmapped.push({
      crm_stage_name:          crmName,
      pipeline:                (row.pipeline_name as string) || '',
      normalized_stage_current: row.import_normalized as string ?? '',
      deal_count:              Number(row.deal_count),
      total_value:             Number(row.total_value),
      suggested_mapping:       mapping,
      confidence,
    });
  }

  return unmapped.sort((a, b) => b.deal_count - a.deal_count);
}

export async function confirmStageMapping(
  workspaceId: string,
  rawStageName: string,
  funnelPosition: NormalizedStage,
  importNormalizedStage: string
): Promise<void> {
  // If the caller couldn't supply the import-level normalized stage (e.g. the
  // stage was not in the current unmappedStages list), re-derive it from deals.
  let resolvedImportNormalized = importNormalizedStage;
  if (!resolvedImportNormalized) {
    const fallback = await query(
      `SELECT stage_normalized FROM deals
       WHERE workspace_id = $1 AND stage = $2 AND stage_normalized IS NOT NULL AND stage_normalized <> ''
       LIMIT 1`,
      [workspaceId, rawStageName]
    );
    resolvedImportNormalized = fallback.rows[0]?.stage_normalized ?? rawStageName;
  }

  // 1. Write to workspace_config.calibration.stage_mappings (raw CRM name → funnel position)
  //    Used for completion summary and re-checking what's already confirmed.
  const configResult = await query(
    `SELECT workspace_config->'calibration'->'stage_mappings' AS stage_mappings
     FROM workspaces WHERE id = $1`,
    [workspaceId]
  );

  const existing: Record<string, string> =
    configResult.rows[0]?.stage_mappings
      ? (typeof configResult.rows[0].stage_mappings === 'string'
          ? JSON.parse(configResult.rows[0].stage_mappings)
          : configResult.rows[0].stage_mappings)
      : {};

  existing[rawStageName] = funnelPosition;
  await saveStageMappings(workspaceId, existing);

  // 2. Upsert into stage_mappings table (raw stage → import-level normalized name, source='calibration')
  //    normalized_stage stays as the import-level value (e.g. 'evaluation') so analytics JOINs
  //    (sm.normalized_stage = dsh.stage_normalized) continue to work.
  //    display_order reflects the user-confirmed funnel position for correct stage ordering.
  const isOpen = funnelPosition !== 'closed_won' && funnelPosition !== 'closed_lost';
  const displayOrder = FUNNEL_ORDER.indexOf(funnelPosition);

  await query(
    `INSERT INTO stage_mappings (workspace_id, source, raw_stage, normalized_stage, is_open, display_order)
     VALUES ($1, 'calibration', $2, $3, $4, $5)
     ON CONFLICT (workspace_id, source, raw_stage)
     DO UPDATE SET
       normalized_stage = EXCLUDED.normalized_stage,
       is_open          = EXCLUDED.is_open,
       display_order    = EXCLUDED.display_order,
       updated_at       = now()`,
    [workspaceId, rawStageName, resolvedImportNormalized, isOpen, displayOrder]
  );
}

export async function isStageMappingComplete(
  workspaceId: string
): Promise<boolean> {
  const unmapped = await getUnmappedStages(workspaceId);
  return unmapped.length === 0;
}

export function buildStageMappingResponse(
  stage: StageMappingQuestion,
  totalRemaining: number
): string {
  const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const valueStr = currency.format(stage.total_value);
  const funnel = FUNNEL_ORDER.map(s => NORMALIZED_STAGE_LABELS[s]).join(' → ');

  const suggestion = stage.suggested_mapping
    ? ` I'd guess **${NORMALIZED_STAGE_LABELS[stage.suggested_mapping]}** — is that right?`
    : '';

  const intro = totalRemaining > 1
    ? `I found **${totalRemaining} stages** I don't recognize yet. Let's map them so my numbers match your CRM.\n\n`
    : '';

  return `${intro}**"${stage.crm_stage_name}"** — ${stage.deal_count} deal${stage.deal_count !== 1 ? 's' : ''} worth ${valueStr}.${suggestion}

Your funnel positions: ${funnel}

Which position does **${stage.crm_stage_name}** belong to? (Or tell me to skip it if it shouldn't count as pipeline.)`;
}

export function buildStageMappingTablePrompt(stages: StageMappingQuestion[]): string {
  const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  const rows = stages.map(s => {
    const guess = s.suggested_mapping ? NORMALIZED_STAGE_LABELS[s.suggested_mapping] : 'Unknown';
    const value = currency.format(s.total_value);
    const pipeline = s.pipeline || 'Default Pipeline';
    return `| ${s.crm_stage_name} | ${pipeline} | ${guess} | ${s.deal_count} | ${value} |`;
  }).join('\n');

  return `Your CRM has **${stages.length} stage${stages.length !== 1 ? 's' : ''}** I need to classify. Here's my best guess for each — use the dropdowns to correct anything that's wrong, then click **"Looks right"** to confirm.

**Why does this matter?** Every CRM names stages differently. By mapping your stages to Pandora's standard funnel positions, I can accurately calculate win rates, pipeline coverage, and forecast accuracy across all your pipelines — not guesses.

| Stage | Pipeline | Pandora's Guess | Deals | Value |
|-------|----------|-----------------|-------|-------|
${rows}

Use the dropdowns above to correct any mismatches, or say **"looks right"** to confirm all.`;
}
