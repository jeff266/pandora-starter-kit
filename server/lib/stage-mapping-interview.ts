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
  'prospecting', 'qualification', 'evaluation', 'demo', 'proposal', 'negotiation', 'closed_won', 'closed_lost',
];

export interface StageMappingQuestion {
  crm_stage_name: string;
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

  return { mapping: null, confidence: 'low' };
}

export async function getUnmappedStages(
  workspaceId: string
): Promise<StageMappingQuestion[]> {
  // Check if Setup Interview already classified stages
  // via funnel_stages table. If so, skip stage mapping.
  const mapped = await query(
    `SELECT COUNT(*) AS count
     FROM funnel_stages
     WHERE workspace_id = $1
       AND (is_won = TRUE OR is_lost = TRUE)`,
    [workspaceId]
  );
  if (parseInt(mapped.rows[0].count) > 0) {
    return [];
  }
  // else: continue with existing logic below

  const [stagesResult, configResult] = await Promise.all([
    query(
      `SELECT stage_normalized AS crm_stage_name,
              COUNT(*)::int        AS deal_count,
              COALESCE(SUM(amount), 0) AS total_value
       FROM deals
       WHERE workspace_id = $1
         AND stage_normalized IS NOT NULL
         AND stage_normalized <> ''
       GROUP BY stage_normalized
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
      crm_stage_name:    crmName,
      deal_count:        Number(row.deal_count),
      total_value:       Number(row.total_value),
      suggested_mapping: mapping,
      confidence,
    });
  }

  return unmapped.sort((a, b) => b.deal_count - a.deal_count);
}

export async function confirmStageMapping(
  workspaceId: string,
  crmStageName: string,
  normalizedStage: NormalizedStage
): Promise<void> {
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

  existing[crmStageName] = normalizedStage;
  await saveStageMappings(workspaceId, existing);
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
